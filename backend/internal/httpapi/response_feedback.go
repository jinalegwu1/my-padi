package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/jinalegwu1/my-padi/backend/internal/personality"
)

type ResponseFeedbackAPI interface {
	Submit(context.Context, string, personality.Feedback) error
	RecentHumourFeedback(context.Context, string) (personality.FeedbackTrend, error)
}

type responseFeedbackHandler struct {
	auth     AuthAPI
	feedback ResponseFeedbackAPI
	logger   *slog.Logger
}

func registerResponseFeedbackRoute(mux *http.ServeMux, auth AuthAPI, feedback ResponseFeedbackAPI, logger *slog.Logger) {
	mux.Handle("POST /v1/personality/feedback", responseFeedbackHandler{auth: auth, feedback: feedback, logger: logger})
}

func (handler responseFeedbackHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if handler.auth == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "auth_unavailable", "Sign-in is not configured.")
		return
	}
	token, ok := bearerToken(r)
	if !ok {
		writeAPIError(w, http.StatusUnauthorized, "unauthenticated", "Sign in to send response feedback.")
		return
	}
	user, err := handler.auth.Authenticate(r.Context(), token)
	if err != nil {
		writeAuthError(w, err, handler.logger)
		return
	}
	if handler.feedback == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "feedback_unavailable", "Response feedback is temporarily unavailable.")
		return
	}
	var feedback personality.Feedback
	if decodeRequest(w, r, maxAuthBodyBytes, &feedback) != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid_feedback", "The response feedback is invalid.")
		return
	}
	feedback, err = personality.NormalizeFeedback(feedback)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid_feedback", "Choose a supported response rating.")
		return
	}
	if err := handler.feedback.Submit(r.Context(), user.ID, feedback); err != nil {
		if errors.Is(err, personality.ErrInvalidFeedback) {
			writeAPIError(w, http.StatusBadRequest, "invalid_feedback", "Choose a supported response rating.")
			return
		}
		if errors.Is(err, personality.ErrFeedbackRateLimited) {
			writeAPIError(w, http.StatusTooManyRequests, "feedback_rate_limited", "You have sent the maximum response feedback for today.")
			return
		}
		if handler.logger != nil {
			handler.logger.Warn("response feedback failed", "class", "feedback_unavailable")
		}
		writeAPIError(w, http.StatusServiceUnavailable, "feedback_unavailable", "Response feedback could not be saved. Please try again.")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}
