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
	provider string
	input    int
}

func (l *speechLedger) Reserve(_ context.Context, provider string, _ int, _ ai.UsageLimits, _ time.Time) error {
	l.provider = provider
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
