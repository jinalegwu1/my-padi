package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jinalegwu1/my-padi/backend/internal/ai"
	"github.com/jinalegwu1/my-padi/backend/internal/auth"
)

const (
	maxAuthBodyBytes   = 8 * 1024
	maxChatBodyBytes   = 32 * 1024
	maxChatMessages    = 20
	maxChatTextBytes   = 8 * 1024
	maxChatTotalBytes  = 24 * 1024
	chatRequestTimeout = 2*time.Minute + 30*time.Second
)

type AuthAPI interface {
	RequestRegistration(context.Context, auth.Profile, string) (auth.ChallengeResult, error)
	RequestLogin(context.Context, string, string) (auth.ChallengeResult, error)
	Verify(context.Context, string, string) (auth.Session, error)
	Authenticate(context.Context, string) (auth.User, error)
	Logout(context.Context, string) error
}

type ChatGenerator interface {
	Generate(context.Context, ai.Request) (ai.Response, error)
}

type Dependencies struct {
	Auth           AuthAPI
	Chat           ChatGenerator
	AllowedOrigins []string
	Logger         *slog.Logger
}

type authHandlers struct {
	service AuthAPI
	logger  *slog.Logger
}

func registerAuthRoutes(mux *http.ServeMux, service AuthAPI, logger *slog.Logger) {
	handlers := authHandlers{service: service, logger: logger}
	mux.HandleFunc("/v1/auth/register", handlers.register)
	mux.HandleFunc("/v1/auth/login", handlers.login)
	mux.HandleFunc("/v1/auth/verify", handlers.verify)
	mux.HandleFunc("/v1/auth/logout", handlers.logout)
}

func (handlers authHandlers) register(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	if handlers.service == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "auth_unavailable", "Authentication is not configured.")
		return
	}
	var body struct {
		FullName    string `json:"full_name"`
		DateOfBirth string `json:"date_of_birth"`
		PhoneNumber string `json:"phone_number"`
	}
	if err := decodeRequest(w, r, maxAuthBodyBytes, &body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid_request", "The registration details are invalid.")
		return
	}
	result, err := handlers.service.RequestRegistration(r.Context(), auth.Profile{
		FullName: body.FullName, DateOfBirth: body.DateOfBirth, PhoneNumber: body.PhoneNumber,
	}, sourceIP(r))
	if err != nil {
		writeAuthError(w, err, handlers.logger)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{
		"challenge_id": result.ID,
		"message":      result.Message,
	})
}

func (handlers authHandlers) login(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	if handlers.service == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "auth_unavailable", "Authentication is not configured.")
		return
	}
	var body struct {
		PhoneNumber string `json:"phone_number"`
	}
	if err := decodeRequest(w, r, maxAuthBodyBytes, &body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid_request", "The phone number is invalid.")
		return
	}
	result, err := handlers.service.RequestLogin(r.Context(), body.PhoneNumber, sourceIP(r))
	if err != nil {
		writeAuthError(w, err, handlers.logger)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{
		"challenge_id": result.ID,
		"message":      result.Message,
	})
}

func (handlers authHandlers) verify(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	if handlers.service == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "auth_unavailable", "Authentication is not configured.")
		return
	}
	var body struct {
		ChallengeID string `json:"challenge_id"`
		Code        string `json:"code"`
	}
	if err := decodeRequest(w, r, maxAuthBodyBytes, &body); err != nil || !auth.ValidVerificationCode(body.Code) {
		writeAPIError(w, http.StatusBadRequest, "invalid_request", "The verification details are invalid.")
		return
	}
	session, err := handlers.service.Verify(r.Context(), body.ChallengeID, body.Code)
	if err != nil {
		writeAuthError(w, err, handlers.logger)
		return
	}
	writeJSON(w, http.StatusOK, session)
}

func (handlers authHandlers) logout(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	if handlers.service == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "auth_unavailable", "Authentication is not configured.")
		return
	}
	token, ok := bearerToken(r)
	if !ok {
		writeAPIError(w, http.StatusUnauthorized, "unauthenticated", "Sign in to continue.")
		return
	}
	if err := handlers.service.Logout(r.Context(), token); err != nil {
		writeAuthError(w, err, handlers.logger)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

type chatHandler struct {
	auth   AuthAPI
	chat   ChatGenerator
	logger *slog.Logger
}

func (handler chatHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	if handler.auth == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "auth_unavailable", "Authentication is not configured.")
		return
	}
	token, ok := bearerToken(r)
	if !ok {
		writeAPIError(w, http.StatusUnauthorized, "unauthenticated", "Sign in to continue.")
		return
	}
	if _, err := handler.auth.Authenticate(r.Context(), token); err != nil {
		writeAuthError(w, err, handler.logger)
		return
	}
	if handler.chat == nil {
		writeAPIError(w, http.StatusServiceUnavailable, "ai_unavailable", "PADI chat is not configured yet.")
		return
	}
	var body struct {
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
	}
	if err := decodeRequest(w, r, maxChatBodyBytes, &body); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid_request", "The chat message is invalid.")
		return
	}
	messages, err := validateChatMessages(body.Messages)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), chatRequestTimeout)
	defer cancel()
	response, err := handler.chat.Generate(ctx, ai.Request{
		Messages: messages,
		Task:     ai.TaskConversation,
	})
	if err != nil {
		status, code, message := classifyChatError(err)
		if handler.logger != nil {
			handler.logger.Warn("AI chat request failed", "class", code)
		}
		writeAPIError(w, status, code, message)
		return
	}
	if strings.TrimSpace(response.Content) == "" {
		writeAPIError(w, http.StatusBadGateway, "empty_provider_response", "PADI could not get a response right now. Please try again.")
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Reply string `json:"reply"`
	}{Reply: response.Content})
}

