package voice

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jinalegwu1/my-padi/backend/internal/ai"
)

type Audio struct {
	Base64      string `json:"audio_base64"`
	MIME        string `json:"mime_type"`
	InputTokens int    `json:"input_tokens,omitempty"`
	AudioTokens int    `json:"audio_tokens,omitempty"`
}

// Python supplies canonical 24 kHz mono PCM WAV. Validate stored public clips
// with the same boundary checks as freshly generated speech.
func ValidSpeechAudio(audio Audio) bool {
	if audio.MIME != "audio/wav" || len(audio.Base64) > base64.StdEncoding.EncodedLen(MaxAudioBytes) {
		return false
	}
	decoded, err := base64.StdEncoding.DecodeString(audio.Base64)
	if err != nil || len(decoded) < 46 || len(decoded) > MaxAudioBytes {
		return false
	}
	return bytes.Equal(decoded[:4], []byte("RIFF")) && int(binary.LittleEndian.Uint32(decoded[4:8])) == len(decoded)-8 &&
		bytes.Equal(decoded[8:16], []byte("WAVEfmt ")) && binary.LittleEndian.Uint32(decoded[16:20]) == 16 &&
		binary.LittleEndian.Uint16(decoded[20:22]) == 1 && binary.LittleEndian.Uint16(decoded[22:24]) == 1 &&
		binary.LittleEndian.Uint32(decoded[24:28]) == 24000 && binary.LittleEndian.Uint32(decoded[28:32]) == 48000 &&
		binary.LittleEndian.Uint16(decoded[32:34]) == 2 && binary.LittleEndian.Uint16(decoded[34:36]) == 16 &&
		bytes.Equal(decoded[36:40], []byte("data")) && int(binary.LittleEndian.Uint32(decoded[40:44])) == len(decoded)-44 &&
		(len(decoded)-44)%2 == 0
}

type PythonSpeech struct {
	endpoint, token string
	fallbackModel   string
	localVoice      bool
	fastVoice       bool
	groqVoice       bool
	disableLimits   bool
	client          *http.Client
	limiter         ai.UsageLimiter
	mu              sync.Mutex
	cooldowns       map[string]time.Time
}

