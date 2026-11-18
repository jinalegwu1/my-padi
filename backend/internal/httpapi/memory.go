package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/jinalegwu1/my-padi/backend/internal/auth"
	"github.com/jinalegwu1/my-padi/backend/internal/memory"
)

type MemoryAPI interface {
	Snapshot(context.Context, string) (memory.Snapshot, error)
	SetEnabled(context.Context, string, bool) (memory.Snapshot, error)
	Create(context.Context, string, memory.Draft) (memory.Snapshot, error)
	Update(context.Context, string, string, memory.Update) (memory.Snapshot, error)
	Delete(context.Context, string, string) (memory.Snapshot, error)
}

type memoryHandlers struct {
	auth   AuthAPI
	memory MemoryAPI
	logger *slog.Logger
}

func registerMemoryRoutes(mux *http.ServeMux, auth AuthAPI, service MemoryAPI, logger *slog.Logger) {
	handlers := memoryHandlers{auth, service, logger}
	mux.HandleFunc("/v1/memory", handlers.collection)
	mux.HandleFunc("/v1/memory/settings", handlers.settings)
	mux.HandleFunc("/v1/memory/{id}", handlers.item)
}

func (handlers memoryHandlers) user(w http.ResponseWriter, r *http.Request) (auth.User, bool) {
	if handlers.auth == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "auth_unavailable", "Sign-in is not configured.")
		return auth.User{}, false
	}
	token, ok := bearerToken(r)
	if !ok {
		writeAPIError(w, http.StatusUnauthorized, "unauthenticated", "Sign in to manage your memory.")
		return auth.User{}, false
	}
	user, err := handlers.auth.Authenticate(r.Context(), token)
	if err != nil {
		writeAuthError(w, err, handlers.logger)
		return auth.User{}, false
	}
	if handlers.memory == nil {
		writeMemoryError(w, errors.New("memory is unavailable"), handlers.logger)
		return auth.User{}, false
	}
	return user, true
}

func (handlers memoryHandlers) collection(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		w.Header().Set("Allow", "GET, POST")
		writeAPIError(w, http.StatusMethodNotAllowed, "invalid_method", "Use GET or POST.")
		return
	}
	user, ok := handlers.user(w, r)
	if !ok {
		return
	}
	var result memory.Snapshot
	var err error
	if r.Method == http.MethodGet {
		result, err = handlers.memory.Snapshot(r.Context(), user.ID)
	} else {
		var draft memory.Draft
		if decodeRequest(w, r, maxAuthBodyBytes, &draft) != nil {
			writeMemoryError(w, memory.ErrInvalid, handlers.logger)
			return
		}
		draft, err = memory.Normalize(draft)
		if err == nil {
			result, err = handlers.memory.Create(r.Context(), user.ID, draft)
		}
	}
	if err != nil {
		writeMemoryError(w, err, handlers.logger)
		return
	}
	status := http.StatusOK
	if r.Method == http.MethodPost {
		status = http.StatusCreated
	}
	writeJSON(w, status, result)
}

func (handlers memoryHandlers) settings(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPatch) {
		return
	}
	user, ok := handlers.user(w, r)
	if !ok {
		return
	}
	var body struct {
		Enabled *bool `json:"enabled"`
	}
	if decodeRequest(w, r, maxAuthBodyBytes, &body) != nil || body.Enabled == nil {
		writeMemoryError(w, memory.ErrInvalid, handlers.logger)
		return
	}
	result, err := handlers.memory.SetEnabled(r.Context(), user.ID, *body.Enabled)
	if err != nil {
		writeMemoryError(w, err, handlers.logger)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (handlers memoryHandlers) item(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch && r.Method != http.MethodDelete {
		w.Header().Set("Allow", "PATCH, DELETE")
		writeAPIError(w, http.StatusMethodNotAllowed, "invalid_method", "Use PATCH or DELETE.")
		return
	}
	user, ok := handlers.user(w, r)
	if !ok {
		return
	}
	var result memory.Snapshot
	var err error
	if r.Method == http.MethodDelete {
		result, err = handlers.memory.Delete(r.Context(), user.ID, r.PathValue("id"))
	} else {
		var update memory.Update
		if decodeRequest(w, r, maxAuthBodyBytes, &update) != nil {
			writeMemoryError(w, memory.ErrInvalid, handlers.logger)
			return
		}
		update, err = memory.NormalizeUpdate(update)
		if err == nil {
			result, err = handlers.memory.Update(r.Context(), user.ID, r.PathValue("id"), update)
		}
	}
	if err != nil {
		writeMemoryError(w, err, handlers.logger)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func writeMemoryError(w http.ResponseWriter, err error, logger *slog.Logger) {
	switch {
	case errors.Is(err, memory.ErrInvalid):
		writeAPIError(w, http.StatusBadRequest, "invalid_memory", "Choose a category, a label of 1–100 characters, and a memory of 1–500 characters. New memories require your approval.")
	case errors.Is(err, memory.ErrDisabled):
		writeAPIError(w, http.StatusForbidden, "memory_disabled", "Enable personal memory before saving a new fact.")
	case errors.Is(err, memory.ErrNotFound):
		writeAPIError(w, http.StatusNotFound, "memory_not_found", "That memory is no longer available.")
	case errors.Is(err, memory.ErrFull):
		writeAPIError(w, http.StatusConflict, "memory_full", "You can keep up to 100 memories. Remove one before saving another.")
	default:
		if logger != nil {
			logger.Warn("memory operation failed", "class", "memory_unavailable")
		}
		writeAPIError(w, http.StatusServiceUnavailable, "memory_unavailable", "Personal memory is temporarily unavailable. Please try again.")
	}
}
