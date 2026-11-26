// Package voice coordinates private, local Python speech recognition.
package voice

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jinalegwu1/my-padi/backend/internal/ai"
)

const MaxAudioBytes = 8 * 1024 * 1024
const Model = "base"

var ErrNoSpeech = errors.New("no speech detected")
var ErrInvalidAudio = errors.New("unsupported audio recording")
var ErrBusy = errors.New("speech service is busy")

// Existing provider quota configuration is not used by local inference.
// Upload, duration, authentication and concurrency protections remain mandatory.
type Transcriber struct {
	key, endpoint string
	client        *http.Client
	active        chan struct{}
}

type SpeechFailure struct {
	Status int
	Code   string
}

func (e *SpeechFailure) Error() string { return e.Code }

type Input struct {
	Audio                             []byte
	MIME, UserID, RequestID, Language string
}
type Transcript struct {
	Text                string  `json:"text"`
	UserID              string  `json:"user_id"`
	RequestID           string  `json:"request_id"`
	Language            string  `json:"language"`
	LanguageProbability float64 `json:"language_probability"`
	LanguageDetected    bool    `json:"language_detected"`
	Model               string  `json:"model"`
	Duration            float64 `json:"duration_seconds"`
	AudioBytes          int     `json:"audio_bytes"`
	PCMBytes            int     `json:"decoded_pcm_bytes"`
	Codec               string  `json:"codec"`
	Container           string  `json:"container"`
	SampleRate          int     `json:"sample_rate"`
	Channels            int     `json:"channels"`
	DecodeMS            float64 `json:"decode_ms"`
	PrepareMS           float64 `json:"prepare_ms"`
	TranscriptionMS     float64 `json:"transcription_ms"`
	ProcessingMS        float64 `json:"processing_ms"`
	ServiceMS           float64 `json:"service_ms"`
}

type Readiness struct {
	LiveLanguages  []string `json:"live_languages,omitempty"`
	Ready          bool     `json:"ready"`
	Model          string   `json:"model"`
	Error          string   `json:"error"`
	TimeoutSeconds float64  `json:"timeout_seconds"`
}

func NewRequestID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}

