package voice

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"github.com/jinalegwu1/my-padi/backend/internal/ai"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type speechLedger struct {
	provider  string
	input     int
	requests  int
	providers []string
}

func (l *speechLedger) Reserve(_ context.Context, provider string, _ int, _ ai.UsageLimits, _ time.Time) error {
	l.provider = provider
	l.requests++
	l.providers = append(l.providers, provider)
	return nil
}
func (l *speechLedger) RecordUsage(_ context.Context, _ string, usage ai.Usage, _ time.Time) error {
	l.input = usage.InputTokens
	return nil
}

func TestPythonSpeechPrivateTransportAndUsage(t *testing.T) {
	data := make([]byte, 48)
	copy(data, "RIFF")
	binary.LittleEndian.PutUint32(data[4:], 40)
	copy(data[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(data[16:], 16)
	binary.LittleEndian.PutUint16(data[20:], 1)
	binary.LittleEndian.PutUint16(data[22:], 1)
	binary.LittleEndian.PutUint32(data[24:], 24000)
	binary.LittleEndian.PutUint32(data[28:], 48000)
	binary.LittleEndian.PutUint16(data[32:], 2)
	binary.LittleEndian.PutUint16(data[34:], 16)
	copy(data[36:], "data")
	binary.LittleEndian.PutUint32(data[40:], 4)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer internal-test-token" {
			t.Error("internal authentication missing")
		}
		var body struct {
			Text, Style, Language string
			Rate                  float64
		}
		json.NewDecoder(r.Body).Decode(&body)
		if body.Text != "How you dey?" || body.Style != "tunde" || body.Language != "pcm-NG" || body.Rate != 1.15 {
			t.Error("speech words or selected delivery preferences were lost")
		}
		json.NewEncoder(w).Encode(Audio{Base64: base64.StdEncoding.EncodeToString(data), MIME: "audio/wav", InputTokens: 15, AudioTokens: 200})
	}))
	defer server.Close()
	ledger := &speechLedger{}
	speech := &PythonSpeech{endpoint: server.URL, token: "internal-test-token", client: server.Client(), limiter: ledger}
	result, err := speech.Synthesise(context.Background(), "How you dey?", "tunde", 1.15, "pcm-NG")
	if err != nil || result.Base64 == "" || ledger.provider != "gemini-voice" || ledger.input != 15 {
		t.Fatal("Python speech or input usage not retained")
	}
}

func TestPythonSpeechConfigurationRejectsInsecureRemoteTransport(t *testing.T) {
	t.Setenv("PADI_PYTHON_VOICE_ENABLED", "true")
	t.Setenv("PADI_VOICE_SERVICE_TOKEN", "012345678901234567890123456789012345")
	t.Setenv("PADI_AI_FREE_ACCOUNT_CONFIRMED", "gemini")
	for _, endpoint := range []string{"http://remote.invalid", "http://127.0.0.1:8090/path", "https://user:password@remote.invalid"} {
		t.Setenv("PADI_PYTHON_VOICE_URL", endpoint)
		if _, err := LoadPythonSpeech(&speechLedger{}); err == nil {
			t.Fatal("unsafe internal transport allowed")
		}
	}
}

func TestPythonSpeechFallsBackAndHonorsPrimaryCooldown(t *testing.T) {
	data := make([]byte, 48)
	copy(data, "RIFF")
	binary.LittleEndian.PutUint32(data[4:], 40)
	copy(data[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(data[16:], 16)
	binary.LittleEndian.PutUint16(data[20:], 1)
	binary.LittleEndian.PutUint16(data[22:], 1)
	binary.LittleEndian.PutUint32(data[24:], 24000)
	binary.LittleEndian.PutUint32(data[28:], 48000)
	binary.LittleEndian.PutUint16(data[32:], 2)
	binary.LittleEndian.PutUint16(data[34:], 16)
	copy(data[36:], "data")
	binary.LittleEndian.PutUint32(data[40:], 4)
	var primary, fallback int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Text, Style, Language, Model string
			Rate                         float64
		}
		json.NewDecoder(r.Body).Decode(&body)
		if body.Text != "Hello" || body.Style != "ada" || body.Language != "en-NG" || body.Rate != 1 {
			t.Error("Fallback lost the actual words or persona")
		}
		if body.Model == "" {
			primary++
			w.WriteHeader(429)
			w.Write([]byte(`{"retry_after_seconds":3600}`))
			return
		}
		if body.Model != "gemini-3.1-flash-tts-preview" {
			t.Error("Unexpected fallback model")
		}
		fallback++
		json.NewEncoder(w).Encode(Audio{Base64: base64.StdEncoding.EncodeToString(data), MIME: "audio/wav", InputTokens: 8})
	}))
	defer server.Close()
	ledger := &speechLedger{}
	speech := &PythonSpeech{endpoint: server.URL, client: server.Client(), limiter: ledger, fallbackModel: "gemini-3.1-flash-tts-preview"}
	for range 2 {
		if _, err := speech.Synthesise(context.Background(), "Hello", "ada", 1, "en-NG"); err != nil {
			t.Fatal(err)
		}
	}
	if primary != 1 || fallback != 2 || ledger.requests != 3 {
		t.Fatal("Fallback retries or usage accounting were incorrect")
	}
	speech.cooldowns[""] = time.Now().Add(-time.Second)
	if _, err := speech.Synthesise(context.Background(), "Hello", "ada", 1, "en-NG"); err != nil {
		t.Fatal(err)
	}
	if primary != 2 {
		t.Fatal("Primary was not reconsidered after quota reset")
	}
}

