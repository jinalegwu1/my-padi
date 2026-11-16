package ai

import (
	"context"
	"errors"
	"sync"
	"time"
)

type usageBucket struct {
	requests   int
	tokens     int
	inputUsed  int
	outputUsed int
}

func (limiter *memoryUsageLimiter) RecordUsage(
	ctx context.Context,
	provider string,
	usage Usage,
	at time.Time,
) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if usage.InputTokens < 0 || usage.OutputTokens < 0 {
		return ErrInvalidProviderUsage
	}
	now := at.UTC()
	dayKey := provider + ":" + now.Format("2006-01-02")
	monthKey := provider + ":" + now.Format("2006-01")

	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	day, dayExists := limiter.daily[dayKey]
	month, monthExists := limiter.monthly[monthKey]
	if !dayExists || !monthExists {
		return errors.New("AI usage cannot be recorded without a reserved request")
	}
	day.inputUsed += usage.InputTokens
	day.outputUsed += usage.OutputTokens
	month.inputUsed += usage.InputTokens
	month.outputUsed += usage.OutputTokens
	limiter.daily[dayKey] = day
	limiter.monthly[monthKey] = month
	return nil
}
type memoryUsageLimiter struct {
	mu       sync.Mutex
	daily    map[string]usageBucket
	monthly  map[string]usageBucket
}

func newMemoryUsageLimiter() *memoryUsageLimiter {
	return &memoryUsageLimiter{
		daily:   make(map[string]usageBucket),
		monthly: make(map[string]usageBucket),
	}
}

func (limiter *memoryUsageLimiter) Reserve(
	ctx context.Context,
	provider string,
	tokenUnits int,
	limits UsageLimits,
	at time.Time,
) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	now := at.UTC()
	dayKey := provider + ":" + now.Format("2006-01-02")
	monthKey := provider + ":" + now.Format("2006-01")

	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	day := limiter.daily[dayKey]
	month := limiter.monthly[monthKey]
	if day.requests >= limits.RequestsPerDay || day.tokens+tokenUnits > limits.TokenUnitsPerDay {
		return &UsageLimitError{Provider: provider, Window: "daily"}
	}
	if month.requests >= limits.RequestsPerMonth || month.tokens+tokenUnits > limits.TokenUnitsPerMonth {
		return &UsageLimitError{Provider: provider, Window: "monthly"}
	}
	day.requests++
	day.tokens += tokenUnits
	month.requests++
	month.tokens += tokenUnits
	limiter.daily[dayKey] = day
	limiter.monthly[monthKey] = month
	return nil
}
