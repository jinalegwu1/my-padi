package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"
)

func TestHealthGet(t *testing.T) {
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	NewRouter(nil).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if got := response.Header().Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", got)
	}

	var body map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode health response: %v", err)
	}
	want := map[string]string{"status": "ok", "service": "padi-api"}
	if !reflect.DeepEqual(body, want) {
		t.Errorf("response = %v, want %v", body, want)
	}
}

func TestHealthRejectsUnsupportedMethods(t *testing.T) {
	methods := []string{
		http.MethodPost,
		http.MethodPut,
		http.MethodPatch,
		http.MethodDelete,
		http.MethodHead,
		http.MethodOptions,
		http.MethodTrace,
		http.MethodConnect,
	}
	router := NewRouter(nil)

	for _, method := range methods {
		t.Run(method, func(t *testing.T) {
			response := httptest.NewRecorder()
			request := httptest.NewRequest(method, "/health", nil)
			router.ServeHTTP(response, request)

			if response.Code != http.StatusMethodNotAllowed {
				t.Errorf("status = %d, want %d", response.Code, http.StatusMethodNotAllowed)
			}
			if got := response.Header().Get("Allow"); got != http.MethodGet {
				t.Errorf("Allow = %q, want %q", got, http.MethodGet)
			}
		})
	}
}

func TestUnknownRoutes(t *testing.T) {
	paths := []string{"/", "/missing", "/health/", "/health/extra", "/Health"}
	router := NewRouter(nil)

	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, path, nil)
			router.ServeHTTP(response, request)

			if response.Code != http.StatusNotFound {
				t.Errorf("status = %d, want %d", response.Code, http.StatusNotFound)
			}
		})
	}
}

type readinessCheckerFunc func(context.Context) error

func (check readinessCheckerFunc) PingContext(ctx context.Context) error {
	return check(ctx)
}

func TestReadiness(t *testing.T) {
	tests := []struct {
		name       string
		checker    ReadinessChecker
		wantStatus int
		wantBody   map[string]string
	}{
		{
			name:       "database reachable",
			checker:    readinessCheckerFunc(func(context.Context) error { return nil }),
			wantStatus: http.StatusOK,
			wantBody:   map[string]string{"status": "ready", "service": "padi-api"},
		},
		{
			name:       "database unavailable",
			checker:    readinessCheckerFunc(func(context.Context) error { return errors.New("connection refused") }),
			wantStatus: http.StatusServiceUnavailable,
			wantBody:   map[string]string{"status": "not_ready", "service": "padi-api"},
		},
		{
			name:       "database not configured",
			checker:    nil,
			wantStatus: http.StatusServiceUnavailable,
			wantBody:   map[string]string{"status": "not_ready", "service": "padi-api"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/readyz", nil)
			NewRouter(test.checker).ServeHTTP(response, request)

			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
			}
			if got := response.Header().Get("Content-Type"); got != "application/json" {
				t.Errorf("Content-Type = %q, want application/json", got)
			}

			var body map[string]string
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode readiness response: %v", err)
			}
			if !reflect.DeepEqual(body, test.wantBody) {
				t.Errorf("response = %v, want %v", body, test.wantBody)
			}
		})
	}
}

func TestReadinessRejectsUnsupportedMethods(t *testing.T) {
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/readyz", nil)
	NewRouter(nil).ServeHTTP(response, request)

	if response.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want %d", response.Code, http.StatusMethodNotAllowed)
	}
	if got := response.Header().Get("Allow"); got != http.MethodGet {
		t.Errorf("Allow = %q, want %q", got, http.MethodGet)
	}
}

func TestReadinessLegacyPath(t *testing.T) {
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/ready", nil)
	NewRouter(readinessCheckerFunc(func(context.Context) error { return nil })).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", response.Code, http.StatusOK)
	}
}

func TestReadinessUsesBoundedDatabasePing(t *testing.T) {
	checker := readinessCheckerFunc(func(ctx context.Context) error {
		deadline, ok := ctx.Deadline()
		if !ok {
			t.Error("readiness ping context has no deadline")
			return nil
		}
		remaining := time.Until(deadline)
		if remaining <= 0 || remaining > 2*time.Second {
			t.Errorf("readiness ping deadline is %s away, want at most 2 seconds", remaining)
		}
		return nil
	})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	NewRouter(checker).ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", response.Code, http.StatusOK)
	}
}