func TestLiveSpeechUsesFastProviderAndRetainsWorkingFallback(t *testing.T) {
	data := make([]byte, 48)
	copy(data, "RIFF")
	binary.LittleEndian.PutUint32(data[4:], 40)
	copy(data[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(data[16:], 16)
	binary.LittleEndian.PutUint16(data[20:], 1)
	binary.LittleEndian.PutUint16(data[22:], 1)
	binary.LittleEndian.PutUint32(data[24:], 24000)
	binary.LittleEndian.PutUint32(data[28:], 48000)
	binary.LittleEndian.PutUint16(data[32:], 2)
	binary.LittleEndian.PutUint16(data[34:], 16)
	copy(data[36:], "data")
	binary.LittleEndian.PutUint32(data[40:], 4)
	var selected []string
	allowed := true
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Text, Style, Language, Model string
			Rate                         float64
		}

		json.NewDecoder(r.Body).Decode(&body)
		if body.Text != "Hey!" || body.Style != "ada" || body.Rate != 1 {
			t.Error("Fast transport changed the reply or persona")
		}
		selected = append(selected, body.Model)
		if body.Model == fastVoiceModel && !allowed {
			w.WriteHeader(400)
			w.Write([]byte(`{"error":"speech_terms_required"}`))
			return
		}
		json.NewEncoder(w).Encode(Audio{Base64: base64.StdEncoding.EncodeToString(data), MIME: "audio/wav"})
	}))
	defer server.Close()
	ledger := &speechLedger{}
	speech := &PythonSpeech{endpoint: server.URL, client: server.Client(), limiter: ledger, fastVoice: true}
	for _, language := range []string{"en-NG", "en-NG", "fr-FR"} {
		if _, err := speech.SynthesiseLive(context.Background(), "Hey!", "ada", 1, language); err != nil {
			t.Fatal(err)
		}
		allowed = false
	}
	if len(selected) != 4 || selected[0] != fastVoiceModel || selected[1] != fastVoiceModel || selected[2] != "" || selected[3] != "" {
		t.Fatal("Fast voice or unsupported-language fallback was incorrect")
	}
	if len(ledger.providers) != 4 || ledger.providers[0] != "groq-voice" || ledger.providers[1] != "groq-voice" || ledger.providers[2] != "gemini-voice" || ledger.providers[3] != "gemini-voice" {
		t.Fatal("Speech provider attempts were not accounted for separately")
	}
}

func TestGroqLiveSpeechNeverFallsBackToGemini(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body struct {
			Model string `json:"model"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body.Model != fastVoiceModel {
			t.Errorf("speech model = %q, want Groq Orpheus", body.Model)
		}
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer server.Close()
	speech := &PythonSpeech{
		endpoint: server.URL, client: server.Client(), limiter: &speechLedger{},
		groqVoice: true, fallbackModel: "gemini-3.1-flash-tts-preview",
	}
	if _, err := speech.SynthesiseGroqLive(context.Background(), "Hello.", "ada", 1, "en-NG"); err == nil {
		t.Fatal("Groq speech failure was hidden by Gemini fallback")
	}
	if calls != 1 {
		t.Fatalf("speech provider calls = %d, want one Groq-only call", calls)
	}
	if _, err := speech.SynthesiseGroqLive(context.Background(), "Bonjour.", "ada", 1, "fr-FR"); err == nil || calls != 1 {
		t.Fatal("unsupported Groq speech language was sent to any provider")
	}
}
