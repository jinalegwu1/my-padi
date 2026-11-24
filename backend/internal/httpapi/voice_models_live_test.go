package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jinalegwu1/my-padi/backend/internal/ai"
	"github.com/jinalegwu1/my-padi/backend/internal/auth"
	"github.com/jinalegwu1/my-padi/backend/internal/config"
	"github.com/jinalegwu1/my-padi/backend/internal/database"
	"github.com/jinalegwu1/my-padi/backend/internal/personality"
	"github.com/jinalegwu1/my-padi/backend/internal/voice"
)

type unavailableVoiceText struct{}

func (unavailableVoiceText) Generate(context.Context, ai.ModelConfig, ai.Request) (ai.Response, error) {
	return ai.Response{}, &ai.ProviderError{Provider: ai.ProviderGemini, Status: 503, Retryable: true}
}
func (unavailableVoiceText) Stream(context.Context, ai.ModelConfig, ai.Request, func(string) error) (ai.Response, error) {
	return ai.Response{}, &ai.ProviderError{Provider: ai.ProviderGemini, Status: 503, Retryable: true}
}

// Explicit opt-in: synthetic words and identity; real text models and Groq TTS.
// No SMS, personal microphone audio, Gemini audio, or saved conversation data.
func TestVoiceTextModelsReachConfiguredSpeech(t *testing.T) {
	if os.Getenv("PADI_VERIFY_VOICE_MODELS") != "1" {
		t.Skip("live voice-model verification disabled")
	}
	if os.Getenv("PADI_ENV") != "development" {
		t.Fatal("development mode required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	db, err := database.Open(ctx, config.Load().DatabaseURL)
	if err != nil {
		t.Fatal("usage ledger unavailable")
	}
	defer db.Close()
	limiter, err := database.NewDevelopmentAIUsageLimiter(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	configuration, err := ai.LoadEnvironment()
	if err != nil {
		t.Fatal(err)
	}
	speech, err := voice.LoadPythonSpeech(limiter)
	if err != nil || speech == nil {
		t.Fatal("configured speech unavailable")
	}
	var reports []map[string]any
	defer func() {
		body, _ := json.MarshalIndent(reports, "", "  ")
		_ = os.WriteFile("/tmp/padi-voice-model-evidence.json", body, 0600)
	}()
	for _, test := range []struct {
		name, primary, backup string
		forceUnavailable      bool
	}{
		{"groq text to existing TTS", "groq-fast", "groq-fast", false},
		{"gemini 3.1 text to existing TTS", "gemini-voice", "gemini-voice", false},
		{"controlled Gemini failure to real Groq and existing TTS", "gemini-voice", "groq-fast", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			adapters := ai.NewProviderAdapters(nil)
			if test.forceUnavailable {
				adapters[ai.ProviderGemini] = unavailableVoiceText{}
			}
			routing := configuration.Routing
			routing.VoicePrimaryModel, routing.VoiceBackupModel = test.primary, test.backup
			events := []ai.Event{}
			generator, err := ai.NewRouterWithUsageLimiter(configuration.Models, adapters, routing, ai.ObserverFunc(func(event ai.Event) { events = append(events, event) }), limiter)
			if err != nil {
				t.Fatal(err)
			}
			preferences := personality.DefaultPreferences()
			preferences.Humour = personality.HumourOff
			router := NewRouter(nil, Dependencies{Auth: testAuthAPI{user: auth.User{ID: "voice-model-verification"}}, Chat: generator, Synthesis: speech, Personality: &testPersonalityPreferencesAPI{current: preferences}})
			call := func(path, body string) *httptest.ResponseRecorder {
				request := httptest.NewRequest("POST", path, strings.NewReader(body)).WithContext(ctx)
				request.Header.Set("Authorization", "Bearer synthetic-voice-model-session")
				response := httptest.NewRecorder()
				router.ServeHTTP(response, request)
				return response
			}
			chatBody := `{"delivery":"voice","stream":true,"language":"en-NG","messages":[{"role":"user","content":"Our project is called PADI."},{"role":"assistant","content":"PADI is our project."},{"role":"user","content":"What is our project called? Answer in one short sentence."}]}`
			response := call("/v1/chat", chatBody)
			for attempt := 0; attempt < 2 && !strings.Contains(response.Body.String(), "event: done"); attempt++ {
				select {
				case <-ctx.Done():
					t.Fatal("live verification timed out")
				case <-time.After(35 * time.Second):
				}
				response = call("/v1/chat", chatBody)
			}
			report := map[string]any{"scenario": test.name, "events": events, "gemini_audio_requested": false, "tts_groq_only": true, "response_http": response.Code}
			defer func() { reports = append(reports, report) }()
			var reply string
			for _, block := range strings.Split(response.Body.String(), "\n\n") {
				if strings.HasPrefix(block, "event: done\n") {
					var done struct {
						Reply string `json:"reply"`
					}
					_ = json.Unmarshal([]byte(strings.TrimPrefix(block, "event: done\ndata: ")), &done)
					reply = done.Reply
				}
			}
			if reply == "" {
				report["stream_error"] = response.Body.String()
				t.Error("actual configured text model did not produce a complete response; see evidence file")
				return
			}
			report["reply"] = reply
			if !strings.Contains(strings.ToLower(reply), "padi") {
				t.Error("real reply lost synthetic conversation context")
			}
			body, _ := json.Marshal(map[string]any{"text": reply, "style": "ada", "rate": 1, "language": "en-NG", "groq_only": true})
			audioResponse := call("/v1/voice/speak", string(body))
			report["tts_http"] = audioResponse.Code
			if audioResponse.Code != 200 {
				t.Error("generated text did not reach configured TTS")
				return
			}
			var result struct {
				Audio string `json:"audio_base64"`
			}
			_ = json.Unmarshal(audioResponse.Body.Bytes(), &result)
			audio, err := base64.StdEncoding.DecodeString(result.Audio)
			if err != nil || len(audio) < 44 || string(audio[:4]) != "RIFF" {
				t.Error("TTS returned no playable WAV")
				return
			}
			report["audio_bytes"] = len(audio)
			file := filepath.Join("/tmp", "padi-model-"+test.primary+".wav")
			_ = os.WriteFile(file, audio, 0600)
			report["audio_file"] = file
			t.Logf("real text and configured speech verified for %s", test.name)
		})
	}
}
