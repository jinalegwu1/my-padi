package httpapi

import "net/http"

// NewRouter registers the API routes. Unregistered paths return HTTP 404.
func NewRouter() http.Handler {
	mux := http.NewServeMux()
	// Check methods in the handler because GET patterns also accept HEAD.
	mux.HandleFunc("/health", health)
	return mux
}
