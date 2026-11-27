package ai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestStreamTextKeepsTextRoutingAndNeverRetriesAfterPublication(t *testing.T) {
	partial := &completionProvider{emitPartial: true}
	complete := &fakeProvider{response: Response{Content: "Take your time."}}
	router := testRouter(t, []ModelConfig{
		{ID: "fast", Provider: ProviderGroq, Model: "fast", Retries: 1},
		{ID: "primary", Provider: ProviderGemini, Model: "primary"},
	}, map[string]Provider{ProviderGroq: partial, ProviderGemini: complete},
		RoutingConfig{FastModel: "fast", PrimaryModel: "primary", VoicePrimaryModel: "primary"}, nil)
	request := Request{Task: TaskConversation, Complexity: ComplexitySimple, Messages: []Message{{Role: RoleUser, Content: "Hello there."}}}
	var text strings.Builder
	emit := func(s string) error { _, err := text.WriteString(s); return err }
	_, err := router.StreamText(context.Background(), request, emit)
	if err == nil || partial.calls != 1 || complete.calls != 0 || text.Len() == 0 {
		t.Fatal("partial typed reply must stop on its ordinary text model")
	}
	request.Complexity = ComplexityComplex
	text.Reset()
	result, err := router.StreamText(context.Background(), request, emit)
	if err != nil || complete.lastRequest.Voice || result.Content != "Take your time." || text.String() != result.Content {
		t.Fatal("a complete-response text model must retain its ordinary route and deliver its verified reply once")
	}
}

func TestVoiceTextModelsShareContextAndFallbackBeforeFirstDeltaOnly(t *testing.T) {
	for _, test := range []struct {
		name     string
		status   int
		partial  bool
		want     string
		fallback bool
	}{
		{"gemini text", 200, false, ProviderGemini, false},
		{"unavailable primary", 503, false, ProviderGroq, true},
		{"rate limited primary", 429, false, ProviderGroq, true},
		{"partial primary must not mix models", 200, true, "", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("PADI_TEST_STREAM_KEY", "synthetic-key")
			groqCalls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				if r.URL.Path == "/gemini" {
					var payload struct {
						Config struct {
							Modalities []string `json:"responseModalities"`
						} `json:"generationConfig"`
						System   geminiParts     `json:"systemInstruction"`
						Contents []geminiContent `json:"contents"`
					}
					if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
						t.Error(err)
					}
					if len(payload.Config.Modalities) != 1 || payload.Config.Modalities[0] != "TEXT" {
						t.Error("Gemini was not restricted to text")
					}
					if !strings.Contains(payload.System.Parts[0].Text, "Understand the user's message before deciding how to respond.") || len(payload.Contents) != 3 || payload.Contents[0].Parts[0].Text != "Our project is PADI." {
						t.Error("personality/context missing in Gemini text path")
					}
					if test.status != 200 {
						w.WriteHeader(test.status)
						return
					}
					_, _ = w.Write([]byte("data: {\"candidates\":[{\"finishReason\":\"STOP\",\"content\":{\"parts\":[{\"text\":\"PADI is our project.\"}]}}],\"usageMetadata\":{\"promptTokenCount\":10,\"candidatesTokenCount\":5}}\n\n"))
					if test.partial {
						_, _ = w.Write([]byte("data: {\"error\":{\"message\":\"synthetic interrupted stream\"}}\n\n"))
					}
					return
				}
				groqCalls++
				var payload struct {
					Messages []Message `json:"messages"`
				}
				_ = json.NewDecoder(r.Body).Decode(&payload)
				if len(payload.Messages) != 4 || payload.Messages[1].Content != "Our project is PADI." || !strings.Contains(payload.Messages[0].Content, "Understand the user's message before deciding how to respond.") {
					t.Error("fallback lost context/personality")
				}
				_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"PADI is our project.\"}}]}\n\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"))
			}))
			defer server.Close()
			router := testRouter(t, []ModelConfig{
				{ID: "text-main", Provider: ProviderGemini, Model: "ordinary-text", APIKeyEnv: "PADI_TEST_STREAM_KEY", Endpoint: server.URL + "/gemini"},
				{ID: "voice-main", Provider: ProviderGemini, Model: "gemini-3.1-flash-lite", APIKeyEnv: "PADI_TEST_STREAM_KEY", Endpoint: server.URL + "/gemini"},
				{ID: "voice-backup", Provider: ProviderGroq, Model: "openai/gpt-oss-20b", APIKeyEnv: "PADI_TEST_STREAM_KEY", Endpoint: server.URL + "/groq"},
			}, NewProviderAdapters(server.Client()), RoutingConfig{PrimaryModel: "text-main", FastModel: "voice-backup", VoicePrimaryModel: "voice-main", VoiceBackupModel: "voice-backup"}, nil)
			var spoken strings.Builder
			result, err := router.StreamVoice(context.Background(), Request{Messages: []Message{{Role: RoleUser, Content: "Our project is PADI."}, {Role: RoleAssistant, Content: "I understand."}, {Role: RoleUser, Content: "What is our project?"}}}, func(delta string) error { spoken.WriteString(delta); return nil })
			if test.partial {
				if err == nil {
					t.Fatal("partial stream failure hidden")
				}
			} else if err != nil || result.Provider != test.want || spoken.String() != "PADI is our project." {
				t.Fatalf("result=%+v err=%v delta=%s", result, err, spoken.String())
			}
			if (groqCalls > 0) != test.fallback {
				t.Fatalf("fallback calls=%d want fallback=%t", groqCalls, test.fallback)
			}
			if router.routing.PrimaryModel != "text-main" {
				t.Fatal("voice path changed ordinary text routing")
			}
		})
	}
}

