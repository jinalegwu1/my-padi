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
	"syscall"
	"time"

	"github.com/jinalegwu1/my-padi/backend/internal/ai"
	"github.com/jinalegwu1/my-padi/backend/internal/config"
	"github.com/jinalegwu1/my-padi/backend/internal/database"
	"github.com/jinalegwu1/my-padi/backend/internal/httpapi"
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
	aiRouter, err := ai.NewConfiguredRouter(ai.ObserverFunc(func(event ai.Event) {
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
	}))
	if err != nil {
		return fmt.Errorf("configure AI providers: %w", err)
	}
	if aiRouter != nil {
		logger.Info("AI model registry loaded", "model_count", aiRouter.ModelCount())
	}

	var db *sql.DB
	var readiness httpapi.ReadinessChecker
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
	} else {
		logger.Warn("DATABASE_URL is not set; API will not be ready for data-backed requests")
	}

	signalContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           httpapi.NewRouter(readiness),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
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
