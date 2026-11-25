package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestGroqStreamReturnsDeltasAndUsage(t *testing.T) {
	t.Setenv("PADI_TEST_GROQ_KEY", "stream-test-key")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer stream-test-key" || r.Header.Get("Accept") != "text/event-stream" {
			t.Error("Groq stream request omitted authentication or event-stream accept")
		}
		var payload struct {
			Model         string `json:"model"`
			Stream        bool   `json:"stream"`
			StreamOptions struct {
				IncludeUsage bool `json:"include_usage"`
			} `json:"stream_options"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("decode Groq request: %v", err)
		}
		if payload.Model != "openai/gpt-oss-20b" || !payload.Stream || !payload.StreamOptions.IncludeUsage {
			t.Errorf("Groq request payload = %+v", payload)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"Hello \"}}]}\n\n"))
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"there.\"}}]}\n\n"))
		_, _ = w.Write([]byte("data: {\"choices\":[],\"usage\":{\"prompt_tokens\":12,\"completion_tokens\":4}}\n\n"))
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"))
	}))
	defer server.Close()

	var deltas []string
	provider := groqProvider{client: server.Client()}
	response, err := provider.Stream(context.Background(), ModelConfig{
		Provider: ProviderGroq, Model: "openai/gpt-oss-20b", Endpoint: server.URL, APIKeyEnv: "PADI_TEST_GROQ_KEY",
	}, Request{Messages: []Message{{Role: RoleUser, Content: "Hello"}}}, func(delta string) error {
		deltas = append(deltas, delta)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if response.Content != "Hello there." || response.Usage != (Usage{InputTokens: 12, OutputTokens: 4}) ||
		!reflect.DeepEqual(deltas, []string{"Hello ", "there."}) {
		t.Fatalf("stream response = %+v, deltas = %v", response, deltas)
	}
}

func TestGroqStreamRejectsProviderErrorWithoutLeakingBody(t *testing.T) {
	t.Setenv("PADI_TEST_GROQ_KEY", "stream-test-key")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte("private provider details"))
	}))
	defer server.Close()
	_, err := (groqProvider{client: server.Client()}).Stream(context.Background(), ModelConfig{
		Provider: ProviderGroq, Model: "openai/gpt-oss-20b", Endpoint: server.URL, APIKeyEnv: "PADI_TEST_GROQ_KEY",
	}, Request{Messages: []Message{{Role: RoleUser, Content: "Hello"}}}, nil)
	if err == nil || !strings.Contains(err.Error(), "HTTP 429") || strings.Contains(err.Error(), "private provider details") {
		t.Fatalf("provider error = %v, want sanitized HTTP 429", err)
	}
}
