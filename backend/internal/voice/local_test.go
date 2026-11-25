package voice

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLocalPythonSpeechDoesNotRequireCloudSpeechCredentials(t *testing.T) {
	t.Setenv("PADI_PYTHON_VOICE_ENABLED", "true")
	t.Setenv("PADI_PYTHON_VOICE_ENGINE", "local")
	t.Setenv("PADI_VOICE_SERVICE_TOKEN", strings.Repeat("x", 32))
	t.Setenv("PADI_AI_FREE_ACCOUNT_CONFIRMED", "")
	t.Setenv("GEMINI_API_KEY", "")
	t.Setenv("GROQ_API_KEY", "")
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if strings.Contains(r.URL.Path, "gemini") {
			t.Error("local speech selected Gemini")
		}
		encoded := base64.StdEncoding.EncodeToString(localTestWave())
		_, _ = w.Write([]byte(`{"audio_base64":"` + encoded + `","mime_type":"audio/wav","input_tokens":0,"audio_tokens":0}`))
	}))
	defer server.Close()
	t.Setenv("PADI_PYTHON_VOICE_URL", server.URL)
	ledger := &speechLedger{}
	speech, err := LoadPythonSpeech(ledger)
	if err != nil || !speech.SupportsLocalSpeech() || speech.SupportsGroqLiveSpeech() || speech.fallbackModel != "" {
		t.Fatalf("local engine not selected: %v", err)
	}
	_, err = speech.SynthesiseLive(context.Background(), "Hello.", "ada", 1, "en-NG")
	if err != nil || calls != 1 || ledger.provider != "local-voice" {
		t.Fatalf("local speech failed or used cloud fallback: %v", err)
	}
}

func localTestWave() []byte {
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
	return data
}
