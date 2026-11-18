package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/jinalegwu1/my-padi/backend/internal/ai"
	"github.com/jinalegwu1/my-padi/backend/internal/auth"
	"github.com/jinalegwu1/my-padi/backend/internal/config"
	"github.com/jinalegwu1/my-padi/backend/internal/database"
	"github.com/jinalegwu1/my-padi/backend/internal/httpapi"
	"github.com/jinalegwu1/my-padi/backend/internal/voice"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	if err := run(logger); err != nil {
		logger.Error("API stopped with an error", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	cfg := config.Load()
	bypassOTP, err := config.DevelopmentOTPBypass()
	if err != nil {
		return fmt.Errorf("configure OTP verification: %w", err)
	}
	bypassUsageCaps, err := config.DevelopmentAIUsageBypass()
	if err != nil {
		return fmt.Errorf("configure AI usage limits: %w", err)
	}
	aiConfiguration, err := ai.LoadEnvironment()
	if err != nil {
		return fmt.Errorf("load AI provider configuration: %w", err)
	}

	var db *sql.DB
	var readiness httpapi.ReadinessChecker
	var authService *auth.Service
	var memoryStore httpapi.MemoryAPI
	if cfg.DatabaseURL != "" {
		openContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		openedDB, err := database.Open(openContext, cfg.DatabaseURL)
		cancel()
		if err != nil {
			return fmt.Errorf("connect to PostgreSQL: %w", err)
		}
		db = openedDB
		defer func() {
			if err := db.Close(); err != nil {
				logger.Error("failed to close PostgreSQL connection pool", "error", err)
			}
		}()
		readiness = db
		logger.Info("PostgreSQL connection established")
		authService, err = configureAuthentication(db, bypassOTP)
		if err != nil {
			return fmt.Errorf("configure authentication: %w", err)
		}
		memoryContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		store, err := database.NewMemoryStore(memoryContext, db)
		cancel()
		if err != nil {
			return fmt.Errorf("configure personal memory: %w", err)
		}
		memoryStore = store
	} else {
		logger.Warn("DATABASE_URL is not set; API will not be ready for data-backed requests")
		if bypassOTP || hasAuthenticationConfiguration() {
			return errors.New("DATABASE_URL is required when phone authentication is configured")
		}
	}

	var aiRouter *ai.Router
	var usageLimiter *database.AIUsageLimiter
	if len(aiConfiguration.Models) > 0 {
		if db == nil {
			return errors.New("DATABASE_URL is required when AI models are configured so usage limits can be enforced")
		}
		usageContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if bypassUsageCaps {
			usageLimiter, err = database.NewDevelopmentAIUsageLimiter(usageContext, db)
		} else {
			usageLimiter, err = database.NewAIUsageLimiter(usageContext, db)
		}
		cancel()
		if err != nil {
			return fmt.Errorf("configure persistent AI usage limits: %w", err)
		}
		if bypassUsageCaps {
			logger.Warn("PADI AI usage caps disabled for development; usage is still recorded")
		}
		aiRouter, err = ai.NewRouterFromEnvironment(aiConfiguration, ai.ObserverFunc(func(event ai.Event) {
			logger.Info("AI provider request",
				"model_id", event.ModelID,
				"provider", event.Provider,
				"duration_ms", event.Duration.Milliseconds(),
				"success", event.Success,
				"error_class", event.ErrorClass,
				"input_tokens", event.Usage.InputTokens,
				"output_tokens", event.Usage.OutputTokens,
				"estimated_cost", event.EstimatedCost,
			)
		}), usageLimiter)
		if err != nil {
			return fmt.Errorf("configure AI providers: %w", err)
		}
		logger.Info("AI model registry loaded", "model_count", aiRouter.ModelCount())
	}
	var speechLimiter ai.UsageLimiter
	if usageLimiter != nil {
		speechLimiter = usageLimiter
	}
	speechService, err := voice.LoadEnvironment(speechLimiter)
	if err != nil {
		return fmt.Errorf("configure voice transcription: %w", err)
	}
	var speechAPI httpapi.SpeechTranscriber
	if speechService != nil {
		speechAPI = speechService
		logger.Info("voice transcription configured", "provider", "groq", "model", voice.Model)
	}
	pythonSpeech, err := voice.LoadPythonSpeech(speechLimiter)
	if err != nil {
		return fmt.Errorf("configure Python speech: %w", err)
	}
	var synthesisAPI httpapi.SpeechSynthesiser
	if pythonSpeech != nil {
		synthesisAPI = pythonSpeech
		logger.Info("Python natural speech configured")
	}

	signalContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	var authAPI httpapi.AuthAPI
	if authService != nil {
		authAPI = authService
	}
	var chatAPI httpapi.ChatGenerator
	if aiRouter != nil {
		chatAPI = aiRouter
	}

	server := &http.Server{
		Addr: cfg.HTTPAddr,
		Handler: httpapi.NewRouter(readiness, httpapi.Dependencies{
			Auth:                 authAPI,
			Chat:                 chatAPI,
			AllowedOrigins:       corsOrigins(),
			Logger:               logger,
			DevelopmentOTPBypass: bypassOTP,
			Memory:               memoryStore,
			Speech:               speechAPI,
			Synthesis:            synthesisAPI,
		}),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      2*time.Minute + 45*time.Second,
		IdleTimeout:       60 * time.Second,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelError),
	}

	listener, err := net.Listen("tcp", server.Addr)
	if err != nil {
		return fmt.Errorf("listen on %q: %w", server.Addr, err)
	}

	serverErrors := make(chan error, 1)
	go func() {
		serverErrors <- server.Serve(listener)
	}()
	logger.Info("HTTP server listening", "address", listener.Addr().String())

	select {
	case err := <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if shutdownErr := server.Shutdown(shutdownContext); shutdownErr != nil {
				if closeErr := server.Close(); closeErr != nil {
					logger.Error("failed to close HTTP server after serve error", "error", closeErr)
				}
				return fmt.Errorf("serve HTTP: %w (also failed to shut down HTTP server: %v)", err, shutdownErr)
			}
			return fmt.Errorf("serve HTTP: %w", err)
		}
		return nil
	case <-signalContext.Done():
		// Restore normal signal handling so another signal can force an exit.
		stop()
	}

	logger.Info("shutting down HTTP server")
	shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(shutdownContext); err != nil {
		if closeErr := server.Close(); closeErr != nil {
			logger.Error("failed to close HTTP server", "error", closeErr)
		}
		return fmt.Errorf("shut down HTTP server: %w", err)
	}

	if err := <-serverErrors; !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("serve HTTP: %w", err)
	}

	logger.Info("HTTP server stopped")
	return nil
}