func LoadEnvironment(_ ai.UsageLimiter) (*Transcriber, error) {
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
	endpoint := os.Getenv("PADI_PYTHON_VOICE_URL")
	if endpoint == "" {
		endpoint = "http://127.0.0.1:8090"
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path != "" || (parsed.Scheme != "https" && !(parsed.Scheme == "http" && (parsed.Hostname() == "localhost" || parsed.Hostname() == "127.0.0.1"))) {
		return nil, errors.New("local speech URL must be HTTPS or loopback HTTP, without a path or credentials")
	}
	key := os.Getenv("PADI_VOICE_SERVICE_TOKEN")
	if len(key) < 32 {
		return nil, errors.New("local Python speech requires PADI_VOICE_SERVICE_TOKEN with at least 32 bytes")
	}
	seconds := 120
	if value := os.Getenv("PADI_STT_TIMEOUT_SECONDS"); value != "" {
		seconds, err = strconv.Atoi(value)
		if err != nil || seconds < 1 || seconds > 120 {
			return nil, errors.New("PADI_STT_TIMEOUT_SECONDS must be between 1 and 120")
		}
	}
	return &Transcriber{key: key, endpoint: endpoint + "/transcribe", active: make(chan struct{}, 4), client: &http.Client{Timeout: time.Duration(seconds+10) * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

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
	}
	return "", ErrInvalidAudio
}

func ValidateContentType(audio []byte, contentType string) (string, error) {
	filename, err := AudioFilename(audio)
	if err != nil {
		return "", err
	}
	media, parameters, err := mime.ParseMediaType(contentType)
	if err != nil {
		return "", &SpeechFailure{415, "unsupported_audio_format"}
	}
	valid := (filename == "recording.webm" && media == "audio/webm" && (parameters["codecs"] == "" || parameters["codecs"] == "opus")) ||
		(filename == "recording.m4a" && (media == "audio/mp4" || media == "audio/x-m4a") && (parameters["codecs"] == "" || parameters["codecs"] == "mp4a.40.2")) ||
		(filename == "recording.wav" && (media == "audio/wav" || media == "audio/x-wav"))
	if !valid {
		return "", &SpeechFailure{415, "unsupported_audio_format"}
	}
	if filename == "recording.wav" {
		if err := validateWAV(audio); err != nil {
			return "", err
		}
	}
	return mime.FormatMediaType(media, parameters), nil
}

// WAV is retained for existing native/hands-free clients. Inspect RIFF chunks
// rather than assuming all valid WAV files use the canonical 44-byte header.
func validateWAV(audio []byte) error {
	if len(audio) < 44 || int64(binary.LittleEndian.Uint32(audio[4:8])) != int64(len(audio)-8) {
		return ErrInvalidAudio
	}
	var rate, stride uint32
	foundFormat, foundData := false, false
	for offset := 12; offset < len(audio); {
		if len(audio)-offset < 8 {
			return ErrInvalidAudio
		}
		size := int64(binary.LittleEndian.Uint32(audio[offset+4 : offset+8]))
		start := offset + 8
		if size > int64(len(audio)-start) {
			return ErrInvalidAudio
		}
		switch string(audio[offset : offset+4]) {
		case "fmt ":
			if foundFormat || size < 16 {
				return ErrInvalidAudio
			}
			foundFormat = true
			format := audio[start : start+16]
			channels := uint32(binary.LittleEndian.Uint16(format[2:4]))
			rate = binary.LittleEndian.Uint32(format[4:8])
			stride = uint32(binary.LittleEndian.Uint16(format[12:14]))
			if binary.LittleEndian.Uint16(format[:2]) != 1 || binary.LittleEndian.Uint16(format[14:16]) != 16 || channels < 1 || channels > 2 || rate < 8000 || rate > 96000 || stride != channels*2 || binary.LittleEndian.Uint32(format[8:12]) != rate*stride {
				return ErrInvalidAudio
			}
		case "data":
			if !foundFormat || foundData || size == 0 || size%int64(stride) != 0 {
				return ErrInvalidAudio
			}
			foundData = true
			if float64(size)/float64(rate*stride) > 60.1 {
				return &SpeechFailure{422, "audio_too_long"}
			}
		}
		offset = start + int(size) + int(size%2)
		if offset > len(audio) {
			return ErrInvalidAudio
		}
	}
	if !foundFormat || !foundData {
		return ErrInvalidAudio
	}
	return nil
}

func (s *Transcriber) Ready(ctx context.Context) Readiness {
	request, err := http.NewRequestWithContext(ctx, "GET", strings.TrimSuffix(s.endpoint, "/transcribe")+"/ready", nil)
	if err != nil {
		return Readiness{Error: "service_unavailable"}
	}
	request.Header.Set("Authorization", "Bearer "+s.key)
	response, err := s.client.Do(request)
	if err != nil {
		return Readiness{Error: "service_unavailable"}
	}
	defer response.Body.Close()
	var state Readiness
	if json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&state) != nil {
		return Readiness{Error: "service_unavailable"}
	}
	if response.StatusCode != 200 {
		state.Ready = false
	}
	allowedErrors := map[string]bool{"model_loading": true, "model_not_installed": true, "model_load_failed": true, "model_unavailable": true}
	if !state.Ready && !allowedErrors[state.Error] {
		state.Error = "service_unavailable"
	}
	return state
}

func mapLanguage(locale string) (string, bool) {
	result, valid := map[string]string{"auto": "auto", "en": "en", "en-NG": "en", "en-GB": "en", "pcm-NG": "pcm", "fr-FR": "fr", "pt-BR": "pt", "es-ES": "es", "ar-SA": "ar", "sw-KE": "sw", "ha-NG": "ha", "yo-NG": "yo", "ig-NG": "ig", "am-ET": "am", "hi-IN": "hi", "zh-CN": "zh"}[locale]
	return result, valid
}
func ValidLanguage(locale string) bool { _, valid := mapLanguage(locale); return valid }

func (s *Transcriber) Transcribe(ctx context.Context, audio []byte) (string, error) {
	return s.TranscribeLanguage(ctx, audio, "en-NG")
}
func (s *Transcriber) TranscribeLanguage(ctx context.Context, audio []byte, language string) (string, error) {
	name, err := AudioFilename(audio)
	if err != nil {
		return "", err
	}
	media := map[string]string{"recording.wav": "audio/wav", "recording.webm": "audio/webm", "recording.m4a": "audio/mp4"}[name]
	id, err := NewRequestID()
	if err != nil {
		return "", err
	}
	result, err := s.TranscribeAudio(ctx, Input{Audio: audio, MIME: media, UserID: "internal", RequestID: id, Language: language})
	return result.Text, err
}

func (s *Transcriber) cancel(input Input) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	body, _ := json.Marshal(map[string]string{"request_id": input.RequestID, "user_id": input.UserID})
	request, err := http.NewRequestWithContext(ctx, "POST", strings.TrimSuffix(s.endpoint, "/transcribe")+"/cancel", bytes.NewReader(body))
	if err != nil {
		return
	}
	request.Header.Set("Authorization", "Bearer "+s.key)
	request.Header.Set("Content-Type", "application/json")
	if response, err := s.client.Do(request); err == nil {
		io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		response.Body.Close()
	}
}

