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
	"github.com/jinalegwu1/my-padi/backend/internal/checkins"
)

type testCheckInPreferencesAPI struct {
	userID   string
	current  checkins.Preferences
	patch    checkins.PreferencesPatch
	accounts map[string]checkins.Preferences
	err      error
}

func (store *testCheckInPreferencesAPI) Get(_ context.Context, userID string) (checkins.Preferences, error) {
	store.userID = userID
	if store.err != nil {
		return checkins.Preferences{}, store.err
	}
	if store.accounts != nil {
		if preferences, ok := store.accounts[userID]; ok {
			return preferences, nil
		}
		return checkins.DefaultPreferences(), nil
	}
	return store.current, store.err
}

func (store *testCheckInPreferencesAPI) Update(_ context.Context, userID string, patch checkins.PreferencesPatch) (checkins.Preferences, error) {
	store.userID = userID
	store.patch = patch
	if store.err != nil {
		return checkins.Preferences{}, store.err
	}
	current := store.current
	if store.accounts != nil {
		current = store.accounts[userID]
		if current == (checkins.Preferences{}) {
			current = checkins.DefaultPreferences()
		}
	}
	if patch.MorningEnabled != nil {
		current.MorningEnabled = *patch.MorningEnabled
	}
	if patch.MorningTime != nil {
		current.MorningTime = *patch.MorningTime
	}
	if patch.EveningEnabled != nil {
		current.EveningEnabled = *patch.EveningEnabled
	}
	if patch.EveningTime != nil {
		current.EveningTime = *patch.EveningTime
	}
	if patch.Timezone != nil {
		current.Timezone = *patch.Timezone
	}
	if store.accounts != nil {
		store.accounts[userID] = current
	} else {
		store.current = current
	}
	return current, nil
}

func TestCheckInPreferencesAreAuthenticatedAndAccountScoped(t *testing.T) {
	store := &testCheckInPreferencesAPI{current: checkins.DefaultPreferences()}
	router := NewRouter(nil, Dependencies{
		Auth:     testAuthAPI{user: auth.User{ID: "owner"}},
		CheckIns: store,
	})
	for _, test := range []struct {
		method, body string
		status       int
	}{
		{method: http.MethodGet, status: http.StatusUnauthorized},
		{method: http.MethodPatch, body: `{"morning_enabled":true,"timezone":"Africa/Lagos"}`, status: http.StatusUnauthorized},
	} {
		request := httptest.NewRequest(test.method, "/v1/check-ins/preferences", strings.NewReader(test.body))
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != test.status {
			t.Fatalf("%s without token = %d, want %d", test.method, response.Code, test.status)
		}
	}
	request := httptest.NewRequest(http.MethodPatch, "/v1/check-ins/preferences", strings.NewReader(`{"morning_enabled":true,"timezone":"Africa/Lagos"}`))
	request.Header.Set("Authorization", "Bearer valid")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK || store.userID != "owner" || store.current.Timezone != "Africa/Lagos" || !store.current.MorningEnabled {
		t.Fatalf("status = %d, owner = %q, preferences = %+v", response.Code, store.userID, store.current)
	}
}

func TestCheckInPreferencesRemainIsolatedBetweenAccounts(t *testing.T) {
	store := &testCheckInPreferencesAPI{accounts: make(map[string]checkins.Preferences)}
	routerFor := func(userID string) http.Handler {
		return NewRouter(nil, Dependencies{
			Auth:     testAuthAPI{user: auth.User{ID: userID}},
			CheckIns: store,
		})
	}
	send := func(router http.Handler, method, body string) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest(method, "/v1/check-ins/preferences", strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer valid")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response
	}

	owner := routerFor("owner")
	other := routerFor("other")
	if response := send(owner, http.MethodPatch, `{"morning_enabled":true,"morning_time":"07:30","timezone":"Africa/Lagos"}`); response.Code != http.StatusOK {
		t.Fatalf("owner update = %d %s", response.Code, response.Body.String())
	}
	if response := send(other, http.MethodPatch, `{"evening_enabled":true,"timezone":"Europe/London"}`); response.Code != http.StatusOK {
		t.Fatalf("other update = %d %s", response.Code, response.Body.String())
	}

	var ownerPreferences, otherPreferences checkins.Preferences
	if response := send(owner, http.MethodGet, ""); response.Code != http.StatusOK ||
		json.Unmarshal(response.Body.Bytes(), &ownerPreferences) != nil {
		t.Fatalf("owner read = %d %s", response.Code, response.Body.String())
	}
	if response := send(other, http.MethodGet, ""); response.Code != http.StatusOK ||
		json.Unmarshal(response.Body.Bytes(), &otherPreferences) != nil {
		t.Fatalf("other read = %d %s", response.Code, response.Body.String())
	}
	if !ownerPreferences.MorningEnabled || ownerPreferences.EveningEnabled ||
		ownerPreferences.Timezone != "Africa/Lagos" ||
		otherPreferences.MorningEnabled || !otherPreferences.EveningEnabled ||
		otherPreferences.Timezone != "Europe/London" {
		t.Fatalf("check-in preferences crossed accounts: owner=%+v other=%+v", ownerPreferences, otherPreferences)
	}
}

func TestCheckInPreferencesRejectInvalidInputAndHideStoreErrors(t *testing.T) {
	store := &testCheckInPreferencesAPI{current: checkins.DefaultPreferences()}
	router := NewRouter(nil, Dependencies{Auth: testAuthAPI{user: auth.User{ID: "owner"}}, CheckIns: store})
	for _, body := range []string{
		`{}`,
		`{"evening_time":"24:00"}`,
		`{"timezone":"../../etc/passwd"}`,
	} {
		request := httptest.NewRequest(http.MethodPatch, "/v1/check-ins/preferences", strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer valid")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("invalid input %s returned %d", body, response.Code)
		}
	}
	store.err = errors.New("private database detail")
	request := httptest.NewRequest(http.MethodGet, "/v1/check-ins/preferences", nil)
	request.Header.Set("Authorization", "Bearer valid")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable || strings.Contains(response.Body.String(), "private database detail") {
		t.Fatalf("store error response = %d %q", response.Code, response.Body.String())
	}
}
