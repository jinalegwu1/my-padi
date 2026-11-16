package httpapi

import (
	"context"
	"net/http"
)

// ReadinessChecker reports whether required persistent storage is reachable.
type ReadinessChecker interface {
	PingContext(context.Context) error
}

// NewRouter registers the API routes. Unregistered paths return HTTP 404.
func NewRouter(readiness ReadinessChecker) http.Handler {
	mux := http.NewServeMux()
	// Check methods in the handler because GET patterns also accept HEAD.
	mux.HandleFunc("/health", health)
	mux.HandleFunc("/ready", ready(readiness))
	mux.HandleFunc("/readyz", ready(readiness))
	return mux
}
