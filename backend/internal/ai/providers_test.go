package ai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProviderAdapters(t *testing.T) {
	tests := []struct {
		name     string
		provider string
		handler  http.HandlerFunc
	}{
		{
			name:     "openai",
			provider: ProviderOpenAI,
			handler: func(w http.ResponseWriter, r *http.Request) {
				if got := r.Header.Get("Authorization"); got != "Bearer provider-secret" {
					t.Errorf("Authorization = %q, want bearer credential", got)
				}
				var body struct {
					Model    string    `json:"model"`
					Messages []Message `json:"messages"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Errorf("decode request: %v", err)
				}
				if body.Model != "test-openai" || len(body.Messages) != 2 {
					t.Errorf("request = %+v, want configured model and messages", body)
				}
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"Hello"}}],"usage":{"prompt_tokens":12,"completion_tokens":4}}`))
			},
		},
		{
			name:     "openai-compatible endpoint",
			provider: ProviderOpenAICompatible,
			handler: func(w http.ResponseWriter, r *http.Request) {
				if got := r.Header.Get("Authorization"); got != "Bearer provider-secret" {
					t.Errorf("Authorization = %q, want bearer credential", got)
				}
				_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"Hello"}}],"usage":{"prompt_tokens":2,"completion_tokens":2}}`))
			},
		},
		{
			name:     "anthropic",
			provider: ProviderAnthropic,
			handler: func(w http.ResponseWriter, r *http.Request) {
				if got := r.Header.Get("x-api-key"); got != "provider-secret" {
					t.Errorf("x-api-key = %q, want configured credential", got)
				}
				if got := r.Header.Get("anthropic-version"); got != "2023-06-01" {
					t.Errorf("anthropic-version = %q", got)
				}
				var body struct {
					System   string    `json:"system"`
					Messages []Message `json:"messages"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Errorf("decode request: %v", err)
				}
				if body.System != "You are PADI." || len(body.Messages) != 1 || body.Messages[0].Role != RoleUser {
					t.Errorf("request = %+v, want separated system and user message", body)
				}
				_, _ = w.Write([]byte(`{"content":[{"type":"text","text":"Hello"}],"usage":{"input_tokens":10,"output_tokens":5}}`))
			},
		},
		{
			name:     "gemini",
			provider: ProviderGemini,
			handler: func(w http.ResponseWriter, r *http.Request) {
				if got := r.Header.Get("x-goog-api-key"); got != "provider-secret" {
					t.Errorf("x-goog-api-key = %q, want configured credential", got)
				}
				var body struct {
					Contents []struct {
						Role string `json:"role"`
					} `json:"contents"`
					SystemInstruction json.RawMessage `json:"systemInstruction"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Errorf("decode request: %v", err)
				}
				if len(body.Contents) != 1 || body.Contents[0].Role != "user" || len(body.SystemInstruction) == 0 {
					t.Errorf("request = %+v, want system instruction and user content", body)
				}
				_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"Hello"}]}}],"usageMetadata":{"promptTokenCount":9,"candidatesTokenCount":3}}`))
			},
		},
		{
			name:     "openrouter",
			provider: ProviderOpenRouter,
			handler: func(w http.ResponseWriter, r *http.Request) {
				if got := r.Header.Get("Authorization"); got != "Bearer provider-secret" {
					t.Errorf("Authorization = %q, want configured credential", got)
				}
				_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"Hello"}}],"usage":{"prompt_tokens":12,"completion_tokens":4}}`))
			},
		},
		{
			name:     "groq",
			provider: ProviderGroq,
			handler: func(w http.ResponseWriter, r *http.Request) {
				if got := r.Header.Get("Authorization"); got != "Bearer provider-secret" {
					t.Errorf("Authorization = %q, want configured credential", got)
				}
				_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"Hello"}}],"usage":{"prompt_tokens":12,"completion_tokens":4}}`))
			},
		},
		{
			name:     "mistral",
			provider: ProviderMistral,
			handler: func(w http.ResponseWriter, r *http.Request) {
				if got := r.Header.Get("Authorization"); got != "Bearer provider-secret" {
					t.Errorf("Authorization = %q, want configured credential", got)
				}
				_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"Hello"}}],"usage":{"prompt_tokens":12,"completion_tokens":4}}`))
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(test.handler)
			defer server.Close()
			t.Setenv("PADI_TEST_AI_KEY", "provider-secret")

			adapter := NewProviderAdapters(server.Client())[test.provider]
			response, err := adapter.Generate(context.Background(), ModelConfig{
				ID:        "test",
				Provider:  test.provider,
				Model:     "test-openai",
				Endpoint:  server.URL,
				APIKeyEnv: "PADI_TEST_AI_KEY",
			}, Request{Messages: []Message{
				{Role: RoleSystem, Content: "You are PADI."},
				{Role: RoleUser, Content: "Hi"},
			}})
			if err != nil {
				t.Fatalf("Generate() error = %v", err)
			}
			if response.Content != "Hello" || response.Usage.InputTokens == 0 || response.Usage.OutputTokens == 0 {
				t.Errorf("response = %+v, want content and usage", response)
			}
		})
	}
}

func TestProviderDefaultEndpoints(t *testing.T) {
	tests := []struct {
		provider string
		model    string
		endpoint string
	}{
		{provider: ProviderGemini, model: "test-model", endpoint: "https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent"},
		{provider: ProviderOpenRouter, model: "test-model", endpoint: "https://openrouter.ai/api/v1/chat/completions"},
		{provider: ProviderGroq, model: "test-model", endpoint: "https://api.groq.com/openai/v1/chat/completions"},
		{provider: ProviderZAI, model: ZAIFlashModel, endpoint: "https://api.z.ai/api/paas/v4/chat/completions"},
		{provider: ProviderMistral, model: "test-model", endpoint: "https://api.mistral.ai/v1/chat/completions"},
	}
	for _, test := range tests {
		t.Run(test.provider, func(t *testing.T) {
			t.Setenv("PADI_TEST_AI_KEY", "provider-secret")
			client := &http.Client{Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
				if request.URL.String() != test.endpoint {
					t.Errorf("request URL = %q, want %q", request.URL.String(), test.endpoint)
				}
				if test.provider == ProviderOpenRouter {
					var payload struct {
						Model string `json:"model"`
					}
					if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
						t.Errorf("decode OpenRouter request: %v", err)
					}
					if payload.Model != test.model {
						t.Errorf("OpenRouter model = %q, want configured model %q", payload.Model, test.model)
					}
				}
				body := `{"choices":[{"message":{"content":"Hello"}}],"usage":{"prompt_tokens":12,"completion_tokens":4}}`
				if test.provider == ProviderGemini {
					body = `{"candidates":[{"content":{"parts":[{"text":"Hello"}]}}],"usageMetadata":{"promptTokenCount":9,"candidatesTokenCount":3}}`
				}
				return &http.Response{
					StatusCode: http.StatusOK,
					Header:     make(http.Header),
					Body:       io.NopCloser(strings.NewReader(body)),
					Request:    request,
				}, nil
			})}
			adapter := NewProviderAdapters(client)[test.provider]
			response, err := adapter.Generate(context.Background(), ModelConfig{
				Provider:  test.provider,
				Model:     test.model,
				APIKeyEnv: "PADI_TEST_AI_KEY",
			}, Request{Messages: []Message{{Role: RoleUser, Content: "Hi"}}})
			if err != nil {
				t.Fatalf("Generate() error = %v", err)
			}
			if response.Content != "Hello" {
				t.Errorf("response content = %q, want Hello", response.Content)
			}
		})
	}
}

func TestProvidersRequestStructuredJSONWhenEnabled(t *testing.T) {
	tests := []struct {
		provider string
		jsonBody string
	}{
		{
			provider: ProviderGroq,
			jsonBody: `{"choices":[{"message":{"content":"{\"category\":\"question\"}"}}],"usage":{"prompt_tokens":3,"completion_tokens":2}}`,
		},
		{
			provider: ProviderGemini,
			jsonBody: `{"candidates":[{"content":{"parts":[{"text":"{\"category\":\"question\"}"}]}}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":2}}`,
		},
	}
	for _, test := range tests {
		t.Run(test.provider, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var payload map[string]json.RawMessage
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
					t.Errorf("decode request: %v", err)
				}
				if test.provider == ProviderGroq {
					var format struct {
						Type string `json:"type"`
					}
					if err := json.Unmarshal(payload["response_format"], &format); err != nil {
						t.Errorf("decode response_format: %v", err)
					}
					if format.Type != "json_object" {
						t.Errorf("response format = %q, want json_object", format.Type)
					}
				} else {
					var generationConfig struct {
						ResponseMIMEType string `json:"responseMimeType"`
					}
					if err := json.Unmarshal(payload["generationConfig"], &generationConfig); err != nil {
						t.Errorf("decode generationConfig: %v", err)
					}
					if generationConfig.ResponseMIMEType != "application/json" {
						t.Errorf("response MIME type = %q, want application/json", generationConfig.ResponseMIMEType)
					}
				}
				_, _ = w.Write([]byte(test.jsonBody))
			}))
			defer server.Close()
			t.Setenv("PADI_TEST_AI_KEY", "provider-secret")

			response, err := NewProviderAdapters(server.Client())[test.provider].Generate(context.Background(),
				ModelConfig{Provider: test.provider, Model: "test-model", Endpoint: server.URL, APIKeyEnv: "PADI_TEST_AI_KEY"},
				Request{
					Messages:         []Message{{Role: RoleUser, Content: "Classify this message."}},
					Task:             TaskClassification,
					StructuredOutput: true,
				})
			if err != nil {
				t.Fatalf("Generate() error = %v", err)
			}
			if !json.Valid([]byte(response.Content)) {
				t.Errorf("response = %q, want valid JSON", response.Content)
			}
		})
	}
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (roundTripper roundTripperFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return roundTripper(request)
}

