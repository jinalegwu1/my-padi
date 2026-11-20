package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/jinalegwu1/my-padi/backend/internal/checkins"
)

type CheckInPreferencesAPI interface {
	Get(context.Context, string) (checkins.Preferences, error)
	Update(context.Context, string, checkins.PreferencesPatch) (checkins.Preferences, error)
}

type checkInPreferencesHandler struct {
	auth        AuthAPI
	preferences CheckInPreferencesAPI
	logger      *slog.Logger
}

func registerCheckInPreferencesRoute(mux *http.ServeMux, auth AuthAPI, preferences CheckInPreferencesAPI, logger *slog.Logger) {
	mux.Handle("/v1/check-ins/preferences", checkInPreferencesHandler{
		auth: auth, preferences: preferences, logger: logger,
	})
}

func (handler checkInPreferencesHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPatch {
		w.Header().Set("Allow", "GET, PATCH")
		writeAPIError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Use GET or PATCH.")
		return
	}
	if handler.auth == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "auth_unavailable", "Sign-in is not configured.")
		return
	}
	token, ok := bearerToken(r)
	if !ok {
		writeAPIError(w, http.StatusUnauthorized, "unauthenticated", "Sign in to manage check-in reminders.")
		return
	}
	user, err := handler.auth.Authenticate(r.Context(), token)
	if err != nil {
		writeAuthError(w, err, handler.logger)
		return
	}
	if handler.preferences == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "check_ins_unavailable", "Check-in reminders are temporarily unavailable.")
		return
	}
	if r.Method == http.MethodGet {
		result, err := handler.preferences.Get(r.Context(), user.ID)
		if err != nil {
			handler.fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
		return
	}
	var patch checkins.PreferencesPatch
	if decodeRequest(w, r, maxAuthBodyBytes, &patch) != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid_check_ins", "The check-in preferences are invalid.")
		return
	}
	patch, err = checkins.NormalizePreferencesPatch(patch)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid_check_ins", "Choose valid check-in times and a supported timezone.")
		return
	}
	result, err := handler.preferences.Update(r.Context(), user.ID, patch)
	if err != nil {
		handler.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (handler checkInPreferencesHandler) fail(w http.ResponseWriter, err error) {
	if errors.Is(err, checkins.ErrInvalidPreferences) {
		writeAPIError(w, http.StatusBadRequest, "invalid_check_ins", "Choose valid check-in times and a supported timezone.")
		return
	}
	if handler.logger != nil {
		handler.logger.Warn("check-in preferences operation failed", "class", "check_ins_unavailable")
	}
	writeAPIError(w, http.StatusServiceUnavailable, "check_ins_unavailable", "Check-in preferences could not be loaded or saved. Please try again.")
}
