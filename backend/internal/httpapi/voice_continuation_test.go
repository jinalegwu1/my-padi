package httpapi

import (
	"github.com/jinalegwu1/my-padi/backend/internal/ai"
	"github.com/jinalegwu1/my-padi/backend/internal/memory"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestVoiceDeliveryUsesSpokenStyleAndInterruptedContext(t *testing.T) {
	generator := &testChatGenerator{}
	router := NewRouter(nil, Dependencies{Auth: testAuthAPI{}, Chat: generator})
	request := httptest.NewRequest("POST", "/v1/chat", strings.NewReader(`{"delivery":"voice","messages":[{"role":"assistant","content":"First sentence. Second sentence."},{"role":"user","content":"Please continue"}],"voice_context":{"interrupted_reply":"First sentence. Second sentence.","spoken_prefix":"First sentence."}}`))
	request.Header.Set("Authorization", "Bearer test-token")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != 200 || generator.request.Messages[0].Role != ai.RoleSystem || !strings.Contains(generator.request.Messages[0].Content, "spoken conversation") || !strings.Contains(generator.request.Messages[0].Content, `"spoken_prefix":"First sentence."`) {
		t.Fatal("voice delivery or interrupted context missing")
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
