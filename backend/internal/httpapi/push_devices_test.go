package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jinalegwu1/my-padi/backend/internal/auth"
	"github.com/jinalegwu1/my-padi/backend/internal/push"
)

type testPushDeviceAPI struct {
	registrations map[string]push.Registration
	owners        map[string]string
}

func (store *testPushDeviceAPI) Register(_ context.Context, userID string, registration push.Registration) error {
	if store.registrations == nil {
		store.registrations = make(map[string]push.Registration)
		store.owners = make(map[string]string)
	}
	store.registrations[registration.DeviceID] = registration
	store.owners[registration.DeviceID] = userID
	return nil
}

func (store *testPushDeviceAPI) Unregister(_ context.Context, userID, deviceID string) error {
	if store.owners[deviceID] == userID {
		delete(store.registrations, deviceID)
		delete(store.owners, deviceID)
	}
	return nil
}

func TestPushDeviceRegistrationRequiresAuthenticationAndValidatesToken(t *testing.T) {
	store := &testPushDeviceAPI{}
	router := NewRouter(nil, Dependencies{
		Auth:        testAuthAPI{user: auth.User{ID: "owner"}},
		PushDevices: store,
	})
	for _, test := range []struct {
		token  string
		status int
	}{
		{token: "not-an-expo-token", status: http.StatusBadRequest},
		{token: "ExpoPushToken[valid_123]", status: http.StatusNoContent},
	} {
		request := httptest.NewRequest(http.MethodPost, "/v1/push/devices", strings.NewReader(
			`{"device_id":"padi_device_install_123","expo_push_token":"`+test.token+`","platform":"ios","language":"en-NG"}`,
		))
		request.Header.Set("Authorization", "Bearer valid")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != test.status {
			t.Fatalf("token %q status = %d body=%s, want %d", test.token, response.Code, response.Body.String(), test.status)
		}
		if strings.Contains(response.Body.String(), "ExpoPushToken") {
			t.Fatal("push token was echoed in the API response")
		}
	}
	if got := store.owners["padi_device_install_123"]; got != "owner" {
		t.Fatalf("device owner = %q, want authenticated account owner", got)
	}

	request := httptest.NewRequest(http.MethodPost, "/v1/push/devices", strings.NewReader(
		`{"device_id":"padi_device_install_456","expo_push_token":"ExpoPushToken[valid_456]","platform":"web","language":"en-NG"}`,
	))
	request.Header.Set("Authorization", "Bearer valid")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("unsupported platform status = %d, want bad request", response.Code)
	}

	request = httptest.NewRequest(http.MethodPost, "/v1/push/devices", strings.NewReader(
		`{"device_id":"padi_device_install_789","expo_push_token":"ExpoPushToken[valid_789]","platform":"android","language":"en-NG"}`,
	))
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated registration status = %d, want unauthorized", response.Code)
	}
}

func TestPushDeviceRemovalIsAccountScoped(t *testing.T) {
	store := &testPushDeviceAPI{}
	routerFor := func(userID string) http.Handler {
		return NewRouter(nil, Dependencies{
			Auth:        testAuthAPI{user: auth.User{ID: userID}},
			PushDevices: store,
		})
	}
	register := httptest.NewRequest(http.MethodPost, "/v1/push/devices", strings.NewReader(
		`{"device_id":"padi_device_install_123","expo_push_token":"ExpoPushToken[valid_123]","platform":"ios","language":"en-NG"}`,
	))
	register.Header.Set("Authorization", "Bearer valid")
	registerResponse := httptest.NewRecorder()
	routerFor("owner").ServeHTTP(registerResponse, register)
	if registerResponse.Code != http.StatusNoContent {
		t.Fatalf("registration status = %d %s", registerResponse.Code, registerResponse.Body.String())
	}

	remove := func(router http.Handler) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodDelete, "/v1/push/devices", strings.NewReader(
			`{"device_id":"padi_device_install_123"}`,
		))
		request.Header.Set("Authorization", "Bearer valid")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response
	}
	if response := remove(routerFor("other")); response.Code != http.StatusNoContent {
		t.Fatalf("other account removal = %d %s", response.Code, response.Body.String())
	}
	if store.owners["padi_device_install_123"] != "owner" {
		t.Fatal("another account removed the registered device")
	}
	if response := remove(routerFor("owner")); response.Code != http.StatusNoContent {
		t.Fatalf("owner removal = %d %s", response.Code, response.Body.String())
	}
	if _, exists := store.registrations["padi_device_install_123"]; exists {
		t.Fatal("owner device registration remains after removal")
	}
}
