// Package voice provides short-turn speech transcription without persisting audio.
package voice

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jinalegwu1/my-padi/backend/internal/ai"
)

const MaxAudioBytes = 8 * 1024 * 1024
const Model = "whisper-large-v3-turbo"

var ErrNoSpeech = errors.New("no speech detected")
var ErrInvalidAudio = errors.New("unsupported audio recording")
var ErrBusy = errors.New("speech service is busy")

type Transcriber struct {
	key      string
	endpoint string
	client   *http.Client
	limiter  ai.UsageLimiter
	active   chan struct{}
}

// LoadEnvironment keeps speech opt-in, independent of approved text models.
func LoadEnvironment(limiter ai.UsageLimiter) (*Transcriber, error) {
	raw := os.Getenv("PADI_STT_ENABLED")
	if raw == "" {
		return nil, nil
	}
	enabled, err := strconv.ParseBool(raw)
	if err != nil {
		return nil, errors.New("PADI_STT_ENABLED must be true or false")
	}
	if !enabled {
		return nil, nil
	}
	key := strings.TrimSpace(os.Getenv("GROQ_API_KEY"))
	if key == "" {
		return nil, errors.New("GROQ_API_KEY is required for voice transcription")
	}
	confirmed := false
	for _, provider := range strings.Split(os.Getenv("PADI_AI_FREE_ACCOUNT_CONFIRMED"), ",") {
		if strings.TrimSpace(provider) == "groq" {
			confirmed = true
		}
	}
	if !confirmed {
		return nil, errors.New("voice requires groq in PADI_AI_FREE_ACCOUNT_CONFIRMED")
	}
	if limiter == nil {
		return nil, ai.ErrUsageLimiterUnavailable
	}
	endpoint := "https://api.groq.com/openai/v1/audio/transcriptions"
	if os.Getenv("PADI_PYTHON_VOICE_ENABLED") == "true" {
		endpoint = os.Getenv("PADI_PYTHON_VOICE_URL")
		if endpoint == "" {
			endpoint = "http://127.0.0.1:8090"
		}
		endpoint += "/transcribe"
		key = os.Getenv("PADI_VOICE_SERVICE_TOKEN")
		if len(key) < 32 {
			return nil, errors.New("Python voice requires an internal service token")
		}
	}
	return &Transcriber{key: key, endpoint: endpoint,
		client: &http.Client{Timeout: 45 * time.Second}, limiter: limiter, active: make(chan struct{}, 4)}, nil
}

// AudioFilename identifies containers by their bytes, never trusting an upload name.
func AudioFilename(audio []byte) (string, error) {
	if len(audio) < 12 || len(audio) > MaxAudioBytes {
		return "", ErrInvalidAudio
	}
	switch {
	case bytes.Equal(audio[:4], []byte("RIFF")) && bytes.Equal(audio[8:12], []byte("WAVE")):
		return "recording.wav", nil
	case bytes.Equal(audio[4:8], []byte("ftyp")):
		return "recording.m4a", nil
	case bytes.Equal(audio[:4], []byte{0x1a, 0x45, 0xdf, 0xa3}):
		return "recording.webm", nil
	default:
		return "", ErrInvalidAudio
	}
}

func (service *Transcriber) Transcribe(ctx context.Context, audio []byte) (string, error) {
	filename, err := AudioFilename(audio)
	if err != nil {
		return "", err
	}
	if silentPCM(audio) {
		return "", ErrNoSpeech
	}
	select {
	case service.active <- struct{}{}:
		defer func() { <-service.active }()
	default:
		return "", ErrBusy
	}
	// Speech has no text-token usage. Reserve one bookkeeping unit per request
	// in a separate ledger bucket; never count audio bytes as text tokens.
	if err := service.limiter.Reserve(ctx, "groq-speech", 1, ai.FreeUsageLimits(), time.Now()); err != nil {
		if errors.Is(err, ai.ErrUsageLimitReached) {
			return "", err
		}
		return "", ai.ErrUsageLimiterUnavailable
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		return "", err
	}
	if _, err := part.Write(audio); err != nil {
		return "", err
	}
	for name, value := range map[string]string{"model": Model, "response_format": "verbose_json", "temperature": "0"} {
		if err := writer.WriteField(name, value); err != nil {
			return "", err
		}
	}
	if err := writer.Close(); err != nil {
		return "", err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, service.endpoint, &body)
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", "Bearer "+service.key)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := service.client.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		return "", &ai.ProviderError{Provider: "groq-speech"}
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		if response.StatusCode == 422 && strings.HasSuffix(service.endpoint, "/transcribe") {
			return "", ErrNoSpeech
		}
		return "", &ai.ProviderError{Provider: "groq-speech", Status: response.StatusCode}
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 64*1024+1))
	if err != nil || len(data) > 64*1024 {
		return "", errors.New("invalid speech response")
	}
	var result struct {
		Text     string  `json:"text"`
		Duration float64 `json:"duration"`
		Segments []struct {
			NoSpeech float64 `json:"no_speech_prob"`
		} `json:"segments"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return "", errors.New("invalid speech response")
	}
	if result.Duration > 65 {
		return "", fmt.Errorf("%w: record up to 60 seconds", ErrInvalidAudio)
	}
	text := strings.TrimSpace(result.Text)
	if text == "" {
		return "", ErrNoSpeech
	}
	if !utf8.ValidString(text) || len(text) > 8*1024 {
		return "", errors.New("invalid speech response")
	}
	if len(result.Segments) > 0 {
		allSilent := true
		for _, segment := range result.Segments {
			if segment.NoSpeech < 0.8 {
				allSilent = false
			}
		}
		if allSilent {
			return "", ErrNoSpeech
		}
	}
	return text, nil
}

// Whisper can confidently invent words even for digital silence. Reject known
// silent 16-bit PCM locally; compressed microphone formats use client metering.
func silentPCM(audio []byte) bool {
	if len(audio) < 44 || !bytes.Equal(audio[:4], []byte("RIFF")) || !bytes.Equal(audio[8:12], []byte("WAVE")) {
		return false
	}
	pcm16 := false
	for offset := 12; offset+8 <= len(audio); {
		size := int(binary.LittleEndian.Uint32(audio[offset+4 : offset+8]))
		start := offset + 8
		if size > len(audio)-start {
			return false
		}
		switch string(audio[offset : offset+4]) {
		case "fmt ":
			if size >= 16 {
				pcm16 = binary.LittleEndian.Uint16(audio[start:start+2]) == 1 && binary.LittleEndian.Uint16(audio[start+14:start+16]) == 16
			}
		case "data":
			if !pcm16 || size == 0 {
				return false
			}
			for _, sample := range audio[start : start+size] {
				if sample != 0 {
					return false
				}
			}
			return true
		}
		offset = start + size + size%2
	}
	return false
}
