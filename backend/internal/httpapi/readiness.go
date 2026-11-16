package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"
)

type readinessResponse struct {
	Status  string `json:"status"`
	Service string `json:"service"`
}

func ready(checker ReadinessChecker) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}

		if checker == nil {
			writeReadiness(w, http.StatusServiceUnavailable, "not_ready")
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := checker.PingContext(ctx); err != nil {
			slog.Error("PostgreSQL readiness check failed", "error", err)
			writeReadiness(w, http.StatusServiceUnavailable, "not_ready")
			return
		}

		writeReadiness(w, http.StatusOK, "ready")
	}
}

func writeReadiness(w http.ResponseWriter, statusCode int, status string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(readinessResponse{
		Status:  status,
		Service: "padi-api",
	}); err != nil {
		slog.Error("failed to write readiness response", "error", err)
	}
}
