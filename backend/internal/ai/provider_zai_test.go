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

func TestZAIKeepsConversationContextAndControlsThinking(t *testing.T) {
	cases := []struct {
		name     string
		request  Request
		thinking string
	}{
		{"conversation", Request{Task: TaskConversation}, "disabled"},
		{"reasoning", Request{Task: TaskReasoning}, "enabled"},
		{"complex conversation", Request{Task: TaskConversation, Complexity: ComplexityComplex}, "enabled"},
		{"structured reasoning", Request{Task: TaskReasoning, StructuredOutput: true}, "disabled"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("PADI_TEST_ZAI_KEY", "synthetic-key")
			request := test.request
			request.MaxOutputTokens = 256
			request.Messages = []Message{
				{Role: RoleSystem, Content: "You are PADI."},
				{Role: RoleUser, Content: "My name is Ada."},
				{Role: RoleAssistant, Content: "Hello, Ada."},
				{Role: RoleUser, Content: "What is my name?"},
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer synthetic-key" {
					t.Error("missing authenticated POST")
				}
				var body struct {
					Model     string    `json:"model"`
					Messages  []Message `json:"messages"`
					MaxTokens int       `json:"max_tokens"`
					Thinking  struct {
						Type          string `json:"type"`
						ClearThinking bool   `json:"clear_thinking"`
					} `json:"thinking"`
					ResponseFormat *struct {
						Type string `json:"type"`
					} `json:"response_format"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				if body.Model != ZAIFlashModel || body.MaxTokens != 256 || len(body.Messages) != 4 || body.Messages[3].Content != "What is my name?" {
					t.Error("model, token budget, or conversation context was lost")
				}
				if body.Thinking.Type != test.thinking || !body.Thinking.ClearThinking {
					t.Error("incorrect thinking mode")
				}
				if request.StructuredOutput && (body.ResponseFormat == nil || body.ResponseFormat.Type != "json_object") {
					t.Error("missing JSON response format")
				}
				if !request.StructuredOutput && body.ResponseFormat != nil {
					t.Error("unexpected JSON response format")
				}
				_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"Ada","reasoning_content":"private reasoning"}}],"usage":{"prompt_tokens":32,"completion_tokens":4}}`))
			}))
			defer server.Close()
			response, err := NewProviderAdapters(server.Client())[ProviderZAI].Generate(context.Background(), ModelConfig{
				Provider: ProviderZAI, Model: ZAIFlashModel, Endpoint: server.URL, APIKeyEnv: "PADI_TEST_ZAI_KEY",
			}, request)
			if err != nil {
				t.Fatal(err)
			}
			if response.Content != "Ada" || response.Usage.InputTokens != 32 || response.Usage.OutputTokens != 4 {
				t.Fatalf("incorrect visible response or token usage: %+v", response)
			}
		})
	}
}

func TestZAIRejectsReasoningOnlyResponse(t *testing.T) {
	t.Setenv("PADI_TEST_ZAI_KEY", "synthetic-key")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"","reasoning_content":"private reasoning"}}]}`))
	}))
	defer server.Close()
	_, err := NewProviderAdapters(server.Client())[ProviderZAI].Generate(context.Background(), ModelConfig{
		Provider: ProviderZAI, Model: ZAIFlashModel, Endpoint: server.URL, APIKeyEnv: "PADI_TEST_ZAI_KEY",
	}, Request{Messages: []Message{{Role: RoleUser, Content: "Hello"}}})
	if err == nil || strings.Contains(err.Error(), "private reasoning") {
		t.Fatal("reasoning-only response must fail without exposing reasoning")
	}
	if !errors.Is(err, ErrEmptyProviderResponse) || !retryable(err) || !shouldFallbackImmediately(err) {
		t.Fatal("reasoning-only response must trigger immediate provider fallback")
	}
}

func TestReasoningOnlyZAIResponseFailsAfterPreviousProviders(t *testing.T) {
	t.Setenv("PADI_TEST_ZAI_KEY", "synthetic-key")
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"","reasoning_content":"private reasoning"}}]}`))
	}))
	defer server.Close()
	groq := &fakeProvider{err: &ProviderError{Provider: ProviderGroq, Status: 503, Retryable: true}}
	openrouter := &fakeProvider{err: &ProviderError{Provider: ProviderOpenRouter, Status: 503, Retryable: true}}
	var events []Event
	router := testRouter(t, []ModelConfig{
		{ID: "groq-fast", Provider: ProviderGroq, Model: "openai/gpt-oss-20b"},
		{ID: "openrouter-backup", Provider: ProviderOpenRouter, Model: "nvidia/nemotron-3.5-lightning:free"},
		{ID: "zai-reasoning", Provider: ProviderZAI, Model: ZAIFlashModel, Endpoint: server.URL, APIKeyEnv: "PADI_TEST_ZAI_KEY"},
	}, map[string]Provider{
		ProviderGroq:       groq,
		ProviderOpenRouter: openrouter,
		ProviderZAI:        NewProviderAdapters(server.Client())[ProviderZAI],
	}, RoutingConfig{
		PrimaryModel: "groq-fast", BackupModel: "openrouter-backup",
		FastModel: "groq-fast", ReasoningModel: "zai-reasoning",
	},
		ObserverFunc(func(event Event) { events = append(events, event) }))
	response, err := router.Generate(context.Background(), testRequest(TaskReasoning, ComplexityComplex))
	if err == nil || !errors.Is(err, ErrEmptyProviderResponse) || response.Content != "" {
		t.Fatalf("Generate() = %+v, %v; want explicit empty-response error after all configured providers fail", response, err)
	}
	if calls != 1 || groq.callCount() != 1 || openrouter.callCount() != 1 {
		t.Fatalf("calls = Groq:%d OpenRouter:%d Z.ai:%d, want one attempt per provider",
			groq.callCount(), openrouter.callCount(), calls)
	}
	if len(events) != 3 || events[0].Provider != ProviderGroq ||
		events[1].Provider != ProviderOpenRouter || events[2].ErrorClass != "empty_provider_response" {
		t.Fatal("expected ordered, sanitized provider failure events")
	}
}
