package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jinalegwu1/my-padi/backend/internal/auth"
	"github.com/jinalegwu1/my-padi/backend/internal/personality"
)

type testResponseFeedbackAPI struct {
	userID   string
	feedback personality.Feedback
	err      error
	calls    int
}

func (store *testResponseFeedbackAPI) Submit(_ context.Context, userID string, feedback personality.Feedback) error {
	store.userID = userID
	store.feedback = feedback
	store.calls++
	return store.err
}

func (store *testResponseFeedbackAPI) RecentHumourFeedback(context.Context, string) (personality.FeedbackTrend, error) {
	return personality.FeedbackTrend{}, nil
}

func TestResponseFeedbackIsAuthenticatedAndAccountScoped(t *testing.T) {
	store := &testResponseFeedbackAPI{}
	router := NewRouter(nil, Dependencies{
		Auth:             testAuthAPI{user: auth.User{ID: "owner"}},
		ResponseFeedback: store,
	})
	for _, authenticated := range []bool{false, true} {
		body := `{"message_id":"padi_ab12_1","rating":"liked_humour"}`
		if !authenticated {
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/v1/personality/feedback", strings.NewReader(body))
			router.ServeHTTP(response, request)
			if response.Code != http.StatusUnauthorized {
				t.Fatalf("unauthenticated feedback status = %d", response.Code)
			}
			continue
		}
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/v1/personality/feedback", strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer valid")
		router.ServeHTTP(response, request)
		if response.Code != http.StatusNoContent || response.Header().Get("Cache-Control") != "no-store" ||
			store.calls != 1 || store.userID != "owner" ||
			store.feedback != (personality.Feedback{MessageID: "padi_ab12_1", Rating: "liked_humour"}) {
			t.Fatalf("response = %d %q, stored feedback = %+v owner=%q", response.Code, response.Body.String(), store.feedback, store.userID)
		}
	}
}

func TestResponseFeedbackRejectsInvalidInputAndReportsStorageFailure(t *testing.T) {
	store := &testResponseFeedbackAPI{}
	router := NewRouter(nil, Dependencies{Auth: testAuthAPI{user: auth.User{ID: "owner"}}, ResponseFeedback: store})
	for _, body := range []string{
		`{"message_id":"padi_1","rating":"unknown"}`,
		`{"message_id":"bad id","rating":"helpful"}`,
		`{"message_id":"padi_1","rating":"helpful","user_id":"other"}`,
	} {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/v1/personality/feedback", strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer valid")
		router.ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("invalid feedback status = %d", response.Code)
		}
	}
	if store.calls != 0 {
		t.Fatal("invalid feedback reached storage")
	}

	store.err = errors.New("database details")
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/personality/feedback", strings.NewReader(`{"message_id":"padi_1","rating":"helpful"}`))
	request.Header.Set("Authorization", "Bearer valid")
	router.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable || strings.Contains(response.Body.String(), "database details") {
		t.Fatalf("storage failure response = %d %q", response.Code, response.Body.String())
	}
}
