package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jinalegwu1/my-padi/backend/internal/auth"
	"github.com/jinalegwu1/my-padi/backend/internal/personality"
)

type testPersonalityPreferencesAPI struct {
	userID   string
	current  personality.Preferences
	patch    personality.PreferencesPatch
	accounts map[string]personality.Preferences
	err      error
}

func (store *testPersonalityPreferencesAPI) Get(_ context.Context, userID string) (personality.Preferences, error) {
	store.userID = userID
	if store.err != nil {
		return personality.Preferences{}, store.err
	}
	if store.accounts != nil {
		if preferences, ok := store.accounts[userID]; ok {
			return preferences, nil
		}
		return personality.DefaultPreferences(), nil
	}
	return store.current, store.err
}

func (store *testPersonalityPreferencesAPI) Update(_ context.Context, userID string, patch personality.PreferencesPatch) (personality.Preferences, error) {
	store.userID = userID
	store.patch = patch
	if store.err != nil {
		return personality.Preferences{}, store.err
	}
	current := store.current
	if store.accounts != nil {
		current = store.accounts[userID]
		if current == (personality.Preferences{}) {
			current = personality.DefaultPreferences()
		}
	}
	if patch.Humour != nil {
		current.Humour = *patch.Humour
		current.HumourExplicit = true
	}
	if patch.Tone != nil {
		current.Tone = *patch.Tone
	}
	if patch.LearnFromFeedback != nil {
		current.LearnFromFeedback = *patch.LearnFromFeedback
	}
	if store.accounts != nil {
		store.accounts[userID] = current
	} else {
		store.current = current
	}
	return current, nil
}

func TestPersonalityPreferencesAreAccountScopedAndValidated(t *testing.T) {
	store := &testPersonalityPreferencesAPI{current: personality.DefaultPreferences()}
	router := NewRouter(nil, Dependencies{
		Auth:        testAuthAPI{user: auth.User{ID: "owner"}},
		Personality: store,
	})
	for _, test := range []struct {
		method, body string
		wantStatus   int
	}{
		{method: http.MethodGet, wantStatus: http.StatusUnauthorized},
		{method: http.MethodPatch, body: `{"humour":"unlimited"}`, wantStatus: http.StatusBadRequest},
		{method: http.MethodPatch, body: `{"tone":"serious","user_id":"other"}`, wantStatus: http.StatusBadRequest},
	} {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(test.method, "/v1/personality/preferences", strings.NewReader(test.body))
		if test.method == http.MethodPatch {
			request.Header.Set("Authorization", "Bearer valid")
		}
		router.ServeHTTP(response, request)
		if response.Code != test.wantStatus {
			t.Fatalf("%s status = %d, want %d", test.method, response.Code, test.wantStatus)
		}
	}
	if store.userID != "" {
		t.Fatal("invalid or unauthenticated preference request reached storage")
	}
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPatch, "/v1/personality/preferences", strings.NewReader(`{"humour":"off","learn_from_feedback":true}`))
	request.Header.Set("Authorization", "Bearer valid")
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK || store.userID != "owner" ||
		store.current.Humour != personality.HumourOff || !store.current.LearnFromFeedback {
		t.Fatalf("response = %d %q, preferences = %+v owner=%q", response.Code, response.Body.String(), store.current, store.userID)
	}
}

func TestPersonalityPreferencesRemainIsolatedBetweenAccounts(t *testing.T) {
	store := &testPersonalityPreferencesAPI{accounts: make(map[string]personality.Preferences)}
	routerFor := func(userID string) http.Handler {
		return NewRouter(nil, Dependencies{
			Auth:        testAuthAPI{user: auth.User{ID: userID}},
			Personality: store,
		})
	}
	send := func(router http.Handler, method, body string) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest(method, "/v1/personality/preferences", strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer valid")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response
	}

	owner := routerFor("owner")
	other := routerFor("other")
	if response := send(owner, http.MethodPatch, `{"humour":"off","learn_from_feedback":true}`); response.Code != http.StatusOK {
		t.Fatalf("owner update = %d %s", response.Code, response.Body.String())
	}
	if response := send(other, http.MethodPatch, `{"tone":"gentle"}`); response.Code != http.StatusOK {
		t.Fatalf("other update = %d %s", response.Code, response.Body.String())
	}

	var ownerPreferences, otherPreferences personality.Preferences
	if response := send(owner, http.MethodGet, ""); response.Code != http.StatusOK ||
		json.Unmarshal(response.Body.Bytes(), &ownerPreferences) != nil {
		t.Fatalf("owner read = %d %s", response.Code, response.Body.String())
	}
	if response := send(other, http.MethodGet, ""); response.Code != http.StatusOK ||
		json.Unmarshal(response.Body.Bytes(), &otherPreferences) != nil {
		t.Fatalf("other read = %d %s", response.Code, response.Body.String())
	}
	if ownerPreferences.Humour != personality.HumourOff || !ownerPreferences.LearnFromFeedback ||
		otherPreferences.Humour != personality.HumourOccasional || otherPreferences.Tone != personality.ToneGentle ||
		otherPreferences.LearnFromFeedback {
		t.Fatalf("preferences crossed accounts: owner=%+v other=%+v", ownerPreferences, otherPreferences)
	}
}

func TestPersonalityPreferenceFailureIsExplicit(t *testing.T) {
	store := &testPersonalityPreferencesAPI{err: errors.New("private database detail")}
	router := NewRouter(nil, Dependencies{Auth: testAuthAPI{user: auth.User{ID: "owner"}}, Personality: store})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/personality/preferences", nil)
	request.Header.Set("Authorization", "Bearer valid")
	router.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable || strings.Contains(response.Body.String(), "private database detail") {
		t.Fatalf("response = %d %q", response.Code, response.Body.String())
	}
}
