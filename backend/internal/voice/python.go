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
	"time"

	"github.com/jinalegwu1/my-padi/backend/internal/ai"
)

type Audio struct {
	Base64      string `json:"audio_base64"`
	MIME        string `json:"mime_type"`
	InputTokens int    `json:"input_tokens,omitempty"`
	AudioTokens int    `json:"audio_tokens,omitempty"`
}

type PythonSpeech struct {
	endpoint, token string
	client          *http.Client
	limiter         ai.UsageLimiter
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
	confirmed := false
	for _, provider := range strings.Split(os.Getenv("PADI_AI_FREE_ACCOUNT_CONFIRMED"), ",") {
		if strings.TrimSpace(provider) == "gemini" {
			confirmed = true
		}
	}
	if !confirmed {
		return nil, errors.New("Python speech requires confirmed Gemini free-tier use")
	}
	return &PythonSpeech{endpoint: endpoint + "/synthesise", token: token, limiter: limiter, client: &http.Client{Timeout: 55 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

func (service *PythonSpeech) Synthesise(ctx context.Context, text, style string, rate float64) (Audio, error) {
	reservedAt := time.Now()
	if err := service.limiter.Reserve(ctx, "gemini-voice", 1, ai.FreeUsageLimits(), reservedAt); err != nil {
		return Audio{}, err
	}
	body, err := json.Marshal(map[string]any{"text": text, "style": style, "rate": rate})
	if err != nil {
		return Audio{}, err
	}
	request, err := http.NewRequestWithContext(ctx, "POST", service.endpoint, bytes.NewReader(body))
	if err != nil {
		return Audio{}, err
	}
	request.Header.Set("Authorization", "Bearer "+service.token)
	request.Header.Set("Content-Type", "application/json")
	response, err := service.client.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return Audio{}, ctx.Err()
		}
		return Audio{}, errors.New("Python speech unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return Audio{}, &ai.ProviderError{Provider: "gemini-voice", Status: response.StatusCode}
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 12*1024*1024+1))
	if err != nil || len(data) > 12*1024*1024 {
		return Audio{}, errors.New("invalid Python speech response")
	}
	var audio Audio
	if json.Unmarshal(data, &audio) != nil || audio.MIME != "audio/wav" || audio.InputTokens < 0 || audio.InputTokens > 1_000_000 || audio.AudioTokens < 0 || audio.AudioTokens > 1_000_000 {
		return Audio{}, errors.New("invalid Python speech response")
	}
	decoded, err := base64.StdEncoding.DecodeString(audio.Base64)
	if err != nil || len(decoded) < 46 || len(decoded) > MaxAudioBytes || !bytes.Equal(decoded[:4], []byte("RIFF")) || !bytes.Equal(decoded[8:16], []byte("WAVEfmt ")) || binary.LittleEndian.Uint32(decoded[24:28]) != 24000 || binary.LittleEndian.Uint16(decoded[22:24]) != 1 || binary.LittleEndian.Uint16(decoded[34:36]) != 16 || !bytes.Equal(decoded[36:40], []byte("data")) || int(binary.LittleEndian.Uint32(decoded[40:44])) != len(decoded)-44 {
		return Audio{}, errors.New("invalid Python speech audio")
	}
	// Output is audio tokens, not text tokens. Only input text usage enters the
	// existing token columns; the separate speech request bucket remains auditable.
	if err := service.limiter.RecordUsage(ctx, "gemini-voice", ai.Usage{InputTokens: audio.InputTokens}, reservedAt); err != nil {
		return Audio{}, ai.ErrUsageLimiterUnavailable
	}
	return audio, nil
}
