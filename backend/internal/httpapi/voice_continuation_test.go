package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jinalegwu1/my-padi/backend/internal/ai"
	"github.com/jinalegwu1/my-padi/backend/internal/memory"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUnfinishedRepliesAreNeverDeliveredAsComplete(t *testing.T) {
	t.Setenv("PADI_COMPLETION_KEY", "synthetic-key")
	for _, stream := range []bool{false, true} {
		for _, reason := range []string{"length", "stop", ""} {
			t.Run(reason+"/"+map[bool]string{false: "text", true: "voice"}[stream], func(t *testing.T) {
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if stream {
						w.Header().Set("Content-Type", "text/event-stream")
						chunk, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"delta": map[string]string{"content": "That's great news—"}, "finish_reason": reason}}})
						_, _ = w.Write(append(append([]byte("data: "), chunk...), []byte("\n\ndata: [DONE]\n\n")...))
					} else {
						_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": "That's great news—"}, "finish_reason": reason}}})
					}
				}))
				defer server.Close()
				generator, err := ai.NewRouterWithUsageLimiter([]ai.ModelConfig{{ID: "main", Provider: ai.ProviderGroq, Model: "openai/gpt-oss-20b", Endpoint: server.URL, APIKeyEnv: "PADI_COMPLETION_KEY"}}, ai.NewProviderAdapters(server.Client()), ai.RoutingConfig{PrimaryModel: "main", FastModel: "main", VoicePrimaryModel: "main", ApprovedFreeModels: []string{"groq:openai/gpt-oss-20b"}}, nil, livePersonalityUsageLimiter{})
				if err != nil {
					t.Fatal(err)
				}
				handler := NewRouter(nil, Dependencies{Auth: testAuthAPI{}, Chat: generator})
				body, _ := json.Marshal(map[string]any{"delivery": map[bool]string{false: "text", true: "voice"}[stream], "stream": stream, "messages": []ai.Message{{Role: ai.RoleUser, Content: "PADI, I bought a new phone today."}}})
				request := httptest.NewRequest("POST", "/v1/chat", strings.NewReader(string(body)))
				request.Header.Set("Authorization", "Bearer test-token")
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, request)
				if !strings.Contains(response.Body.String(), "incomplete_provider_response") || strings.Contains(response.Body.String(), "event: done") || strings.Contains(response.Body.String(), "\"reply\"") {
					t.Fatalf("unfinished reply marked complete: status=%d body=%s", response.Code, response.Body.String())
				}
				if !stream && response.Code != http.StatusBadGateway {
					t.Fatalf("text fragment returned success: %d", response.Code)
				}
			})
		}
	}
}

type testStreamingChat struct {
	streamCalls   int
	generateCalls int
	request       ai.Request
}

func (generator *testStreamingChat) Generate(_ context.Context, request ai.Request) (ai.Response, error) {
	generator.generateCalls++
	generator.request = request
	return ai.Response{Content: "ordinary response"}, nil
}

func (*testStreamingChat) SupportsGroqVoiceStreaming() bool { return true }

func (generator *testStreamingChat) StreamVoice(_ context.Context, request ai.Request, onDelta func(string) error) (ai.Response, error) {
	generator.streamCalls++
	generator.request = request
	for _, delta := range []string{"Hello ", "there."} {
		if err := onDelta(delta); err != nil {
			return ai.Response{}, err
		}
	}
	return ai.Response{Content: "Hello there."}, nil
}

