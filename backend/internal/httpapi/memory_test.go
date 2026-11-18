package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jinalegwu1/my-padi/backend/internal/ai"
	"github.com/jinalegwu1/my-padi/backend/internal/auth"
	"github.com/jinalegwu1/my-padi/backend/internal/memory"
)

type testMemoryAPI struct {
	snapshot memory.Snapshot
	err      error
	owner    string
	calls    int
}

func (store *testMemoryAPI) Snapshot(_ context.Context, owner string) (memory.Snapshot, error) {
	store.owner = owner
	store.calls++
	return store.snapshot, store.err
}
func (store *testMemoryAPI) SetEnabled(ctx context.Context, owner string, _ bool) (memory.Snapshot, error) {
	return store.Snapshot(ctx, owner)
}
func (store *testMemoryAPI) Create(ctx context.Context, owner string, _ memory.Draft) (memory.Snapshot, error) {
	return store.Snapshot(ctx, owner)
}
func (store *testMemoryAPI) Update(ctx context.Context, owner, _ string, _ memory.Update) (memory.Snapshot, error) {
	return store.Snapshot(ctx, owner)
}
func (store *testMemoryAPI) Delete(ctx context.Context, owner, _ string) (memory.Snapshot, error) {
	return store.Snapshot(ctx, owner)
}

func memoryRequest(router http.Handler, method, path, body string, authenticated bool) *httptest.ResponseRecorder {
	response := httptest.NewRecorder()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	if authenticated {
		request.Header.Set("Authorization", "Bearer test")
	}
	router.ServeHTTP(response, request)
	return response
}

func TestMemoryRoutesRequireAuthenticationAndExplicitApproval(t *testing.T) {
	store := &testMemoryAPI{snapshot: memory.Snapshot{Items: []memory.Item{}}}
	router := NewRouter(nil, Dependencies{Auth: testAuthAPI{user: auth.User{ID: "owner"}}, Memory: store})
	for _, test := range []struct{ method, path, body string }{
		{"GET", "/v1/memory", ""},
		{"POST", "/v1/memory", `{"category":"name","label":"Name","value":"Ada","approved":true}`},
		{"PATCH", "/v1/memory/settings", `{"enabled":true}`},
		{"PATCH", "/v1/memory/mem_test", `{"paused":true}`},
		{"DELETE", "/v1/memory/mem_test", ""},
	} {
		if response := memoryRequest(router, test.method, test.path, test.body, false); response.Code != 401 {
			t.Fatal("unauthenticated memory access was allowed")
		}
	}
	if store.calls != 0 {
		t.Fatal("unauthenticated request reached memory storage")
	}
	for _, body := range []string{
		`{"category":"name","label":"Name","value":"Ada"}`,
		`{"category":"name","label":"Name","value":"Ada","approved":false}`,
		`{"category":"name","label":"Name","value":"Ada","approved":true,"user_id":"other"}`,
	} {
		if response := memoryRequest(router, "POST", "/v1/memory", body, true); response.Code != 400 {
			t.Fatal("unapproved or forged-owner memory request was accepted")
		}
	}
	if store.calls != 0 {
		t.Fatal("invalid memory reached storage")
	}
	response := memoryRequest(router, "POST", "/v1/memory", `{"category":"name","label":"Name","value":"Ada","approved":true}`, true)
	if response.Code != 201 || store.owner != "owner" || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("memory did not use the authenticated owner and private response")
	}
}