func TestVoiceCancellationDoesNotFallback(t *testing.T) {
	provider := &cancelStreamProvider{}
	router := testRouter(t, []ModelConfig{{ID: "one", Provider: ProviderGemini, Model: "gemini-3.1-flash-lite"}, {ID: "two", Provider: ProviderGroq, Model: "openai/gpt-oss-20b"}}, map[string]Provider{ProviderGemini: provider, ProviderGroq: provider}, RoutingConfig{PrimaryModel: "one", FastModel: "two"}, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := router.StreamVoice(ctx, Request{Messages: []Message{{Role: RoleUser, Content: "Hello"}}}, nil)
	if !errors.Is(err, context.Canceled) || provider.calls > 1 {
		t.Fatalf("cancelled stream retried: calls=%d err=%v", provider.calls, err)
	}
}

func TestGeminiVoiceStreamRejectsAudioAndDoesNotExposeThoughtParts(t *testing.T) {
	for _, audio := range []bool{false, true} {
		t.Run(map[bool]string{false: "thinking stays private", true: "audio refused"}[audio], func(t *testing.T) {
			t.Setenv("PADI_TEST_STREAM_KEY", "synthetic-key")
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				if audio {
					_, _ = w.Write([]byte("data: {\"candidates\":[{\"finishReason\":\"STOP\",\"content\":{\"parts\":[{\"inlineData\":{\"mimeType\":\"audio/wav\",\"data\":\"AAAA\"}}]}}]}\n\n"))
					return
				}
				_, _ = w.Write([]byte("data: {\"candidates\":[{\"finishReason\":\"STOP\",\"content\":{\"parts\":[{\"text\":\"private reasoning\",\"thought\":true},{\"text\":\"Hello there.\"}]}}]}\n\n"))
			}))
			defer server.Close()
			var delivered strings.Builder
			result, err := (geminiProvider{client: server.Client()}).Stream(context.Background(), ModelConfig{Provider: ProviderGemini, Model: "gemini-3.1-flash-lite", Endpoint: server.URL, APIKeyEnv: "PADI_TEST_STREAM_KEY"}, Request{}, func(delta string) error { delivered.WriteString(delta); return nil })
			if audio {
				if err == nil || delivered.Len() != 0 {
					t.Fatal("unexpected audio reached speech queue")
				}
			} else if err != nil || result.Content != "Hello there." || delivered.String() != "Hello there." {
				t.Fatalf("private thought leaked or text lost: %+v %v", result, err)
			}
		})
	}
}

type cancelStreamProvider struct{ calls int }

func (p *cancelStreamProvider) Generate(ctx context.Context, _ ModelConfig, _ Request) (Response, error) {
	return Response{}, ctx.Err()
}
func (p *cancelStreamProvider) Stream(ctx context.Context, _ ModelConfig, _ Request, _ func(string) error) (Response, error) {
	p.calls++
	return Response{}, ctx.Err()
}
