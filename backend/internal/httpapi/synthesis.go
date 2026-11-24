package httpapi

import (
	"context"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jinalegwu1/my-padi/backend/internal/voice"
)

type SpeechSynthesiser interface {
	Synthesise(context.Context, string, string, float64, string) (voice.Audio, error)
}

type LiveSpeechSynthesiser interface {
	SynthesiseLive(context.Context, string, string, float64, string) (voice.Audio, error)
}

type GroqLiveSpeechSynthesiser interface {
	SupportsGroqLiveSpeech() bool
	SynthesiseGroqLive(context.Context, string, string, float64, string) (voice.Audio, error)
}

func validSpeechLanguage(language string) bool {
	switch language {
	case "en-NG", "pcm-NG", "en-GB", "fr-FR", "pt-BR", "es-ES", "ar-SA", "sw-KE", "ha-NG", "yo-NG", "ig-NG", "am-ET", "hi-IN", "zh-CN":
		return true
	}
	return false
}

func synthesisHandler(deps Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireMethod(w, r, "POST") {
			return
		}
		if deps.Auth == nil {
			writeAPIError(w, 503, "auth_unavailable", "Sign-in is unavailable.")
			return
		}
		token, ok := bearerToken(r)
		if !ok {
			writeAPIError(w, 401, "unauthenticated", "Sign in to use PADI voice.")
			return
		}
		if _, err := deps.Auth.Authenticate(r.Context(), token); err != nil {
			writeAuthError(w, err, deps.Logger)
			return
		}
		if deps.Synthesis == nil {
			writeAPIError(w, 503, "speech_unavailable", "Natural speech is not configured yet.")
			return
		}
		var body struct {
			Text     string  `json:"text"`
			Style    string  `json:"style"`
			Rate     float64 `json:"rate"`
			Language string  `json:"language"`
			Live     bool    `json:"live"`
			GroqOnly bool    `json:"groq_only"`
		}
		if decodeRequest(w, r, 64*1024, &body) != nil || !utf8.ValidString(body.Text) || strings.TrimSpace(body.Text) == "" || len(body.Text) > 8192 || body.Rate < 0.5 || body.Rate > 1.5 {
			writeAPIError(w, 400, "invalid_request", "The spoken reply is invalid.")
			return
		}
		if body.Style == "" {
			body.Style = "ada"
		}
		if body.Language == "" {
			body.Language = "en-NG"
		}
		if !validSpeechLanguage(body.Language) {
			writeAPIError(w, 400, "invalid_request", "Choose a supported speech language.")
			return
		}
		switch body.Style {
		case "baby", "ada", "chidi", "zainab", "tunde", "amara", "daniel":
		default:
			writeAPIError(w, 400, "invalid_request", "Choose a supported voice style.")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
		defer cancel()
		var audio voice.Audio
		var err error
		if body.GroqOnly {
			fast, ok := deps.Synthesis.(GroqLiveSpeechSynthesiser)
			if !ok || !fast.SupportsGroqLiveSpeech() {
				writeAPIError(w, http.StatusServiceUnavailable, "groq_speech_unavailable", "Groq speech is not configured for this voice.")
				return
			}
			audio, err = fast.SynthesiseGroqLive(ctx, body.Text, body.Style, body.Rate, body.Language)
		} else if fast, ok := deps.Synthesis.(LiveSpeechSynthesiser); ok && body.Live {
			audio, err = fast.SynthesiseLive(ctx, body.Text, body.Style, body.Rate, body.Language)
		} else {
			audio, err = deps.Synthesis.Synthesise(ctx, body.Text, body.Style, body.Rate, body.Language)
		}
		if err != nil {
			status, code, _ := classifyChatError(err)
			if deps.Logger != nil {
				deps.Logger.Warn("natural voice generation failed", "endpoint", r.URL.Path, "status", status, "error_code", code)
			}
			message := "PADI could not generate its natural voice right now. The reply is available as text."
			if status == 429 {
				message = "PADI could not generate natural voice right now. The reply is available as text."
			}
			writeAPIError(w, status, code, message)
			return
		}
		writeJSON(w, 200, map[string]string{"audio_base64": audio.Base64, "mime_type": audio.MIME})
	}
}
