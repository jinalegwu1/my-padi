package database

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jinalegwu1/my-padi/backend/internal/ai"
	"github.com/jinalegwu1/my-padi/backend/internal/auth"
)

type integrationCodeSender struct {
	code string
}

func (sender *integrationCodeSender) SendCode(_ context.Context, _ string, code string) error {
	sender.code = code
	return nil
}

func TestPostgresAuthenticationAndUsageIntegration(t *testing.T) {
	databaseURL := os.Getenv("PADI_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set PADI_TEST_DATABASE_URL to an explicitly disposable PostgreSQL database")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	db, err := Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open explicitly configured test database: %v", err)
	}
	defer db.Close()
	if err := Migrate(ctx, db); err != nil {
		t.Fatalf("apply schema migrations to test database: %v", err)
	}

	phoneNumber := fmt.Sprintf("+1%010d", time.Now().UnixNano()%10_000_000_000)
	provider := fmt.Sprintf("integration-%d", time.Now().UnixNano())
	defer func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE phone_number = $1`, phoneNumber)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM auth_challenges WHERE phone_number = $1`, phoneNumber)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM ai_provider_usage_periods WHERE provider = $1`, provider)
	}()

	store, err := NewAuthStore(ctx, db)
	if err != nil {
		t.Fatalf("NewAuthStore() error = %v", err)
	}
	sender := &integrationCodeSender{}
	service, err := auth.NewService(store, sender, []byte("integration-test-pepper-0123456789"))
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	challenge, err := service.RequestRegistration(ctx, auth.Profile{
		FullName: "Integration Test", DateOfBirth: "1990-01-01", PhoneNumber: phoneNumber,
	}, "127.0.0.1")
	if err != nil {
		t.Fatalf("RequestRegistration() error = %v", err)
	}
	session, err := service.Verify(ctx, challenge.ID, sender.code)
	if err != nil {
		t.Fatalf("Verify() error = %v", err)
	}
	user, err := service.Authenticate(ctx, session.Token)
	if err != nil {
		t.Fatalf("Authenticate() error = %v", err)
	}
	if user.ID != session.User.ID || user.FullName != "Integration Test" {
		t.Fatalf("authenticated user = %+v, want registration profile", user)
	}
	if err := service.Logout(ctx, session.Token); err != nil {
		t.Fatalf("Logout() error = %v", err)
	}
	if _, err := service.Authenticate(ctx, session.Token); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Fatalf("Authenticate() after logout error = %v, want unauthenticated", err)
	}

	limiter, err := NewAIUsageLimiter(ctx, db)
	if err != nil {
		t.Fatalf("NewAIUsageLimiter() error = %v", err)
	}
	limits := ai.UsageLimits{
		RequestsPerDay: 1, RequestsPerMonth: 1,
		TokenUnitsPerDay: 100, TokenUnitsPerMonth: 100,
	}
	now := time.Now().UTC()
	if err := limiter.Reserve(ctx, provider, 20, limits, now); err != nil {
		t.Fatalf("Reserve() error = %v", err)
	}
	if err := limiter.RecordUsage(ctx, provider, ai.Usage{InputTokens: 10, OutputTokens: 5}, now); err != nil {
		t.Fatalf("RecordUsage() error = %v", err)
	}
	if err := limiter.Reserve(ctx, provider, 1, limits, now); !errors.Is(err, ai.ErrUsageLimitReached) {
		t.Fatalf("Reserve() after cap error = %v, want usage limit reached", err)
	}
}
