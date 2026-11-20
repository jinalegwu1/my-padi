package voice

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jinalegwu1/my-padi/backend/internal/ai"
)

type testLimiter struct {
	calls int
	err   error
}

func (l *testLimiter) Reserve(_ context.Context, provider string, units int, _ ai.UsageLimits, _ time.Time) error {
	l.calls++
	if provider != "groq-speech" || units != 1 {
		return errors.New("incorrect speech accounting")
	}
	return l.err
}
func (*testLimiter) RecordUsage(context.Context, string, ai.Usage, time.Time) error { return nil }

func TestSpeechEnvironmentOptIn(t *testing.T) {
	t.Setenv("PADI_STT_ENABLED", "")
	if service, err := LoadEnvironment(nil); service != nil || err != nil {
		t.Fatal("speech should default off")
	}
	t.Setenv("PADI_STT_ENABLED", "true")
	t.Setenv("GROQ_API_KEY", "test-key")
	t.Setenv("PADI_AI_FREE_ACCOUNT_CONFIRMED", "groq")
	if _, err := LoadEnvironment(nil); !errors.Is(err, ai.ErrUsageLimiterUnavailable) {
		t.Fatal("speech must require persistent accounting")
	}
	if service, err := LoadEnvironment(&testLimiter{}); service == nil || err != nil {
		t.Fatal("speech did not load")
	}
	t.Setenv("PADI_AI_FREE_ACCOUNT_CONFIRMED", "gemini")
	if _, err := LoadEnvironment(&testLimiter{}); err == nil {
		t.Fatal("unconfirmed account allowed")
	}
}

func TestContainerValidation(t *testing.T) {
	for _, test := range []struct {
		data []byte
		name string
	}{
		{[]byte("RIFF0000WAVEdata"), "recording.wav"},
		{[]byte("0000ftypM4A "), "recording.m4a"},
		{append([]byte{0x1a, 0x45, 0xdf, 0xa3}, make([]byte, 12)...), "recording.webm"},
	} {
		if name, err := AudioFilename(test.data); err != nil || name != test.name {
			t.Fatal("container not recognised")
		}
	}
	for _, data := range [][]byte{nil, []byte("fake audio"), make([]byte, MaxAudioBytes+1)} {
		if _, err := AudioFilename(data); !errors.Is(err, ErrInvalidAudio) {
			t.Fatal("invalid audio accepted")
		}
	}
}

func TestTranscriptionProviderContractAndFailures(t *testing.T) {
	for _, test := range []struct {
		name, response string
		status         int
		want           error
	}{
		{"success", `{"text":" Hello PADI 😊 ","duration":2,"segments":[{"no_speech_prob":0.1}]}`, 200, nil},
		{"empty", `{"text":" ","duration":2}`, 200, ErrNoSpeech},
		{"silent hallucination", `{"text":"Thank you for watching","duration":2,"segments":[{"no_speech_prob":0.95}]}`, 200, ErrNoSpeech},
		{"too long", `{"text":"Hello","duration":70}`, 200, ErrInvalidAudio},
		{"rate limited", `private key and upstream error`, 429, &ai.ProviderError{}},
		{"malformed", `not json`, 200, errors.New("invalid speech response")},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "POST" || r.Header.Get("Authorization") != "Bearer test-key" {
					t.Error("missing provider credentials")
				}
				if err := r.ParseMultipartForm(MaxAudioBytes); err != nil {
					t.Fatal(err)
				}
				defer r.MultipartForm.RemoveAll()
				if r.FormValue("model") != Model || r.FormValue("response_format") != "verbose_json" || r.FormValue("language") != "en" {
					t.Error("wrong model or missing selected English language")
				}
				file, header, err := r.FormFile("file")
				if err != nil {
					t.Fatal(err)
				}
				defer file.Close()
				data, _ := io.ReadAll(file)
				if string(data) != "RIFF0000WAVEdata" || header.Filename != "recording.wav" {
					t.Error("wrong recording")
				}
				w.WriteHeader(test.status)
				io.WriteString(w, test.response)
			}))
			defer server.Close()
			limiter := &testLimiter{}
			service := &Transcriber{key: "test-key", endpoint: server.URL, client: server.Client(), limiter: limiter, active: make(chan struct{}, 1)}
			text, err := service.Transcribe(context.Background(), []byte("RIFF0000WAVEdata"))
			if test.want == nil {
				if err != nil || text != "Hello PADI 😊" {
					t.Fatal("valid transcription did not return")
				}
			} else {
				if err == nil || text != "" || strings.Contains(err.Error(), "private key") {
					t.Fatal("failed transcription or secret not handled")
				}
				if test.want == ErrNoSpeech || test.want == ErrInvalidAudio {
					if !errors.Is(err, test.want) {
						t.Fatal("incorrect error class")
					}
				}
				if test.status == 429 {
					var provider *ai.ProviderError
					if !errors.As(err, &provider) || provider.Status != 429 {
						t.Fatal("rate limit lost")
					}
				}
			}
			if limiter.calls != 1 {
				t.Fatal("speech request not recorded")
			}
		})
	}
}

func TestTranscriptionQuotaAndCancellationPreventProviderCalls(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("provider should not be called") }))
	defer server.Close()
	service := &Transcriber{endpoint: server.URL, client: server.Client(), limiter: &testLimiter{err: ai.ErrUsageLimitReached}, active: make(chan struct{}, 1)}
	if _, err := service.Transcribe(context.Background(), []byte("RIFF0000WAVEdata")); !errors.Is(err, ai.ErrUsageLimitReached) {
		t.Fatal("quota ignored")
	}
	service.limiter = &testLimiter{}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := service.Transcribe(ctx, []byte("RIFF0000WAVEdata")); !errors.Is(err, context.Canceled) {
		t.Fatal("cancellation ignored")
	}
}

func TestTranscriptionUsesSelectedProviderLanguageWithoutTranslation(t *testing.T) {
	var selected string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(MaxAudioBytes); err != nil {
			t.Fatal(err)
		}
		defer r.MultipartForm.RemoveAll()
		selected = r.FormValue("language")
		if r.FormValue("response_format") != "verbose_json" {
			t.Error("Transcription was changed to translation")
		}
		io.WriteString(w, `{"text":"Hello","duration":1}`)
	}))
	defer server.Close()
	service := &Transcriber{endpoint: server.URL, client: server.Client(), limiter: &testLimiter{}, active: make(chan struct{}, 1)}
	for _, test := range []struct{ locale, language string }{{"en-NG", "en"}, {"en-GB", "en"}, {"fr-FR", "fr"}, {"pcm-NG", "en"}} {
		if _, err := service.TranscribeLanguage(context.Background(), []byte("RIFF0000WAVEdata"), test.locale); err != nil || selected != test.language {
			t.Fatal("Language was auto-detected instead of using the selected language")
		}
	}
}
