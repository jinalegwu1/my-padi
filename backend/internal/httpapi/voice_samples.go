package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/jinalegwu1/my-padi/backend/internal/voice"
)

// Only these public phrases can be spoken before sign-in. Personal greetings
// and conversation text continue to use the authenticated speech endpoint.
var welcomeWords = map[string]string{
	"en-NG":  "Hello! I'm PADI. I'm happy you're here. Think of me as a friendly companion you can talk to, learn with, laugh with and share your day with. I'd love to get to know you.",
	"pcm-NG": "Hello! Na me be PADI. I happy say you dey here. See me as your padi wey you fit gist with, learn with, laugh with and share your day with. I wan know you well.",
	"fr":     "Bonjour ! Je suis PADI. Je suis content que vous soyez là. Voyez-moi comme un compagnon amical avec qui parler, apprendre, rire et partager votre journée. J'aimerais beaucoup vous connaître.",
}

var previewWords = map[string]string{
	"baby":   "Hey, I'm PADI. Good to have you here. Tell me, how is your day going?",
	"ada":    "Hey! I'm PADI. I'm here whenever you want to talk.",
	"chidi":  "Hello, I'm PADI. Let's take it one step at a time.",
	"zainab": "Hi there! I'm PADI. What are we learning today?",
	"tunde":  "How you dey? Na me be PADI. Make we gist small.",
	"amara":  "Hey, I'm PADI. Take your time. I'm here with you.",
	"daniel": "Good to see you. I'm PADI. Shall we begin?",
}

type speechSample struct {
	done    chan struct{}
	audio   voice.Audio
	err     error
	created time.Time
}

type speechSamples struct {
	speech SpeechSynthesiser
	mu     sync.Mutex
	items  map[string]*speechSample
	slot   chan struct{}
	files  *speechFileCache
	logger *slog.Logger
}

func registerSpeechSamples(mux *http.ServeMux, speech SpeechSynthesiser, logger *slog.Logger) {
	samples := &speechSamples{speech: speech, items: make(map[string]*speechSample), slot: make(chan struct{}, 1), files: newSpeechFileCache(), logger: logger}
	mux.HandleFunc("/v1/voice/welcome", samples.handle(false))
	mux.HandleFunc("/v1/voice/preview", samples.handle(true))
}

func (samples *speechSamples) handle(preview bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireMethod(w, r, http.MethodGet) {
			return
		}
		if samples.speech == nil {
			writeAPIError(w, 503, "speech_unavailable", "PADI's natural voice is unavailable right now. You can continue with text.")
			return
		}
		query := r.URL.Query()
		for name, values := range query {
			if len(values) != 1 || (name != "style" && name != "language" && name != "rate") {
				writeAPIError(w, 400, "invalid_request", "Choose a supported voice sample.")
				return
			}
		}
		if r.ContentLength != 0 {
			writeAPIError(w, 400, "invalid_request", "Voice samples do not accept custom text.")
			return
		}
		style := query.Get("style")
		if style == "" {
			style = "baby"
		}
		if _, allowed := previewWords[style]; !allowed {
			writeAPIError(w, 400, "invalid_request", "Choose a supported voice style.")
			return
		}
		language := query.Get("language")
		if language == "" {
			language = "en-NG"
		}
		rate := 1.0
		text, allowed := welcomeWords[language]
		kind := "welcome"
		if preview {
			kind = "preview"
			text, allowed = previewWords[style]
			if query.Get("language") != "" {
				allowed = false
			}
			if raw := query.Get("rate"); raw != "" {
				parsed, err := strconv.ParseFloat(raw, 64)
				if err != nil || (parsed != 0.85 && parsed != 1 && parsed != 1.15) {
					allowed = false
				}
				rate = parsed
			}
		} else if query.Get("rate") != "" {
			allowed = false
		}
		if !allowed {
			writeAPIError(w, 400, "invalid_request", "Choose a supported voice sample.")
			return
		}
		key := kind + ":" + style + ":" + language + ":" + strconv.FormatFloat(rate, 'f', 2, 64)
		speechLanguage := language
		if preview && style == "tunde" {
			speechLanguage = "pcm-NG"
		} else if language == "fr" {
			speechLanguage = "fr-FR"
		}
		samples.mu.Lock()
		entry := samples.items[key]
		if entry != nil {
			select {
			case <-entry.done:
				if entry.err != nil && time.Since(entry.created) > time.Minute {
					entry = nil
				}
			default:
			}
		}
		if entry == nil {
			entry = &speechSample{done: make(chan struct{}), created: time.Now()}
			samples.items[key] = entry
			go samples.generate(entry, text, style, rate, speechLanguage)
		}
		samples.mu.Unlock()
		select {
		case <-r.Context().Done():
			return
		case <-entry.done:
		}
		if entry.err != nil {
			status, code, _ := classifyChatError(entry.err)
			message := "PADI's natural voice is unavailable right now. You can continue with text."
			if status == 429 {
				message = "PADI's natural voice is temporarily busy or rate-limited. Please try again later; text is available."
			}
			writeAPIError(w, status, code, message)
			return
		}
		writeJSON(w, 200, map[string]string{"audio_base64": entry.audio.Base64, "mime_type": entry.audio.MIME, "text": text})
	}
}

func (samples *speechSamples) generate(entry *speechSample, text, style string, rate float64, language string) {
	defer func() { entry.created = time.Now(); close(entry.done) }()
	key := style + ":" + language + ":" + strconv.FormatFloat(rate, 'f', 2, 64)
	if audio, found := samples.files.load(key, text); found {
		entry.audio = audio
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	// A cached public phrase can finish after a caller leaves; it contains no
	// personal text and can then serve another caller without a new model call.
	select {
	case samples.slot <- struct{}{}:
		defer func() { <-samples.slot }()
	case <-ctx.Done():
		entry.err = ctx.Err()
		return
	}
	entry.audio, entry.err = samples.speech.Synthesise(ctx, text, style, rate, language)
	if entry.err == nil {
		if err := samples.files.save(key, text, entry.audio); err != nil && samples.logger != nil {
			samples.logger.Warn("public voice sample cache write failed")
		}
	}
}
