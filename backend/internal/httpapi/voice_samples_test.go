package httpapi

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/jinalegwu1/my-padi/backend/internal/ai"
	"github.com/jinalegwu1/my-padi/backend/internal/voice"
)

type sampleSpeech struct {
	mu        sync.Mutex
	calls     int
	texts     []string
	styles    []string
	languages []string
	err       error
	audio     voice.Audio
}

func (speech *sampleSpeech) Synthesise(_ context.Context, text, style string, _ float64, language string) (voice.Audio, error) {
	speech.mu.Lock()
	defer speech.mu.Unlock()
	speech.calls++
	speech.texts = append(speech.texts, text)
	speech.styles = append(speech.styles, style)
	speech.languages = append(speech.languages, language)
	audio := speech.audio
	if audio.Base64 == "" {
		audio = voice.Audio{Base64: "cHVibGljLXRlc3QtYXVkaW8=", MIME: "audio/wav"}
	}
	return audio, speech.err
}

func TestPublicSamplesKeepTheirSelectedVoiceAndLanguage(t *testing.T) {
	speech := &sampleSpeech{}
	router := NewRouter(nil, Dependencies{Synthesis: speech})
	for _, sample := range []struct{ path, style, language string }{
		{"/v1/voice/welcome?style=baby&language=en-NG", "baby", "en-NG"},
		{"/v1/voice/welcome?style=ada&language=pcm-NG", "ada", "pcm-NG"},
		{"/v1/voice/welcome?style=chidi&language=fr", "chidi", "fr-FR"},
		{"/v1/voice/preview?style=tunde&rate=1", "tunde", "pcm-NG"},
		{"/v1/voice/preview?style=baby&rate=1", "baby", "en-NG"},
	} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest("GET", sample.path, nil))
		last := len(speech.styles) - 1
		if response.Code != 200 || last < 0 || speech.styles[last] != sample.style || speech.languages[last] != sample.language {
			t.Fatal("sample discarded its selected voice or language")
		}
	}
}

func TestPublicVoiceSamplesAcceptOnlyFixedPhrases(t *testing.T) {
	speech := &sampleSpeech{}
	router := NewRouter(nil, Dependencies{Synthesis: speech})
	for _, path := range []string{
		"/v1/voice/welcome?text=private+message",
		"/v1/voice/welcome?style=unknown",
		"/v1/voice/welcome?language=unknown",
		"/v1/voice/welcome?style=ada&style=tunde",
		"/v1/voice/welcome?rate=1",
		"/v1/voice/preview?rate=2",
		"/v1/voice/preview?language=en-NG",
	} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
		if response.Code != 400 {
			t.Fatalf("invalid sample returned %d", response.Code)
		}
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("GET", "/v1/voice/welcome", strings.NewReader("private message")))
	if response.Code != 400 {
		t.Fatal("sample accepted request-body text")
	}
	if speech.calls != 0 {
		t.Fatal("unapproved public text reached speech generation")
	}
}

func TestConcurrentPublicVoiceSamplesReuseOneGeneration(t *testing.T) {
	speech := &sampleSpeech{}
	router := NewRouter(nil, Dependencies{Synthesis: speech})
	var group sync.WaitGroup
	for index := 0; index < 12; index++ {
		group.Add(1)
		go func() {
			defer group.Done()
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest("GET", "/v1/voice/welcome?style=ada&language=en-NG", nil))
			var result map[string]string
			if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &result) != nil || result["text"] != welcomeWords["en-NG"] {
				t.Error("fixed introduction was not returned")
			}
		}()
	}
	group.Wait()
	if speech.calls != 1 || len(speech.texts) != 1 || speech.texts[0] != welcomeWords["en-NG"] {
		t.Fatal("repeated preview regenerated or changed public speech")
	}
}

func TestPublicVoiceFailureIsNotReportedAsAudio(t *testing.T) {
	speech := &sampleSpeech{err: &ai.ProviderError{Provider: "gemini-voice", Status: 429}}
	router := NewRouter(nil, Dependencies{Synthesis: speech})
	for index := 0; index < 2; index++ {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest("GET", "/v1/voice/preview?style=chidi&rate=1", nil))
		var result map[string]any
		if response.Code != 429 || json.Unmarshal(response.Body.Bytes(), &result) != nil || result["audio_base64"] != nil {
			t.Fatal("failed sample appeared playable")
		}
	}
	if speech.calls != 1 {
		t.Fatal("failed previews repeatedly consumed provider requests")
	}
}
