package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

func TestAgnesTextAndStreamDeliverUnchangedPythonInstructions(t *testing.T) {
	t.Setenv("PADI_AGNES_TEST_KEY", "synthetic")
	for _, stream := range []bool{false, true} {
		t.Run(map[bool]string{false: "text", true: "voice stream"}[stream], func(t *testing.T) {
			var captured []Message
			var mu sync.Mutex
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var payload struct {
					Model         string          `json:"model"`
					Messages      []Message       `json:"messages"`
					Stream        bool            `json:"stream"`
					StreamOptions json.RawMessage `json:"stream_options"`
				}
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
					t.Error(err)
				}
				if payload.Model != AgnesFlashModel || payload.Stream != stream || len(payload.StreamOptions) != 0 {
					t.Error("Agnes request disagrees with documented fields")
				}
				mu.Lock()
				captured = payload.Messages
				mu.Unlock()
				if stream {
					w.Header().Set("Content-Type", "text/event-stream")
					_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"Hello.\"}}]}\n\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"))
				} else {
					_, _ = w.Write([]byte(`{"choices":[{"finish_reason":"stop","message":{"content":"Hello."}}]}`))
				}
			}))
			defer server.Close()
			router := testRouter(t, []ModelConfig{{ID: "agnes", Provider: ProviderAgnes, Model: AgnesFlashModel, Endpoint: server.URL, APIKeyEnv: "PADI_AGNES_TEST_KEY"}}, NewProviderAdapters(server.Client()), RoutingConfig{PrimaryModel: "agnes", FastModel: "agnes"}, nil)
			request := Request{Voice: stream, Messages: []Message{{Role: RoleUser, Content: "hey"}}}
			var err error
			if stream {
				_, err = router.StreamVoice(context.Background(), request, nil)
			} else {
				_, err = router.Generate(context.Background(), request)
			}
			if err != nil {
				t.Fatal(err)
			}
			mu.Lock()
			defer mu.Unlock()
			if len(captured) != 2 || captured[1] != request.Messages[0] {
				t.Fatal("provider lost user message")
			}
			assertSystemInstructionBoundary(t, captured[0].Content, defaultPythonGuidance(t), request)
		})
	}
}
