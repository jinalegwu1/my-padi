package ai

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestMemoryUsageLimiterEnforcesProviderDailyAndMonthlyCaps(t *testing.T) {
	limiter := newMemoryUsageLimiter()
	limits := UsageLimits{
		RequestsPerDay:     2,
		RequestsPerMonth:   3,
		TokenUnitsPerDay:   20,
		TokenUnitsPerMonth: 30,
	}
	now := time.Date(2026, time.November, 16, 12, 0, 0, 0, time.FixedZone("local", 3600))

	for i := 0; i < 2; i++ {
		if err := limiter.Reserve(context.Background(), ProviderGemini, 10, limits, now); err != nil {
			t.Fatalf("Reserve() #%d error = %v", i+1, err)
		}
	}
	err := limiter.Reserve(context.Background(), ProviderGemini, 1, limits, now)
	if !errors.Is(err, ErrUsageLimitReached) {
		t.Fatalf("Reserve() error = %v, want daily limit error", err)
	}
	var limitErr *UsageLimitError
	if !errors.As(err, &limitErr) || limitErr.Window != "daily" {
		t.Fatalf("Reserve() error = %v, want daily window", err)
	}

	nextDay := now.Add(24 * time.Hour)
	if err := limiter.Reserve(context.Background(), ProviderGemini, 10, limits, nextDay); err != nil {
		t.Fatalf("Reserve() on next UTC day error = %v", err)
	}
	err = limiter.Reserve(context.Background(), ProviderGemini, 1, limits, nextDay)
	if !errors.As(err, &limitErr) || limitErr.Window != "monthly" {
		t.Fatalf("Reserve() error = %v, want monthly window", err)
	}
}

func TestMemoryUsageLimiterKeepsProviderBudgetsSeparate(t *testing.T) {
	limiter := newMemoryUsageLimiter()
	limits := UsageLimits{
		RequestsPerDay:     1,
		RequestsPerMonth:   1,
		TokenUnitsPerDay:   10,
		TokenUnitsPerMonth: 10,
	}
	now := time.Now()
	if err := limiter.Reserve(context.Background(), ProviderGemini, 5, limits, now); err != nil {
		t.Fatalf("Gemini Reserve() error = %v", err)
	}
	if err := limiter.Reserve(context.Background(), ProviderGroq, 5, limits, now); err != nil {
		t.Fatalf("Groq Reserve() error = %v", err)
	}
}