func validateChatMessages(input []struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}) ([]ai.Message, error) {
	if len(input) == 0 || len(input) > maxChatMessages {
		return nil, errors.New("Send up to 20 recent messages, ending with your message.")
	}
	messages := make([]ai.Message, 0, len(input))
	totalBytes := 0
	for _, item := range input {
		if (item.Role != string(ai.RoleUser) && item.Role != string(ai.RoleAssistant)) ||
			!utf8.ValidString(item.Content) || strings.TrimSpace(item.Content) == "" ||
			len(item.Content) > maxChatTextBytes {
			return nil, errors.New("Each message must be valid text with a supported role.")
		}
		totalBytes += len(item.Content)
		if totalBytes > maxChatTotalBytes {
			return nil, errors.New("The conversation context is too long; start a new chat.")
		}
		messages = append(messages, ai.Message{Role: ai.MessageRole(item.Role), Content: item.Content})
	}
	if messages[len(messages)-1].Role != ai.RoleUser {
		return nil, errors.New("The last message must be from you.")
	}
	return messages, nil
}

func classifyChatError(err error) (int, string, string) {
	switch {
	case errors.Is(err, ai.ErrUsageLimitReached):
		return http.StatusTooManyRequests, "usage_limit_reached", "PADI has reached its current AI usage limit. Please try again later."
	case errors.Is(err, ai.ErrUsageLimiterUnavailable):
		return http.StatusServiceUnavailable, "usage_unavailable", "PADI chat is temporarily unavailable."
	case errors.Is(err, context.DeadlineExceeded):
		return http.StatusGatewayTimeout, "provider_timeout", "PADI took too long to respond. Please try again."
	default:
		return http.StatusBadGateway, "provider_unavailable", "PADI could not get a response right now. Please try again."
	}
}

func decodeRequest(w http.ResponseWriter, r *http.Request, maxBytes int64, destination any) error {
	if r.Body == nil {
		return errors.New("request body is required")
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("request must contain exactly one JSON object")
	}
	return nil
}

func bearerToken(r *http.Request) (string, bool) {
	const prefix = "Bearer "
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, prefix) {
		return "", false
	}
	token := strings.TrimSpace(strings.TrimPrefix(header, prefix))
	return token, token != ""
}

func sourceIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}

func requireMethod(w http.ResponseWriter, r *http.Request, method string) bool {
	if r.Method == method {
		return true
	}
	w.Header().Set("Allow", method)
	writeAPIError(w, http.StatusMethodNotAllowed, "method_not_allowed", http.StatusText(http.StatusMethodNotAllowed))
	return false
}

func writeAuthError(w http.ResponseWriter, err error, logger *slog.Logger) {
	switch {
	case errors.Is(err, auth.ErrInvalidProfile):
		writeAPIError(w, http.StatusBadRequest, "invalid_request", err.Error())
	case errors.Is(err, auth.ErrRateLimited):
		writeAPIError(w, http.StatusTooManyRequests, "rate_limited", "Too many verification attempts. Please wait and try again.")
	case errors.Is(err, auth.ErrInvalidChallenge), errors.Is(err, auth.ErrUnauthenticated):
		writeAPIError(w, http.StatusUnauthorized, "unauthenticated", "The verification code or session is invalid or expired.")
	default:
		if logger != nil {
			logger.Error("authentication request failed", "error", err)
		}
		writeAPIError(w, http.StatusServiceUnavailable, "authentication_unavailable", "Authentication is temporarily unavailable.")
	}
}

func writeAPIError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{"error": code, "message": message})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		slog.Error("failed to write API response", "error", fmt.Errorf("encode response: %w", err))
	}
}

func corsMiddleware(next http.Handler, allowedOrigins []string) http.Handler {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		if origin = strings.TrimSpace(origin); origin != "" {
			allowed[origin] = struct{}{}
		}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			if _, ok := allowed[origin]; !ok {
				writeAPIError(w, http.StatusForbidden, "origin_not_allowed", "This origin is not allowed.")
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Max-Age", "600")
			w.Header().Add("Vary", "Origin")
		}
		if r.Method == http.MethodOptions && origin != "" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