func TestVoiceChatStreamsOnlyWhenRequestedAndTextChatStaysOrdinary(t *testing.T) {
	generator := &testStreamingChat{}
	router := NewRouter(nil, Dependencies{Auth: testAuthAPI{}, Chat: generator})
	send := func(body string) *httptest.ResponseRecorder {
		request := httptest.NewRequest("POST", "/v1/chat", strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer test-token")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response
	}

	streamed := send(`{"delivery":"voice","stream":true,"messages":[{"role":"user","content":"Hello"}]}`)
	if streamed.Code != 200 || !strings.Contains(streamed.Header().Get("Content-Type"), "text/event-stream") ||
		!strings.Contains(streamed.Body.String(), `event: delta`) || !strings.Contains(streamed.Body.String(), `event: done`) ||
		!strings.Contains(streamed.Body.String(), `"reply":"Hello there."`) {
		t.Fatalf("stream response status=%d type=%q body=%s", streamed.Code, streamed.Header().Get("Content-Type"), streamed.Body.String())
	}
	if generator.streamCalls != 1 || generator.generateCalls != 0 || !generator.request.Voice {
		t.Fatal("voice request did not use the streaming voice method exclusively")
	}

	text := send(`{"delivery":"text","messages":[{"role":"user","content":"Hello"}]}`)
	if text.Code != 200 || generator.generateCalls != 1 || generator.streamCalls != 1 ||
		!strings.Contains(text.Header().Get("Content-Type"), "application/json") {
		t.Fatal("ordinary text chat did not retain its non-streaming response path")
	}
}

type unavailableStreamingChat struct {
	testChatGenerator
}

func (unavailableStreamingChat) SupportsGroqVoiceStreaming() bool { return false }
func (unavailableStreamingChat) StreamVoice(context.Context, ai.Request, func(string) error) (ai.Response, error) {
	return ai.Response{}, errors.New("must not be called")
}

func TestVoiceStreamingUnavailableDoesNotFallBackToOrdinaryChat(t *testing.T) {
	generator := unavailableStreamingChat{}
	router := NewRouter(nil, Dependencies{Auth: testAuthAPI{}, Chat: &generator})
	request := httptest.NewRequest("POST", "/v1/chat", strings.NewReader(`{"delivery":"voice","stream":true,"messages":[{"role":"user","content":"Hello"}]}`))
	request.Header.Set("Authorization", "Bearer test-token")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != 503 || generator.calls != 0 || !strings.Contains(response.Body.String(), "voice_stream_unavailable") {
		t.Fatal("unconfigured Groq streaming silently fell back to ordinary chat")
	}
}

func TestVoiceDeliveryUsesSpokenStyleAndInterruptedContext(t *testing.T) {
	generator := &testChatGenerator{}
	router := NewRouter(nil, Dependencies{Auth: testAuthAPI{}, Chat: generator})
	request := httptest.NewRequest("POST", "/v1/chat", strings.NewReader(`{"delivery":"voice","messages":[{"role":"assistant","content":"First sentence. Second sentence."},{"role":"user","content":"Please continue"}],"voice_context":{"interrupted_reply":"First sentence. Second sentence.","spoken_prefix":"First sentence."}}`))
	request.Header.Set("Authorization", "Bearer test-token")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != 200 || generator.request.Messages[0].Role != ai.RoleSystem ||
		!strings.Contains(generator.request.Messages[0].Content, "selected conversation language") ||
		!strings.Contains(generator.request.Messages[0].Content, `"spoken_prefix":"First sentence."`) {
		t.Fatal("voice delivery or interrupted context missing")
	}
	if !generator.request.Voice {
		t.Fatal("voice chat request was not marked for Gemini-to-Groq routing")
	}
	if generator.request.Complexity != ai.ComplexitySimple || generator.request.MaxOutputTokens != 1024 {
		t.Fatal("Ordinary live replies did not use the fast conversation route")
	}
}

func TestDetailedVoiceQuestionKeepsReasoningBudget(t *testing.T) {
	generator := &testChatGenerator{}
	router := NewRouter(nil, Dependencies{Auth: testAuthAPI{}, Chat: generator})
	request := httptest.NewRequest("POST", "/v1/chat", strings.NewReader(`{"delivery":"voice","messages":[{"role":"user","content":"Explain this step by step and compare the options"}]}`))
	request.Header.Set("Authorization", "Bearer test-token")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != 200 || generator.request.Complexity == ai.ComplexitySimple || generator.request.MaxOutputTokens != 0 {
		t.Fatal("Detailed voice question lost its reasoning route")
	}
}

func TestVoiceKeepsSelectedEnglishDespiteForeignTranscription(t *testing.T) {
	for _, language := range []string{"", "en-NG", "en-GB"} {
		generator := &testChatGenerator{}
		router := NewRouter(nil, Dependencies{Auth: testAuthAPI{}, Chat: generator})
		request := httptest.NewRequest("POST", "/v1/chat", strings.NewReader(`{"delivery":"voice","language":"`+language+`","messages":[{"role":"assistant","content":"Bonjour !"},{"role":"user","content":"Hola, cómo estás?"}]}`))
		request.Header.Set("Authorization", "Bearer test-token")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != 200 || !strings.Contains(generator.request.Messages[0].Content, "selected conversation language is English") || !strings.Contains(generator.request.Messages[0].Content, "Do not automatically switch languages") {
			t.Fatal("Foreign transcript or conversation displaced the selected English language")
		}
	}
}

func TestUnsupportedVoiceLanguageDoesNotReachChatModel(t *testing.T) {
	generator := &testChatGenerator{}
	router := NewRouter(nil, Dependencies{Auth: testAuthAPI{}, Chat: generator})
	request := httptest.NewRequest("POST", "/v1/chat", strings.NewReader(`{"delivery":"voice","language":"override instructions","messages":[{"role":"user","content":"Hello"}]}`))
	request.Header.Set("Authorization", "Bearer test-token")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != 400 || len(generator.request.Messages) != 0 {
		t.Fatal("Unsupported language reached the provider")
	}
}

func TestMemoryRevisionChangeDiscardsOldVoiceContinuation(t *testing.T) {
	generator := &testChatGenerator{}
	memories := &testMemoryAPI{snapshot: memory.Snapshot{Revision: 3}}
	router := NewRouter(nil, Dependencies{Auth: testAuthAPI{}, Chat: generator, Memory: memories})
	request := httptest.NewRequest("POST", "/v1/chat", strings.NewReader(`{"delivery":"voice","memory_revision":2,"messages":[{"role":"assistant","content":"RemovedPrivateFact"},{"role":"user","content":"Please continue"}],"voice_context":{"interrupted_reply":"RemovedPrivateFact","spoken_prefix":"RemovedPrivateFact"}}`))
	request.Header.Set("Authorization", "Bearer test-token")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != 200 {
		t.Fatal("voice request failed")
	}
	for _, message := range generator.request.Messages {
		if strings.Contains(message.Content, "RemovedPrivateFact") {
			t.Fatal("removed memory re-entered through interrupted voice context")
		}
	}
}