func (s *Transcriber) TranscribeAudio(ctx context.Context, input Input) (Transcript, error) {
	language, valid := mapLanguage(input.Language)
	if !valid {
		return Transcript{}, &SpeechFailure{400, "invalid_language"}
	}
	filename, err := AudioFilename(input.Audio)
	if err != nil {
		return Transcript{}, err
	}
	contentType, err := ValidateContentType(input.Audio, input.MIME)
	if err != nil {
		return Transcript{}, err
	}
	if silentPCM(input.Audio) {
		return Transcript{}, ErrNoSpeech
	}
	if err := ctx.Err(); err != nil {
		return Transcript{}, err
	}
	select {
	case s.active <- struct{}{}:
		defer func() { <-s.active }()
	default:
		return Transcript{}, ErrBusy
	}
	// Only multipart headers are buffered. Compressed audio is forwarded once,
	// without transcoding or making a second complete audio buffer.
	var headers bytes.Buffer
	writer := multipart.NewWriter(&headers)
	for _, field := range [][2]string{{"request_id", input.RequestID}, {"user_id", input.UserID}, {"language", language}} {
		if err := writer.WriteField(field[0], field[1]); err != nil {
			return Transcript{}, err
		}
	}
	partHeaders := make(textproto.MIMEHeader)
	partHeaders.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, filename))
	partHeaders.Set("Content-Type", contentType)
	if _, err := writer.CreatePart(partHeaders); err != nil {
		return Transcript{}, err
	}
	prefixLength := headers.Len()
	writer.Close()
	value := headers.Bytes()
	reader := io.MultiReader(bytes.NewReader(value[:prefixLength]), bytes.NewReader(input.Audio), bytes.NewReader(value[prefixLength:]))
	request, err := http.NewRequestWithContext(ctx, "POST", s.endpoint, reader)
	if err != nil {
		return Transcript{}, err
	}
	request.ContentLength = int64(len(value) + len(input.Audio))
	request.Header.Set("Authorization", "Bearer "+s.key)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	cancelUpstream := false
	defer func() {
		if ctx.Err() != nil || cancelUpstream {
			s.cancel(input)
		}
	}()
	response, err := s.client.Do(request)
	if err != nil {
		cancelUpstream = true
		if ctx.Err() != nil {
			return Transcript{}, ctx.Err()
		}
		var timeout interface{ Timeout() bool }
		if errors.As(err, &timeout) && timeout.Timeout() {
			return Transcript{}, &SpeechFailure{504, "transcription_timeout"}
		}
		return Transcript{}, &SpeechFailure{503, "speech_service_unavailable"}
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		if response.StatusCode == 401 || response.StatusCode == 403 {
			return Transcript{}, &SpeechFailure{503, "speech_service_unavailable"}
		}
		var failure struct {
			Code string `json:"error"`
		}
		json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&failure)
		statuses := map[string]int{"no_speech": 422, "invalid_audio": 400, "empty_audio": 400, "audio_too_large": 413, "audio_too_long": 422, "unsupported_audio_format": 415, "unsupported_audio_codec": 415, "unsupported_language": 422, "transcription_busy": 429, "model_not_installed": 503, "model_load_failed": 503, "model_loading": 503, "model_unavailable": 503, "transcription_timeout": 504, "upload_timeout": 504, "transcription_failed": 502, "cancelled": 499}
		status, allowed := statuses[failure.Code]
		if !allowed {
			status, failure.Code = 502, "transcription_failed"
		}
		return Transcript{}, &SpeechFailure{status, failure.Code}
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 64*1024+1))
	if err != nil || len(data) > 64*1024 {
		return Transcript{}, &SpeechFailure{502, "invalid_transcription"}
	}
	var result Transcript
	if json.Unmarshal(data, &result) != nil {
		return Transcript{}, &SpeechFailure{502, "invalid_transcription"}
	}
	result.Text = strings.TrimSpace(result.Text)
	if result.Text == "" {
		return Transcript{}, ErrNoSpeech
	}
	if !utf8.ValidString(result.Text) || len(result.Text) > 8192 || result.UserID != input.UserID || result.RequestID != input.RequestID || result.AudioBytes != len(input.Audio) || result.SampleRate != 16000 || result.Channels != 1 || result.PCMBytes < 1 || result.PCMBytes > 1923200 || result.PCMBytes%2 != 0 || math.Abs(float64(result.PCMBytes)/32000-result.Duration) > 0.001 || result.Duration <= 0 || result.Duration > 60.1 || math.IsNaN(result.Duration) || result.Language == "" || len(result.Language) > 12 || result.LanguageProbability < 0 || result.LanguageProbability > 1 || !map[string]bool{"opus": true, "aac": true, "pcm_s16le": true}[result.Codec] || !map[string]bool{"webm": true, "mp4": true, "wav": true}[result.Container] {
		return Transcript{}, &SpeechFailure{502, "invalid_transcription"}
	}
	for _, duration := range []float64{result.DecodeMS, result.PrepareMS, result.TranscriptionMS, result.ProcessingMS, result.ServiceMS} {
		if duration < 0 || duration > 180000 || math.IsNaN(duration) {
			return Transcript{}, &SpeechFailure{502, "invalid_transcription"}
		}
	}
	return result, nil
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