func TestMemoryRouteFailuresDoNotClaimSuccess(t *testing.T) {
	for _, test := range []struct {
		err    error
		status int
	}{
		{memory.ErrDisabled, 403}, {memory.ErrNotFound, 404}, {memory.ErrFull, 409}, {errors.New("private database details"), 503},
	} {
		store := &testMemoryAPI{err: test.err}
		router := NewRouter(nil, Dependencies{Auth: testAuthAPI{user: auth.User{ID: "owner"}}, Memory: store})
		response := memoryRequest(router, "POST", "/v1/memory", `{"category":"name","label":"Name","value":"Ada","approved":true}`, true)
		if response.Code != test.status || strings.Contains(response.Body.String(), "private database") {
			t.Fatal("memory failure was hidden or private details leaked")
		}
	}
	store := &testMemoryAPI{}
	router := NewRouter(nil, Dependencies{Auth: testAuthAPI{user: auth.User{ID: "owner"}}, Memory: store})
	for _, test := range []struct{ path, body string }{{"/v1/memory/settings", `{}`}, {"/v1/memory/mem_test", `{}`}, {"/v1/memory/mem_test", `{"value":" "}`}} {
		if memoryRequest(router, "PATCH", test.path, test.body, true).Code != 400 {
			t.Fatal("invalid update was accepted")
		}
	}
	if store.calls != 0 {
		t.Fatal("invalid update reached storage")
	}
}

func TestChatOnlyReceivesActiveApprovedMemoryForCurrentOwner(t *testing.T) {
	store := &testMemoryAPI{snapshot: memory.Snapshot{Enabled: true, Revision: 3, Items: []memory.Item{
		{Category: "name", Label: "Name", Value: "Ada"},
		{Category: "interests", Label: "Food", Value: "Private paused fact", Paused: true},
	}}}
	generator := &testChatGenerator{}
	router := NewRouter(nil, Dependencies{Auth: testAuthAPI{user: auth.User{ID: "owner"}}, Memory: store, Chat: generator})
	response := memoryRequest(router, "POST", "/v1/chat", `{"memory_revision":3,"messages":[{"role":"user","content":"What is my name?"}]}`, true)
	if response.Code != 200 || store.owner != "owner" || len(generator.request.Messages) != 2 || generator.request.Messages[0].Role != ai.RoleSystem {
		t.Fatal("approved memory was not included for the authenticated owner")
	}
	if !strings.Contains(generator.request.Messages[0].Content, "Ada") || strings.Contains(generator.request.Messages[0].Content, "Private paused") {
		t.Fatal("active/paused memory filtering failed")
	}
	var body struct {
		Revision int64 `json:"memory_revision"`
	}
	if json.Unmarshal(response.Body.Bytes(), &body) != nil || body.Revision != 3 {
		t.Fatal("memory revision was not returned")
	}
	store.snapshot.Enabled = false
	store.snapshot.Revision = 4
	response = memoryRequest(router, "POST", "/v1/chat", `{"memory_revision":3,"messages":[{"role":"assistant","content":"Old recalled fact Ada"},{"role":"user","content":"Hello"}]}`, true)
	if response.Code != 200 || len(generator.request.Messages) != 1 || generator.request.Messages[0].Content != "Hello" {
		t.Fatal("disabled memory or stale recalled facts leaked through history")
	}
}

func TestChatPreservesMatchingContextAndFailsClosedOnMemoryOutage(t *testing.T) {
	store := &testMemoryAPI{snapshot: memory.Snapshot{Revision: 5, Items: []memory.Item{}}}
	generator := &testChatGenerator{}
	router := NewRouter(nil, Dependencies{Auth: testAuthAPI{user: auth.User{ID: "owner"}}, Memory: store, Chat: generator})
	body := `{"memory_revision":5,"messages":[{"role":"user","content":"Hello"},{"role":"assistant","content":"Hi"},{"role":"user","content":"Continue"}]}`
	if memoryRequest(router, "POST", "/v1/chat", body, true).Code != 200 || len(generator.request.Messages) != 3 {
		t.Fatal("matching conversation context was discarded")
	}
	store.err = errors.New("memory database unavailable")
	generator.calls = 0
	if memoryRequest(router, "POST", "/v1/chat", body, true).Code != 503 || generator.calls != 0 {
		t.Fatal("AI was called without verifying memory consent")
	}
}
