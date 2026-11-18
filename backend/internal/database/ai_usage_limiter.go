package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jinalegwu1/my-padi/backend/internal/ai"
)

type AIUsageLimiter struct {
	db         *sql.DB
	bypassCaps bool
}

func NewAIUsageLimiter(ctx context.Context, db *sql.DB) (*AIUsageLimiter, error) {
	if db == nil {
		return nil, errors.New("PostgreSQL connection is required for AI usage limits")
	}
	var tableExists bool
	if err := db.QueryRowContext(ctx,
		`SELECT to_regclass('public.ai_provider_usage_periods') IS NOT NULL`,
	).Scan(&tableExists); err != nil {
		return nil, fmt.Errorf("check AI usage limits table: %w", err)
	}
	if !tableExists {
		return nil, errors.New("AI usage limits table is missing; run `go run ./cmd/migrate` before enabling AI models")
	}
	return &AIUsageLimiter{db: db}, nil
}

// NewDevelopmentAIUsageLimiter retains the persistent usage ledger while
// skipping PADI-side caps. The caller must enforce development-only access.
func NewDevelopmentAIUsageLimiter(ctx context.Context, db *sql.DB) (*AIUsageLimiter, error) {
	limiter, err := NewAIUsageLimiter(ctx, db)
	if err != nil {
		return nil, err
	}
	limiter.bypassCaps = true
	return limiter, nil
}

func (limiter *AIUsageLimiter) Reserve(
	ctx context.Context,
	provider string,
	tokenUnits int,
	limits ai.UsageLimits,
	at time.Time,
) error {
	if tokenUnits <= 0 || limits.RequestsPerDay <= 0 || limits.RequestsPerMonth <= 0 ||
		limits.TokenUnitsPerDay <= 0 || limits.TokenUnitsPerMonth <= 0 {
		return errors.New("AI usage limits and reservation must be positive")
	}
	if !limiter.bypassCaps && tokenUnits > limits.TokenUnitsPerDay {
		return &ai.UsageLimitError{Provider: provider, Window: "daily"}
	}
	if !limiter.bypassCaps && tokenUnits > limits.TokenUnitsPerMonth {
		return &ai.UsageLimitError{Provider: provider, Window: "monthly"}
	}

	now := at.UTC()
	tx, err := limiter.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin AI usage reservation: %w", err)
	}
	defer tx.Rollback()

	if err := reserveUsagePeriod(ctx, tx, provider, "day", now.Format("2006-01-02"),
		tokenUnits, limits.RequestsPerDay, limits.TokenUnitsPerDay, limiter.bypassCaps); err != nil {
		return err
	}
	if err := reserveUsagePeriod(ctx, tx, provider, "month", now.Format("2006-01")+"-01",
		tokenUnits, limits.RequestsPerMonth, limits.TokenUnitsPerMonth, limiter.bypassCaps); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit AI usage reservation: %w", err)
	}
	return nil
}

func (limiter *AIUsageLimiter) RecordUsage(
	ctx context.Context,
	provider string,
	usage ai.Usage,
	at time.Time,
) error {
	if usage.InputTokens < 0 || usage.OutputTokens < 0 {
		return ai.ErrInvalidProviderUsage
	}
	now := at.UTC()
	tx, err := limiter.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin AI usage recording: %w", err)
	}
	defer tx.Rollback()

	for _, period := range []struct {
		kind  string
		start string
	}{
		{kind: "day", start: now.Format("2006-01-02")},
		{kind: "month", start: now.Format("2006-01") + "-01"},
	} {
		result, err := tx.ExecContext(ctx, `
			UPDATE ai_provider_usage_periods
			SET input_tokens = input_tokens + $4,
			    output_tokens = output_tokens + $5
			WHERE provider = $1 AND period_type = $2 AND period_start = $3::date
		`, provider, period.kind, period.start, usage.InputTokens, usage.OutputTokens)
		if err != nil {
			return fmt.Errorf("record %s AI token usage: %w", period.kind, err)
		}
		updated, err := result.RowsAffected()
		if err != nil {
			return fmt.Errorf("check %s AI usage update: %w", period.kind, err)
		}
		if updated != 1 {
			return fmt.Errorf("record %s AI usage without a reserved request", period.kind)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit AI usage recording: %w", err)
	}
	return nil
}

func reserveUsagePeriod(
	ctx context.Context,
	tx *sql.Tx,
	provider, period, start string,
	tokenUnits, requestLimit, tokenLimit int,
	bypassCaps bool,
) error {
	var requestCount int
	err := tx.QueryRowContext(ctx, `
		INSERT INTO ai_provider_usage_periods (
			provider, period_type, period_start, request_count, reserved_token_units
		) VALUES ($1, $2, $3::date, 1, $4)
		ON CONFLICT (provider, period_type, period_start) DO UPDATE
		SET request_count = ai_provider_usage_periods.request_count + 1,
		    reserved_token_units = ai_provider_usage_periods.reserved_token_units + EXCLUDED.reserved_token_units
		WHERE $7 OR (ai_provider_usage_periods.request_count < $5
		  AND ai_provider_usage_periods.reserved_token_units + EXCLUDED.reserved_token_units <= $6)
		RETURNING request_count
	`, provider, period, start, tokenUnits, requestLimit, tokenLimit, bypassCaps).Scan(&requestCount)
	if errors.Is(err, sql.ErrNoRows) {
		window := "monthly"
		if period == "day" {
			window = "daily"
		}
		return &ai.UsageLimitError{Provider: provider, Window: window}
	}
	if err != nil {
		return fmt.Errorf("reserve %s AI usage: %w", period, err)
	}
	return nil
}
