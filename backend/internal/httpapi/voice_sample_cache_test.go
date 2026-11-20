package httpapi

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/jinalegwu1/my-padi/backend/internal/ai"
	"github.com/jinalegwu1/my-padi/backend/internal/voice"
)

func publicTestAudio() voice.Audio {
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
	return voice.Audio{Base64: base64.StdEncoding.EncodeToString(data), MIME: "audio/wav"}
}

func TestPublicPreviewSurvivesRestartWhileProviderIsUnavailable(t *testing.T) {
	t.Setenv("PADI_VOICE_SAMPLE_CACHE_DIR", t.TempDir())
	t.Setenv("PADI_VOICE_MODEL", "test-model")
	t.Setenv("PADI_VOICE_DEFAULT_ID", "voice_test")
	speech := &sampleSpeech{audio: publicTestAudio()}
	request := func(want int) []byte {
		t.Helper()
		router := NewRouter(nil, Dependencies{Synthesis: speech})
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest("GET", "/v1/voice/preview?style=baby&rate=1", nil))
		if response.Code != want {
			t.Fatalf("preview returned %d, expected %d", response.Code, want)
		}
		return response.Body.Bytes()
	}
	first := request(200)
	speech.err = &ai.ProviderError{Provider: "gemini-voice", Status: 429}
	second := request(200)
	if string(first) != string(second) || speech.calls != 1 {
		t.Fatal("restart regenerated a valid public preview")
	}
	cache := newSpeechFileCache()
	if err := os.WriteFile(cache.filename("baby:en-NG:1.00", previewWords["baby"]), []byte(`{"audio":"corrupt"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if body := request(429); !json.Valid(body) {
		t.Fatal("invalid cached audio did not produce an accurate failure")
	}
	if speech.calls != 2 {
		t.Fatal("corrupt audio was used as a valid clip")
	}
}

func TestTouchGreetingReusesARealCachedHelloDuringProviderOutage(t *testing.T) {
	t.Setenv("PADI_VOICE_SAMPLE_CACHE_DIR", t.TempDir())
	cache := newSpeechFileCache()
	if err := cache.save("ada:en-NG:1.00", previewWords["ada"], publicTestAudio()); err != nil {
		t.Fatal(err)
	}
	speech := &sampleSpeech{err: &ai.ProviderError{Provider: "gemini-voice", Status: 429}}
	router := NewRouter(nil, Dependencies{Synthesis: speech})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("GET", "/v1/voice/call?style=ada&language=en-NG&rate=1", nil))
	var body struct {
		Text string `json:"text"`
	}
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &body) != nil || body.Text != previewWords["ada"] || speech.calls != 0 {
		t.Fatal("Touch greeting did not reuse the actual cached hello")
	}
}

func TestPublicCacheRejectsChangedProfileOrPhraseAndUnapprovedText(t *testing.T) {
	directory := t.TempDir()
	cache := &speechFileCache{directory: directory, model: "model-one", originalVoice: "voice_one"}
	key, text := "baby:en-NG:1.00", previewWords["baby"]
	if err := cache.save(key, text, publicTestAudio()); err != nil {
		t.Fatal(err)
	}
	for _, changed := range []*speechFileCache{
		{directory: directory, model: "model-two", originalVoice: "voice_one"},
		{directory: directory, model: "model-one", originalVoice: "voice_two"},
	} {
		if _, found := changed.load(key, text); found {
			t.Fatal("outdated voice profile was returned")
		}
	}
	if _, found := cache.load(key, "A different phrase"); found {
		t.Fatal("outdated speech phrase was returned")
	}
	t.Setenv("PADI_VOICE_SAMPLE_CACHE_DIR", directory)
	speech := &sampleSpeech{audio: publicTestAudio()}
	router := NewRouter(nil, Dependencies{Synthesis: speech})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("GET", "/v1/voice/preview?style=baby&text=private+message", nil))
	if response.Code != 400 || speech.calls != 0 {
		t.Fatal("unapproved personal text reached public clip storage")
	}
	files, err := os.ReadDir(directory)
	if err != nil || len(files) != 1 {
		t.Fatal("unexpected speech cache writes")
	}
}
