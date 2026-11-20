package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jinalegwu1/my-padi/backend/internal/ai"
	"github.com/jinalegwu1/my-padi/backend/internal/auth"
)

type testAuthAPI struct {
	user   auth.User
	err    error
	result *auth.ChallengeResult
}

func (service testAuthAPI) RequestRegistration(context.Context, auth.Profile, string) (auth.ChallengeResult, error) {
	if service.result != nil {
		return *service.result, service.err
	}
	return auth.ChallengeResult{ID: "challenge", Message: "If the details are eligible, a verification code has been sent."}, service.err
}

func (service testAuthAPI) RequestLogin(context.Context, string, string) (auth.ChallengeResult, error) {
	if service.result != nil {
		return *service.result, service.err
	}
	return auth.ChallengeResult{ID: "challenge", Message: "If the details are eligible, a verification code has been sent."}, service.err
}

func TestDevelopmentAuthEndpointsReturnSessionWithoutChallenge(t *testing.T) {
	session := auth.Session{Token: "development-test-token", ExpiresAt: time.Now().Add(time.Hour), User: auth.User{ID: "test-user", FullName: "Test"}}
	result := auth.ChallengeResult{Message: "OTP disabled for development.", Session: &session}
	for _, test := range []struct{ path, body string }{
		{"/v1/auth/login", `{"phone_number":"+2348012345678"}`},
		{"/v1/auth/register", `{"full_name":"Test","date_of_birth":"1990-01-01","phone_number":"+2348012345678"}`},
	} {
		t.Run(test.path, func(t *testing.T) {
			router := NewRouter(nil, Dependencies{Auth: testAuthAPI{result: &result}, DevelopmentOTPBypass: true})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, test.path, strings.NewReader(test.body)))
			var body struct {
				Session auth.Session `json:"session"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if response.Code != http.StatusOK || body.Session.Token != session.Token || strings.Contains(response.Body.String(), "challenge_id") {
				t.Fatal("development auth did not return HTTP 200 and session without a challenge")
			}
			if response.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("session response permits caching")
			}
		})
	}
}

func TestAuthConfigurationReflectsOTPMode(t *testing.T) {
	for _, bypass := range []bool{false, true} {
		router := NewRouter(nil, Dependencies{DevelopmentOTPBypass: bypass})
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/auth/config", nil))
		var body struct {
			Required bool `json:"otp_required"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if response.Code != http.StatusOK || body.Required == bypass {
			t.Fatal("incorrect OTP configuration")
		}
		wrongMethod := httptest.NewRecorder()
		router.ServeHTTP(wrongMethod, httptest.NewRequest(http.MethodPost, "/v1/auth/config", nil))
		if wrongMethod.Code != http.StatusMethodNotAllowed {
			t.Fatal("auth config accepted unsupported method")
		}
	}
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
	if generator.request.Task != ai.TaskConversation || len(generator.request.Messages) != 4 ||
		generator.request.Messages[0].Role != ai.RoleSystem || !strings.Contains(generator.request.Messages[0].Content, `"account_name":"Ada"`) ||
		generator.request.Messages[3].Content != "How are you?" {
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
		{name: "provider rate limit", err: &ai.ProviderError{Provider: ai.ProviderZAI, Status: http.StatusTooManyRequests}, wantStatus: http.StatusTooManyRequests, wantCode: "provider_rate_limited"},
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
