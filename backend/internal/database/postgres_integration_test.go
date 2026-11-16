package database

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestPostgresConnectionIntegration(t *testing.T) {
	databaseURL := os.Getenv("PADI_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set PADI_TEST_DATABASE_URL to an explicitly disposable PostgreSQL database")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	db, err := Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open explicitly configured test database: %v", err)
	}
	defer db.Close()

	if err := db.PingContext(ctx); err != nil {
		t.Fatalf("ping explicitly configured test database: %v", err)
	}
}
