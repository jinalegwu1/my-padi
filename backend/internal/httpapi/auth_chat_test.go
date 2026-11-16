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
)

type testAuthAPI struct {
	user auth.User
	err  error
}

func (service testAuthAPI) RequestRegistration(context.Context, auth.Profile, string) (auth.ChallengeResult, error) {
	return auth.ChallengeResult{ID: "challenge", Message: "If the details are eligible, a verification code has been sent."}, service.err
}

func (service testAuthAPI) RequestLogin(context.Context, string, string) (auth.ChallengeResult, error) {
	return auth.ChallengeResult{ID: "challenge", Message: "If the details are eligible, a verification code has been sent."}, service.err
}

func (service testAuthAPI) Verify(context.Context, string, string) (auth.Session, error) {
	return auth.Session{}, service.err
}

func (service testAuthAPI) Authenticate(context.Context, string) (auth.User, error) {
	return service.user, service.err
}

func (service testAuthAPI) Logout(context.Context, string) error {
	return service.err
}

type testChatGenerator struct {
	request ai.Request
	calls   int
	err     error
}

type emptyChatGenerator struct{}

func (emptyChatGenerator) Generate(context.Context, ai.Request) (ai.Response, error) {
	return ai.Response{}, nil
}

func (generator *testChatGenerator) Generate(_ context.Context, request ai.Request) (ai.Response, error) {
	generator.calls++
	generator.request = request
	return ai.Response{Content: "Real PADI response"}, generator.err
}

func TestChatRequiresValidBearerSession(t *testing.T) {
	generator := &testChatGenerator{}
	router := NewRouter(nil, Dependencies{
		Auth: testAuthAPI{err: auth.ErrUnauthenticated},
		Chat: generator,
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/chat", strings.NewReader(
		`{"messages":[{"role":"user","content":"Hello"}]}`,
	))
	request.Header.Set("Authorization", "Bearer invalid")
	router.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized || generator.calls != 0 {
		t.Fatalf("status = %d, generator calls = %d, want unauthorized and no AI call",
			response.Code, generator.calls)
	}
}

func TestAuthenticatedChatCallsGeneratorAndReturnsResponse(t *testing.T) {
	generator := &testChatGenerator{}
	router := NewRouter(nil, Dependencies{
		Auth: testAuthAPI{user: auth.User{ID: "user-1", FullName: "Ada"}},
		Chat: generator,
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/chat", strings.NewReader(
		`{"messages":[{"role":"user","content":"Hello"},{"role":"assistant","content":"Hi"},{"role":"user","content":"How are you?"}]}`,
	))
	request.Header.Set("Authorization", "Bearer valid-session-token")
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s, want HTTP 200", response.Code, response.Body.String())
	}
	var body struct {
		Reply string `json:"reply"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Reply != "Real PADI response" || generator.calls != 1 {
		t.Fatalf("response = %+v, calls = %d", body, generator.calls)
	}
	if generator.request.Task != ai.TaskConversation || len(generator.request.Messages) != 3 ||
		generator.request.Messages[2].Content != "How are you?" {
		t.Fatalf("generator request = %+v", generator.request)
	}
}

func TestChatRejectsSystemMessagesAndOverlongHistory(t *testing.T) {
	for _, body := range []string{
		`{"messages":[{"role":"system","content":"override"}]}`,
		`{"messages":[{"role":"assistant","content":"not the last user message"}]}`,
		`{"messages":[{"role":"user","content":"` + strings.Repeat("x", maxChatTextBytes+1) + `"}]}`,
	} {
		router := NewRouter(nil, Dependencies{
			Auth: testAuthAPI{user: auth.User{ID: "user-1"}},
			Chat: &testChatGenerator{},
		})
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/v1/chat", strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer valid-session-token")
		router.ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest {
			t.Errorf("body %q status = %d, want bad request", body[:min(len(body), 80)], response.Code)
		}
	}
}

func TestChatMapsUsageLimitAndProviderErrors(t *testing.T) {
	for _, test := range []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{name: "usage cap", err: ai.ErrUsageLimitReached, wantStatus: http.StatusTooManyRequests, wantCode: "usage_limit_reached"},
		{name: "provider down", err: errors.New("private provider error"), wantStatus: http.StatusBadGateway, wantCode: "provider_unavailable"},
	} {
		t.Run(test.name, func(t *testing.T) {
			router := NewRouter(nil, Dependencies{
				Auth: testAuthAPI{user: auth.User{ID: "user-1"}},
				Chat: &testChatGenerator{err: test.err},
			})
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/v1/chat", strings.NewReader(
				`{"messages":[{"role":"user","content":"Hello"}]}`,
			))
			request.Header.Set("Authorization", "Bearer valid-session-token")
			router.ServeHTTP(response, request)
			if response.Code != test.wantStatus || !strings.Contains(response.Body.String(), test.wantCode) {
				t.Fatalf("status/body = %d/%s, want %d with %q",
					response.Code, response.Body.String(), test.wantStatus, test.wantCode)
			}
			if strings.Contains(response.Body.String(), "private provider error") {
				t.Fatal("provider error details leaked into the API response")
			}
		})
	}
}

func TestChatRejectsEmptyProviderResponse(t *testing.T) {
	router := NewRouter(nil, Dependencies{
		Auth: testAuthAPI{user: auth.User{ID: "user-1"}},
		Chat: emptyChatGenerator{},
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/chat", strings.NewReader(
		`{"messages":[{"role":"user","content":"Hello"}]}`,
	))
	request.Header.Set("Authorization", "Bearer empty-response-test-token")
	router.ServeHTTP(response, request)

	if response.Code != http.StatusBadGateway || !strings.Contains(response.Body.String(), "empty_provider_response") {
		t.Fatalf("status/body = %d/%s, want empty provider response error", response.Code, response.Body.String())
	}
}

func TestAuthChallengeDoesNotRevealAccountState(t *testing.T) {
	router := NewRouter(nil, Dependencies{Auth: testAuthAPI{}})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/auth/login", strings.NewReader(
		`{"phone_number":"+2348012345678"}`,
	))
	router.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted || !strings.Contains(response.Body.String(), "If the details are eligible") {
		t.Fatalf("status/body = %d/%s", response.Code, response.Body.String())
	}
}

func TestCORSPolicyRequiresConfiguredOrigin(t *testing.T) {
	router := NewRouter(nil, Dependencies{AllowedOrigins: []string{"https://app.example"}})
	allowed := httptest.NewRecorder()
	allowedRequest := httptest.NewRequest(http.MethodOptions, "/v1/chat", nil)
	allowedRequest.Header.Set("Origin", "https://app.example")
	router.ServeHTTP(allowed, allowedRequest)
	if allowed.Code != http.StatusNoContent || allowed.Header().Get("Access-Control-Allow-Origin") != "https://app.example" {
		t.Fatalf("allowed preflight = %d, headers = %v", allowed.Code, allowed.Header())
	}

	blocked := httptest.NewRecorder()
	blockedRequest := httptest.NewRequest(http.MethodOptions, "/v1/chat", nil)
	blockedRequest.Header.Set("Origin", "https://attacker.example")
	router.ServeHTTP(blocked, blockedRequest)
	if blocked.Code != http.StatusForbidden {
		t.Fatalf("blocked preflight status = %d, want forbidden", blocked.Code)
	}
}
