package httpapi

import (
	"context"
	"log/slog"
	"net/http"
)

// ReadinessChecker reports whether required persistent storage is reachable.
type ReadinessChecker interface {
	PingContext(context.Context) error
}

// NewRouter registers the API routes. Unregistered paths return HTTP 404.
func NewRouter(readiness ReadinessChecker, dependencies ...Dependencies) http.Handler {
	mux := http.NewServeMux()
	// Check methods in the handler because GET patterns also accept HEAD.
	mux.HandleFunc("/health", health)
	mux.HandleFunc("/ready", ready(readiness))
	mux.HandleFunc("/readyz", ready(readiness))
	deps := Dependencies{}
	if len(dependencies) > 0 {
		deps = dependencies[0]
	}
	logger := deps.Logger
	if logger == nil {
		logger = slog.Default()
	}
	registerAuthRoutes(mux, deps.Auth, logger)
	mux.HandleFunc("/v1/auth/config", func(w http.ResponseWriter, r *http.Request) {
		if !requireMethod(w, r, http.MethodGet) {
			return
		}
		writeJSON(w, http.StatusOK, struct {
			OTPRequired bool `json:"otp_required"`
		}{OTPRequired: !deps.DevelopmentOTPBypass})
	})
	mux.Handle("/v1/chat", chatHandler{auth: deps.Auth, chat: deps.Chat, logger: logger})
	return corsMiddleware(mux, deps.AllowedOrigins)
}
