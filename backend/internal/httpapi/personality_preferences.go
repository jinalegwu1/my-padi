package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/jinalegwu1/my-padi/backend/internal/personality"
)

type PersonalityPreferencesAPI interface {
	Get(context.Context, string) (personality.Preferences, error)
	Update(context.Context, string, personality.PreferencesPatch) (personality.Preferences, error)
}

type personalityPreferencesHandler struct {
	auth        AuthAPI
	preferences PersonalityPreferencesAPI
	logger      *slog.Logger
}

func registerPersonalityPreferencesRoute(mux *http.ServeMux, auth AuthAPI, preferences PersonalityPreferencesAPI, logger *slog.Logger) {
	mux.Handle("/v1/personality/preferences", personalityPreferencesHandler{
		auth: auth, preferences: preferences, logger: logger,
	})
}

func (handler personalityPreferencesHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
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
		writeAPIError(w, http.StatusUnauthorized, "unauthenticated", "Sign in to manage your conversation preferences.")
		return
	}
	user, err := handler.auth.Authenticate(r.Context(), token)
	if err != nil {
		writeAuthError(w, err, handler.logger)
		return
	}
	if handler.preferences == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "preferences_unavailable", "Conversation preferences are temporarily unavailable.")
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
	var patch personality.PreferencesPatch
	if decodeRequest(w, r, maxAuthBodyBytes, &patch) != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid_preferences", "The conversation preferences are invalid.")
		return
	}
	patch, err = personality.NormalizePreferencesPatch(patch)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid_preferences", "Choose supported humour and conversation tone preferences.")
		return
	}
	result, err := handler.preferences.Update(r.Context(), user.ID, patch)
	if err != nil {
		handler.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (handler personalityPreferencesHandler) fail(w http.ResponseWriter, err error) {
	if errors.Is(err, personality.ErrInvalidPreferences) {
		writeAPIError(w, http.StatusBadRequest, "invalid_preferences", "Choose supported humour and conversation tone preferences.")
		return
	}
	if handler.logger != nil {
		handler.logger.Warn("personality preference operation failed", "class", "preferences_unavailable")
	}
	writeAPIError(w, http.StatusServiceUnavailable, "preferences_unavailable", "Conversation preferences could not be loaded or saved. Please try again.")
}