func TestOpenAICompatibleProviderRequiresCustomEndpoint(t *testing.T) {
	t.Setenv("PADI_TEST_AI_KEY", "provider-secret")
	adapter := NewProviderAdapters(nil)[ProviderOpenAICompatible]
	_, err := adapter.Generate(context.Background(), ModelConfig{
		Provider:  ProviderOpenAICompatible,
		Model:     "configured-model",
		APIKeyEnv: "PADI_TEST_AI_KEY",
	}, Request{Messages: []Message{{Role: RoleUser, Content: "Hi"}}})
	var providerErr *ProviderError
	if !errors.As(err, &providerErr) || providerErr.Retryable {
		t.Fatalf("Generate() error = %v, want a non-retryable configuration error", err)
	}
}

func TestProviderErrorHandlingIsSanitizedAndClassified(t *testing.T) {
	tests := []struct {
		name       string
		status     int
		retryable  bool
		errorClass string
	}{
		{name: "model unavailable", status: http.StatusNotFound, retryable: true, errorClass: "model_unavailable"},
		{name: "unauthorized", status: http.StatusUnauthorized, errorClass: "provider_rejected"},
		{name: "rate limited", status: http.StatusTooManyRequests, retryable: true, errorClass: "rate_limited"},
		{name: "server unavailable", status: http.StatusBadGateway, retryable: true, errorClass: "provider_unavailable"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(test.status)
				_, _ = w.Write([]byte("provider response includes private diagnostic material"))
			}))
			defer server.Close()
			t.Setenv("PADI_TEST_AI_KEY", "provider-secret")

			_, err := NewProviderAdapters(server.Client())[ProviderOpenAI].Generate(context.Background(),
				ModelConfig{Provider: ProviderOpenAI, Model: "test-model", Endpoint: server.URL, APIKeyEnv: "PADI_TEST_AI_KEY"},
				Request{Messages: []Message{{Role: RoleUser, Content: "Hi"}}})
			if err == nil {
				t.Fatal("Generate() error = nil, want provider status error")
			}
			if retryable(err) != test.retryable || classifyError(err) != test.errorClass {
				t.Errorf("error classification retryable=%t class=%q", retryable(err), classifyError(err))
			}
			if strings.Contains(err.Error(), "private diagnostic") || strings.Contains(err.Error(), "provider-secret") {
				t.Errorf("provider error leaks response or secret: %v", err)
			}
		})
	}
}