func LoadPythonSpeech(limiter ai.UsageLimiter) (*PythonSpeech, error) {
	raw := os.Getenv("PADI_PYTHON_VOICE_ENABLED")
	if raw == "" {
		return nil, nil
	}
	enabled, err := strconv.ParseBool(raw)
	if err != nil {
		return nil, errors.New("PADI_PYTHON_VOICE_ENABLED must be true or false")
	}
	if !enabled {
		return nil, nil
	}
	if limiter == nil {
		return nil, ai.ErrUsageLimiterUnavailable
	}
	token := os.Getenv("PADI_VOICE_SERVICE_TOKEN")
	if len(token) < 32 {
		return nil, errors.New("Python voice requires PADI_VOICE_SERVICE_TOKEN with at least 32 bytes")
	}
	endpoint := os.Getenv("PADI_PYTHON_VOICE_URL")
	if endpoint == "" {
		endpoint = "http://127.0.0.1:8090"
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path != "" || (parsed.Scheme != "https" && !(parsed.Scheme == "http" && (parsed.Hostname() == "127.0.0.1" || parsed.Hostname() == "localhost"))) {
		return nil, errors.New("Python voice URL must use HTTPS or a loopback HTTP address with no path or credentials")
	}
	engine := os.Getenv("PADI_PYTHON_VOICE_ENGINE")
	if engine == "" {
		engine = "local"
	}
	if engine == "local" {
		return &PythonSpeech{endpoint: endpoint + "/synthesise", token: token, localVoice: true, disableLimits: os.Getenv("PADI_DISABLE_ALL_LIMITS") == "true", limiter: limiter, client: &http.Client{Timeout: 55 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
	}
	if engine != "gemini" {
		return nil, errors.New("Python voice engine must be local or gemini")
	}
	confirmed := false
	for _, provider := range strings.Split(os.Getenv("PADI_AI_FREE_ACCOUNT_CONFIRMED"), ",") {
		if strings.TrimSpace(provider) == "gemini" {
			confirmed = true
		}
	}
	if !confirmed {
		return nil, errors.New("Python speech requires confirmed Gemini free-tier use")
	}
	fallback, configured := os.LookupEnv("PADI_VOICE_FALLBACK_MODEL")
	if !configured && os.Getenv("PADI_VOICE_MODEL") != "gemini-2.5-flash-preview-tts" {
		fallback = "gemini-2.5-flash-preview-tts"
	}
	if fallback != "" && fallback != "gemini-2.5-flash-preview-tts" && fallback != "gemini-3.1-flash-tts-preview" && fallback != "gemini-3.8-flash-tts" && fallback != "gemini-3.8-flash-lite-tts" {
		return nil, errors.New("choose a supported fallback voice model")
	}
	if fallback == os.Getenv("PADI_VOICE_MODEL") {
		fallback = ""
	}
	provider := os.Getenv("PADI_LIVE_VOICE_PROVIDER")
	if provider != "" && provider != "gemini" && provider != "groq" {
		return nil, errors.New("live voice provider must be gemini or groq")
	}
	groqVoice := false
	if provider == "groq" {
		confirmed := false
		for _, account := range strings.Split(os.Getenv("PADI_AI_FREE_ACCOUNT_CONFIRMED"), ",") {
			if strings.TrimSpace(account) == "groq" {
				confirmed = true
			}
		}
		if !confirmed || os.Getenv("GROQ_API_KEY") == "" {
			return nil, errors.New("fast live voice requires a configured, confirmed Groq account")
		}
		groqVoice = true
	}
	if provider != "groq" {
		for _, account := range strings.Split(os.Getenv("PADI_AI_FREE_ACCOUNT_CONFIRMED"), ",") {
			if strings.TrimSpace(account) == "groq" && os.Getenv("GROQ_API_KEY") != "" {
				groqVoice = true
				break
			}
		}
	}
	disableLimits := os.Getenv("PADI_DISABLE_ALL_LIMITS") == "true"
	return &PythonSpeech{endpoint: endpoint + "/synthesise", token: token, fallbackModel: fallback, fastVoice: provider == "groq", groqVoice: groqVoice, disableLimits: disableLimits, limiter: limiter, client: &http.Client{Timeout: 55 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

const fastVoiceModel = "canopylabs/orpheus-v1-english"

func (service *PythonSpeech) SupportsLocalSpeech() bool { return service.localVoice }

type SpeechLanguages struct {
	Supported []string `json:"supported_languages"`
	Streaming []string `json:"streaming_languages"`
}

func (service *PythonSpeech) SpeechLanguages(ctx context.Context) SpeechLanguages {
	if !service.localVoice {
		return SpeechLanguages{}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimSuffix(service.endpoint, "/synthesise")+"/health", nil)
	if err != nil {
		return SpeechLanguages{}
	}
	response, err := service.client.Do(request)
	if err != nil {
		return SpeechLanguages{}
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return SpeechLanguages{}
	}
	var state struct {
		Speech SpeechLanguages `json:"speech"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 8192)).Decode(&state) != nil {
		return SpeechLanguages{}
	}
	return state.Speech
}

func (service *PythonSpeech) SupportsGroqLiveSpeech() bool {
	return service.groqVoice
}

// SynthesiseGroqLive is the strict non-Gemini path used by streamed voice
// conversations. It never falls back to the configured Gemini voice model.
func (service *PythonSpeech) SynthesiseGroqLive(ctx context.Context, text, style string, rate float64, language string) (Audio, error) {
	if !service.SupportsGroqLiveSpeech() || rate != 1 ||
		(language != "en-NG" && language != "en-GB" && language != "pcm-NG") {
		return Audio{}, &ai.ProviderError{Provider: "groq-voice", Status: http.StatusServiceUnavailable}
	}
	audio, err := service.synthesise(ctx, text, style, rate, language, fastVoiceModel)
	var providerErr *ai.ProviderError
	if errors.As(err, &providerErr) && providerErr.Status == http.StatusTooManyRequests {
		service.mu.Lock()
		if service.cooldowns == nil {
			service.cooldowns = make(map[string]time.Time)
		}
		service.cooldowns[fastVoiceModel] = time.Now().Add(time.Minute)
		service.mu.Unlock()
	}
	return audio, err
}

// Live English turns can use Groq speech while the selected locale/pace falls
// back to Gemini when unsupported or the fast service is unavailable.
func (service *PythonSpeech) SynthesiseLive(ctx context.Context, text, style string, rate float64, language string) (Audio, error) {
	if service.localVoice {
		return service.Synthesise(ctx, text, style, rate, language)
	}
	supportedFastSpeech := rate == 1 && (language == "en-NG" || language == "en-GB" || language == "pcm-NG")
	if service.fastVoice && supportedFastSpeech {
		service.mu.Lock()
		blocked := !service.disableLimits && time.Now().Before(service.cooldowns[fastVoiceModel])
		service.mu.Unlock()
		if !blocked {
			audio, err := service.synthesise(ctx, text, style, rate, language, fastVoiceModel)
			if err == nil {
				return audio, nil
			}
			if ctx.Err() != nil || errors.Is(err, ai.ErrUsageLimiterUnavailable) {
				return Audio{}, err
			}
		}
	}
	if !service.fastVoice && supportedFastSpeech && service.groqVoice {
		service.mu.Lock()
		geminiBlocked := !service.disableLimits && time.Now().Before(service.cooldowns[""])
		service.mu.Unlock()
		if !geminiBlocked {
			audio, err := service.synthesise(ctx, text, style, rate, language, "")
			if err == nil {
				return audio, nil
			}
			if ctx.Err() != nil || errors.Is(err, ai.ErrUsageLimiterUnavailable) {
				return Audio{}, err
			}
		}
		service.mu.Lock()
		groqBlocked := !service.disableLimits && time.Now().Before(service.cooldowns[fastVoiceModel])
		service.mu.Unlock()
		if !groqBlocked {
			audio, err := service.synthesise(ctx, text, style, rate, language, fastVoiceModel)
			if err == nil {
				return audio, nil
			}
			if ctx.Err() != nil || errors.Is(err, ai.ErrUsageLimiterUnavailable) {
				return Audio{}, err
			}
		}
		if service.fallbackModel != "" {
			service.mu.Lock()
			fallbackBlocked := !service.disableLimits && time.Now().Before(service.cooldowns[service.fallbackModel])
			service.mu.Unlock()
			if !fallbackBlocked {
				audio, err := service.synthesise(ctx, text, style, rate, language, service.fallbackModel)
				if err == nil {
					return audio, nil
				}
				if ctx.Err() != nil || errors.Is(err, ai.ErrUsageLimiterUnavailable) {
					return Audio{}, err
				}
			}
		}
		return Audio{}, &ai.ProviderError{Provider: "live-voice", Status: http.StatusBadGateway}
	}
	return service.Synthesise(ctx, text, style, rate, language)
}

func (service *PythonSpeech) Synthesise(ctx context.Context, text, style string, rate float64, language string) (Audio, error) {
	models := []string{""} // Empty selects the configured primary in Python.
	if service.fallbackModel != "" {
		models = append(models, service.fallbackModel)
	}
	var lastErr error
	for _, model := range models {
		service.mu.Lock()
		blocked := !service.disableLimits && time.Now().Before(service.cooldowns[model])
		service.mu.Unlock()
		if blocked {
			lastErr = &ai.ProviderError{Provider: service.speechProvider(model), Status: http.StatusTooManyRequests}
			continue
		}
		audio, err := service.synthesise(ctx, text, style, rate, language, model)
		if err == nil {
			return audio, nil
		}
		lastErr = err
		var providerErr *ai.ProviderError
		if !errors.As(err, &providerErr) || (providerErr.Status != 429 && providerErr.Status < 500) {
			return Audio{}, err
		}
	}
	return Audio{}, lastErr
}

func (service *PythonSpeech) speechProvider(model string) string {
	if service.localVoice {
		return "local-voice"
	}
	if model == fastVoiceModel {
		return "groq-voice"
	}
	return "gemini-voice"
}

func (service *PythonSpeech) synthesise(ctx context.Context, text, style string, rate float64, language, model string) (Audio, error) {
	provider := service.speechProvider(model)
	reservedAt := time.Now()
	if err := service.limiter.Reserve(ctx, provider, 1, ai.FreeUsageLimits(), reservedAt); err != nil {
		return Audio{}, err
	}
	response, err := service.requestSpeech(ctx, service.endpoint, text, style, rate, language, model)
	if err != nil {
		if ctx.Err() != nil {
			return Audio{}, ctx.Err()
		}
		return Audio{}, errors.New("Python speech unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		if response.StatusCode == 429 {
			var failure struct {
				RetryAfter int `json:"retry_after_seconds"`
			}
			_ = json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&failure)
			seconds := failure.RetryAfter
			if seconds < 1 {
				seconds = 60
			}
			if seconds > 86400 {
				seconds = 86400
			}
			service.mu.Lock()
			if service.cooldowns == nil {
				service.cooldowns = make(map[string]time.Time)
			}
			service.cooldowns[model] = time.Now().Add(time.Duration(seconds) * time.Second)
			service.mu.Unlock()
		}
		return Audio{}, &ai.ProviderError{Provider: provider, Status: response.StatusCode}
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 12*1024*1024+1))
	if err != nil || len(data) > 12*1024*1024 {
		return Audio{}, errors.New("invalid Python speech response")
	}
	var audio Audio
	if json.Unmarshal(data, &audio) != nil || audio.MIME != "audio/wav" || audio.InputTokens < 0 || audio.InputTokens > 1_000_000 || audio.AudioTokens < 0 || audio.AudioTokens > 1_000_000 {
		return Audio{}, errors.New("invalid Python speech response")
	}
	if !ValidSpeechAudio(audio) {
		return Audio{}, errors.New("invalid Python speech audio")
	}
	// Output is audio tokens, not text tokens. Only input text usage enters the
	// existing token columns; the separate speech request bucket remains auditable.
	if err := service.limiter.RecordUsage(ctx, provider, ai.Usage{InputTokens: audio.InputTokens}, reservedAt); err != nil {
		return Audio{}, ai.ErrUsageLimiterUnavailable
	}
	return audio, nil
}

func (service *PythonSpeech) requestSpeech(ctx context.Context, endpoint, text, style string, rate float64, language, model string) (*http.Response, error) {
	payload := map[string]any{"text": text, "style": style, "rate": rate, "language": language}
	if model != "" {
		payload["model"] = model
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+service.token)
	request.Header.Set("Content-Type", "application/json")
	return service.client.Do(request)
}

// StreamSpeech forwards independently playable, ordered chunks of one neural
// utterance. A missing terminal marker is a failed synthesis, never a full reply.
func (service *PythonSpeech) StreamSpeech(ctx context.Context, text, style string, rate float64, language string, emit func(Audio) error) error {
	if !service.localVoice || (language != "en-NG" && language != "pcm-NG") {
		return errors.New("streaming speech is unavailable for this language")
	}
	provider, started := service.speechProvider(""), time.Now()
	if err := service.limiter.Reserve(ctx, provider, 1, ai.FreeUsageLimits(), started); err != nil {
		return err
	}
	res, err := service.requestSpeech(ctx, service.endpoint+"/stream", text, style, rate, language, "")
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return &ai.ProviderError{Provider: provider, Status: res.StatusCode}
	}
	decoder := json.NewDecoder(io.LimitReader(res.Body, 12*1024*1024))
	count := 0
	for {
		var packet struct {
			Audio
			Done bool `json:"done"`
		}
		if err := decoder.Decode(&packet); err != nil {
			return errors.New("incomplete speech stream")
		}
		if packet.Done && count > 0 {
			return service.limiter.RecordUsage(ctx, provider, ai.Usage{}, started)
		}
		if !ValidSpeechAudio(packet.Audio) {
			return errors.New("invalid streamed audio")
		}
		if err := emit(packet.Audio); err != nil {
			return err
		}
		count++
	}
}
