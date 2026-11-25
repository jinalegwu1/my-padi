package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/jinalegwu1/my-padi/backend/internal/push"
)

type PushDeviceAPI interface {
	Register(context.Context, string, push.Registration) error
	Unregister(context.Context, string, string) error
}

type pushDeviceHandler struct {
	auth    AuthAPI
	devices PushDeviceAPI
	logger  *slog.Logger
}

func registerPushDeviceRoute(mux *http.ServeMux, auth AuthAPI, devices PushDeviceAPI, logger *slog.Logger) {
	mux.Handle("/v1/push/devices", pushDeviceHandler{auth: auth, devices: devices, logger: logger})
}

func (handler pushDeviceHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		w.Header().Set("Allow", "POST, DELETE")
		writeAPIError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Use POST or DELETE.")
		return
	}
	if handler.auth == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "auth_unavailable", "Sign-in is not configured.")
		return
	}
	token, ok := bearerToken(r)
	if !ok {
		writeAPIError(w, http.StatusUnauthorized, "unauthenticated", "Sign in to manage push notifications.")
		return
	}
	user, err := handler.auth.Authenticate(r.Context(), token)
	if err != nil {
		writeAuthError(w, err, handler.logger)
		return
	}
	if handler.devices == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "push_unavailable", "Push notifications are temporarily unavailable.")
		return
	}
	if r.Method == http.MethodPost {
		var registration push.Registration
		if decodeRequest(w, r, maxAuthBodyBytes, &registration) != nil {
			writeAPIError(w, http.StatusBadRequest, "invalid_push_device", "The push device registration is invalid.")
			return
		}
		registration, err = push.NormalizeRegistration(registration)
		if err != nil {
			writeAPIError(w, http.StatusBadRequest, "invalid_push_device", "The push device registration is invalid.")
			return
		}
		err = handler.devices.Register(r.Context(), user.ID, registration)
	} else {
		var request struct {
			DeviceID string `json:"device_id"`
		}
		if decodeRequest(w, r, maxAuthBodyBytes, &request) != nil {
			writeAPIError(w, http.StatusBadRequest, "invalid_push_device", "The push device registration is invalid.")
			return
		}
		request.DeviceID, err = push.NormalizeDeviceID(request.DeviceID)
		if err == nil {
			err = handler.devices.Unregister(r.Context(), user.ID, request.DeviceID)
		}
	}
	if errors.Is(err, push.ErrInvalidRegistration) {
		writeAPIError(w, http.StatusBadRequest, "invalid_push_device", "The push device registration is invalid.")
		return
	}
	if err != nil {
		handler.fail(w)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

func (handler pushDeviceHandler) fail(w http.ResponseWriter) {
	if handler.logger != nil {
		handler.logger.Warn("push device operation failed", "class", "push_unavailable")
	}
	writeAPIError(w, http.StatusServiceUnavailable, "push_unavailable", "Push device registration could not be saved. Please try again.")
}