func configureAuthentication(db *sql.DB, bypassOTP bool) (*auth.Service, error) {
	if bypassOTP {
		storeContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		store, err := database.NewAuthStore(storeContext, db)
		if err != nil {
			return nil, err
		}
		slog.Warn("OTP verification is disabled for development; phone ownership is not verified")
		return auth.NewDevelopmentService(store)
	}
	apiKey := os.Getenv("TERMI_API_KEY")
	senderID := os.Getenv("TERMI_SENDER_ID")
	baseURL := os.Getenv("TERMI_API_BASE_URL")
	pepper := os.Getenv("PADI_AUTH_PEPPER")
	configured := 0
	for _, value := range []string{apiKey, senderID, baseURL, pepper} {
		if value != "" {
			configured++
		}
	}
	if configured == 0 {
		slog.Warn("phone authentication is not configured")
		return nil, nil
	}
	if configured != 4 {
		return nil, errors.New("TERMI_API_KEY, TERMI_SENDER_ID, TERMI_API_BASE_URL, and PADI_AUTH_PEPPER must all be configured")
	}
	if len(pepper) < 32 {
		return nil, errors.New("PADI_AUTH_PEPPER must contain at least 32 bytes")
	}
	storeContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	store, err := database.NewAuthStore(storeContext, db)
	cancel()
	if err != nil {
		return nil, err
	}
	sender, err := auth.NewTermiiSender(apiKey, senderID, baseURL)
	if err != nil {
		return nil, err
	}
	service, err := auth.NewService(store, sender, []byte(pepper))
	if err != nil {
		return nil, err
	}
	slog.Info("phone authentication configured", "sms_provider", "termii")
	return service, nil
}

func hasAuthenticationConfiguration() bool {
	return os.Getenv("TERMI_API_KEY") != "" ||
		os.Getenv("TERMI_SENDER_ID") != "" ||
		os.Getenv("TERMI_API_BASE_URL") != "" ||
		os.Getenv("PADI_AUTH_PEPPER") != ""
}

func corsOrigins() []string {
	raw := strings.TrimSpace(os.Getenv("PADI_CORS_ORIGINS"))
	if raw == "" {
		return nil
	}
	origins := strings.Split(raw, ",")
	for i := range origins {
		origins[i] = strings.TrimSpace(origins[i])
	}
	return origins
}
