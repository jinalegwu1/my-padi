package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jinalegwu1/my-padi/backend/internal/ai"
)

type quotaIntegrationFixture struct {
	ctx      context.Context
	db       *sql.DB
	limiter  *AIUsageLimiter
	provider string
	at       time.Time
}

type quotaIntegrationCounters struct {
	Kind          string
	Start         string
	Requests      int64
	ReservedUnits int64
	InputTokens   int64
	OutputTokens  int64
}

func newQuotaIntegrationFixture(t *testing.T) quotaIntegrationFixture {
	t.Helper()
	databaseURL := os.Getenv("PADI_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set PADI_TEST_DATABASE_URL to an explicitly disposable PostgreSQL database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	t.Cleanup(cancel)
	db, err := Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open disposable quota test database: %v", err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Errorf("close quota test pool: %v", err)
		}
	})
	if err := Migrate(ctx, db); err != nil {
		t.Fatalf("apply quota test database migrations: %v", err)
	}
	limiter, err := NewAIUsageLimiter(ctx, db)
	if err != nil {
		t.Fatalf("construct persistent quota limiter: %v", err)
	}
	provider := fmt.Sprintf("quota-integration-%d-%s", time.Now().UnixNano(), t.Name())
	cleanupQuotaIntegrationProvider(t, db, provider)
	return quotaIntegrationFixture{
		ctx: ctx, db: db, limiter: limiter, provider: provider,
		at: time.Date(2026, time.November, 1, 12, 0, 0, 0, time.UTC),
	}
}

func cleanupQuotaIntegrationProvider(t *testing.T, db *sql.DB, provider string) {
	t.Helper()
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := db.ExecContext(ctx,
			`DELETE FROM ai_provider_usage_periods WHERE provider = $1`, provider,
		); err != nil {
			t.Errorf("clean up test provider ledger: %v", err)
		}
	})
}

func (fixture quotaIntegrationFixture) counters(t *testing.T) []quotaIntegrationCounters {
	t.Helper()
	rows, err := fixture.db.QueryContext(fixture.ctx, `
		SELECT period_type, period_start::text, request_count, reserved_token_units,
		       input_tokens, output_tokens
		FROM ai_provider_usage_periods
		WHERE provider = $1
		ORDER BY period_type, period_start
	`, fixture.provider)
	if err != nil {
		t.Fatalf("read persisted quota counters: %v", err)
	}
	defer rows.Close()
	var counters []quotaIntegrationCounters
	for rows.Next() {
		var current quotaIntegrationCounters
		if err := rows.Scan(&current.Kind, &current.Start, &current.Requests,
			&current.ReservedUnits, &current.InputTokens, &current.OutputTokens); err != nil {
			t.Fatalf("scan persisted quota counters: %v", err)
		}
		counters = append(counters, current)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate persisted quota counters: %v", err)
	}
	return counters
}

func quotaIntegrationExpectedCounters(at time.Time, requests, units, input, output int64) []quotaIntegrationCounters {
	at = at.UTC()
	return []quotaIntegrationCounters{
		{Kind: "day", Start: at.Format("2006-01-02"), Requests: requests,
			ReservedUnits: units, InputTokens: input, OutputTokens: output},
		{Kind: "month", Start: at.Format("2006-01") + "-01", Requests: requests,
			ReservedUnits: units, InputTokens: input, OutputTokens: output},
	}
}

func assertQuotaIntegrationCounters(t *testing.T, fixture quotaIntegrationFixture, want []quotaIntegrationCounters) {
	t.Helper()
	if got := fixture.counters(t); !reflect.DeepEqual(got, want) {
		t.Errorf("persisted counters = %+v; want %+v", got, want)
	}
}

func assertQuotaIntegrationLimit(t *testing.T, err error, provider, window string) {
	t.Helper()
	var limitErr *ai.UsageLimitError
	if !errors.Is(err, ai.ErrUsageLimitReached) || !errors.As(err, &limitErr) {
		t.Errorf("reservation error = %v; want %s usage limit error", err, window)
		return
	}
	if limitErr.Provider != provider || limitErr.Window != window {
		t.Errorf("usage limit error = %+v; want provider %q and window %q", limitErr, provider, window)
	}
}

func secondQuotaIntegrationPool(t *testing.T, fixture quotaIntegrationFixture) (*sql.DB, *AIUsageLimiter) {
	t.Helper()
	db, err := Open(fixture.ctx, os.Getenv("PADI_TEST_DATABASE_URL"))
	if err != nil {
		t.Fatalf("open independent quota test pool: %v", err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Errorf("close independent quota test pool: %v", err)
		}
	})
	limiter, err := NewAIUsageLimiter(fixture.ctx, db)
	if err != nil {
		t.Fatalf("construct quota limiter with independent pool: %v", err)
	}
	return db, limiter
}

func TestPostgresQuotaMigrationsIntegration(t *testing.T) {
	fixture := newQuotaIntegrationFixture(t)
	type appliedMigration struct {
		Version   int64
		AppliedAt time.Time
	}
	readApplied := func() []appliedMigration {
		rows, err := fixture.db.QueryContext(fixture.ctx,
			`SELECT version, applied_at FROM schema_migrations ORDER BY version`)
		if err != nil {
			t.Fatalf("read migration history: %v", err)
		}
		defer rows.Close()
		var applied []appliedMigration
		for rows.Next() {
			var current appliedMigration
			if err := rows.Scan(&current.Version, &current.AppliedAt); err != nil {
				t.Fatalf("scan migration history: %v", err)
			}
			applied = append(applied, current)
		}
		if err := rows.Err(); err != nil {
			t.Fatalf("iterate migration history: %v", err)
		}
		return applied
	}
	before := readApplied()
	migrations, err := readMigrations()
	if err != nil {
		t.Fatal(err)
	}
	if len(before) != len(migrations) {
		t.Fatalf("applied migrations = %d; want %d", len(before), len(migrations))
	}
	for i, current := range migrations {
		if before[i].Version != current.version {
			t.Errorf("applied version = %d; want %d", before[i].Version, current.version)
		}
	}
	if err := Migrate(fixture.ctx, fixture.db); err != nil {
		t.Fatalf("reapply migrations: %v", err)
	}
	if after := readApplied(); !reflect.DeepEqual(before, after) {
		t.Errorf("reapplying migrations changed migration history: before=%+v after=%+v", before, after)
	}
	var version string
	if err := fixture.db.QueryRowContext(fixture.ctx, `SHOW server_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	t.Logf("PostgreSQL %s: %d migrations applied; reapplication preserves history", version, len(before))
}

func TestPostgresQuotaConstraintsIntegration(t *testing.T) {
	cases := []struct {
		name                   string
		kind                   string
		requests, units, input int64
		output                 int64
	}{
		{name: "invalid_period", kind: "week"},
		{name: "negative_requests", kind: "day", requests: -1},
		{name: "negative_reservation", kind: "day", units: -1},
		{name: "negative_input", kind: "day", input: -1},
		{name: "negative_output", kind: "day", output: -1},
	}
	for _, current := range cases {
		t.Run(current.name, func(t *testing.T) {
			fixture := newQuotaIntegrationFixture(t)
			_, err := fixture.db.ExecContext(fixture.ctx, `
				INSERT INTO ai_provider_usage_periods (
					provider, period_type, period_start, request_count, reserved_token_units,
					input_tokens, output_tokens
				) VALUES ($1, $2, $3, $4, $5, $6, $7)
			`, fixture.provider, current.kind, fixture.at, current.requests,
				current.units, current.input, current.output)
			var databaseErr *pgconn.PgError
			if !errors.As(err, &databaseErr) || databaseErr.Code != "23514" {
				t.Errorf("invalid ledger insert error = %v; want PostgreSQL check violation", err)
			}
			assertQuotaIntegrationCounters(t, fixture, nil)
		})
	}
}

func TestPostgresQuotaRejectsOversizedFirstReservationIntegration(t *testing.T) {
	cases := []struct {
		name, window string
		units        int
		limits       ai.UsageLimits
	}{
		{name: "daily", window: "daily", units: 25_001, limits: ai.FreeUsageLimits()},
		{name: "monthly", window: "monthly", units: 101, limits: ai.UsageLimits{
			RequestsPerDay: 20, RequestsPerMonth: 300,
			TokenUnitsPerDay: 1_000, TokenUnitsPerMonth: 100,
		}},
	}
	for _, current := range cases {
		t.Run(current.name, func(t *testing.T) {
			fixture := newQuotaIntegrationFixture(t)
			err := fixture.limiter.Reserve(fixture.ctx, fixture.provider, current.units, current.limits, fixture.at)
			assertQuotaIntegrationLimit(t, err, fixture.provider, current.window)
			assertQuotaIntegrationCounters(t, fixture, nil)
		})
	}
}

func TestPostgresQuotaLimitsIntegration(t *testing.T) {
	cases := []struct {
		name, window string
		limits       ai.UsageLimits
	}{
		{name: "daily_requests", window: "daily", limits: ai.UsageLimits{
			RequestsPerDay: 2, RequestsPerMonth: 10, TokenUnitsPerDay: 100, TokenUnitsPerMonth: 100,
		}},
		{name: "monthly_requests", window: "monthly", limits: ai.UsageLimits{
			RequestsPerDay: 10, RequestsPerMonth: 2, TokenUnitsPerDay: 100, TokenUnitsPerMonth: 100,
		}},
		{name: "daily_tokens", window: "daily", limits: ai.UsageLimits{
			RequestsPerDay: 10, RequestsPerMonth: 10, TokenUnitsPerDay: 20, TokenUnitsPerMonth: 100,
		}},
		{name: "monthly_tokens", window: "monthly", limits: ai.UsageLimits{
			RequestsPerDay: 10, RequestsPerMonth: 10, TokenUnitsPerDay: 100, TokenUnitsPerMonth: 20,
		}},
	}
	for _, current := range cases {
		t.Run(current.name, func(t *testing.T) {
			fixture := newQuotaIntegrationFixture(t)
			for i := 0; i < 2; i++ {
				if err := fixture.limiter.Reserve(fixture.ctx, fixture.provider, 10, current.limits, fixture.at); err != nil {
					t.Fatalf("reservation #%d at or below cap: %v", i+1, err)
				}
			}
			want := quotaIntegrationExpectedCounters(fixture.at, 2, 20, 0, 0)
			assertQuotaIntegrationCounters(t, fixture, want)
			err := fixture.limiter.Reserve(fixture.ctx, fixture.provider, 1, current.limits, fixture.at)
			assertQuotaIntegrationLimit(t, err, fixture.provider, current.window)
			assertQuotaIntegrationCounters(t, fixture, want)
		})
	}
}

func TestPostgresQuotaDefaultLimitsIntegration(t *testing.T) {
	cases := []struct {
		name, window          string
		days, requestsEachDay int
		units                 int
		blockOnNewDay         bool
	}{
		{name: "20_daily_requests", window: "daily", days: 1, requestsEachDay: 20, units: 1},
		{name: "300_monthly_requests", window: "monthly", days: 15, requestsEachDay: 20, units: 1, blockOnNewDay: true},
		{name: "25000_daily_units", window: "daily", days: 1, requestsEachDay: 1, units: 25_000},
		{name: "250000_monthly_units", window: "monthly", days: 10, requestsEachDay: 1, units: 25_000, blockOnNewDay: true},
	}
	for _, current := range cases {
		t.Run(current.name, func(t *testing.T) {
			fixture := newQuotaIntegrationFixture(t)
			limits := ai.FreeUsageLimits()
			for day := 0; day < current.days; day++ {
				at := fixture.at.AddDate(0, 0, day)
				for request := 0; request < current.requestsEachDay; request++ {
					if err := fixture.limiter.Reserve(fixture.ctx, fixture.provider, current.units, limits, at); err != nil {
						t.Fatalf("reserve day %d request %d: %v", day+1, request+1, err)
					}
				}
			}
			before := fixture.counters(t)
			requests := int64(current.days * current.requestsEachDay)
			wantMonth := quotaIntegrationExpectedCounters(fixture.at, requests, requests*int64(current.units), 0, 0)[1]
			if len(before) != current.days+1 || before[len(before)-1] != wantMonth {
				t.Fatalf("default-limit ledger = %+v; want %d daily rows and monthly counters %+v", before, current.days, wantMonth)
			}
			blockedAt := fixture.at
			if current.blockOnNewDay {
				blockedAt = fixture.at.AddDate(0, 0, current.days)
			}
			err := fixture.limiter.Reserve(fixture.ctx, fixture.provider, 1, limits, blockedAt)
			assertQuotaIntegrationLimit(t, err, fixture.provider, current.window)
			assertQuotaIntegrationCounters(t, fixture, before)
		})
	}
}

func TestPostgresQuotaMonthlyRejectionRollsBackNewDayIntegration(t *testing.T) {
	fixture := newQuotaIntegrationFixture(t)
	limits := ai.UsageLimits{
		RequestsPerDay: 10, RequestsPerMonth: 1, TokenUnitsPerDay: 100, TokenUnitsPerMonth: 100,
	}
	if err := fixture.limiter.Reserve(fixture.ctx, fixture.provider, 10, limits, fixture.at); err != nil {
		t.Fatal(err)
	}
	before := fixture.counters(t)
	err := fixture.limiter.Reserve(fixture.ctx, fixture.provider, 10, limits, fixture.at.AddDate(0, 0, 1))
	assertQuotaIntegrationLimit(t, err, fixture.provider, "monthly")
	assertQuotaIntegrationCounters(t, fixture, before)
}

func TestPostgresQuotaUsageRecordingIntegration(t *testing.T) {
	fixture := newQuotaIntegrationFixture(t)
	usage := ai.Usage{InputTokens: 3, OutputTokens: 2}
	if err := fixture.limiter.RecordUsage(fixture.ctx, fixture.provider, usage, fixture.at); err == nil {
		t.Fatal("recording without a reservation succeeded")
	}
	assertQuotaIntegrationCounters(t, fixture, nil)
	if err := fixture.limiter.Reserve(fixture.ctx, fixture.provider, 10, ai.FreeUsageLimits(), fixture.at); err != nil {
		t.Fatal(err)
	}
	if err := fixture.limiter.RecordUsage(fixture.ctx, fixture.provider, usage, fixture.at); err != nil {
		t.Fatal(err)
	}
	want := quotaIntegrationExpectedCounters(fixture.at, 1, 10, 3, 2)
	assertQuotaIntegrationCounters(t, fixture, want)
	for _, invalid := range []ai.Usage{{InputTokens: -1}, {OutputTokens: -1}} {
		if err := fixture.limiter.RecordUsage(fixture.ctx, fixture.provider, invalid, fixture.at); !errors.Is(err, ai.ErrInvalidProviderUsage) {
			t.Errorf("negative usage error = %v; want invalid usage error", err)
		}
		assertQuotaIntegrationCounters(t, fixture, want)
	}
	// A reserved attempt without a successful provider response still consumes its budget.
	if err := fixture.limiter.Reserve(fixture.ctx, fixture.provider, 5, ai.FreeUsageLimits(), fixture.at); err != nil {
		t.Fatal(err)
	}
	assertQuotaIntegrationCounters(t, fixture, quotaIntegrationExpectedCounters(fixture.at, 2, 15, 3, 2))
}

func TestPostgresQuotaUsageRecordingRollsBackIntegration(t *testing.T) {
	fixture := newQuotaIntegrationFixture(t)
	if err := fixture.limiter.Reserve(fixture.ctx, fixture.provider, 10, ai.FreeUsageLimits(), fixture.at); err != nil {
		t.Fatal(err)
	}
	// Fault injection is restricted to this test's own provider rows.
	if _, err := fixture.db.ExecContext(fixture.ctx,
		`DELETE FROM ai_provider_usage_periods WHERE provider = $1 AND period_type = 'month'`,
		fixture.provider); err != nil {
		t.Fatal(err)
	}
	before := fixture.counters(t)
	err := fixture.limiter.RecordUsage(fixture.ctx, fixture.provider, ai.Usage{InputTokens: 3, OutputTokens: 2}, fixture.at)
	if err == nil {
		t.Fatal("recording usage with the monthly row missing succeeded")
	}
	assertQuotaIntegrationCounters(t, fixture, before)
}

func TestPostgresQuotaBlockedTransactionCancellationIntegration(t *testing.T) {
	fixture := newQuotaIntegrationFixture(t)
	if err := fixture.limiter.Reserve(fixture.ctx, fixture.provider, 10, ai.FreeUsageLimits(), fixture.at); err != nil {
		t.Fatal(err)
	}
	before := fixture.counters(t)
	blocker, err := fixture.db.BeginTx(fixture.ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer blocker.Rollback()
	var requests int
	if err := blocker.QueryRowContext(fixture.ctx, `
		SELECT request_count FROM ai_provider_usage_periods
		WHERE provider = $1 AND period_type = 'month' FOR UPDATE
	`, fixture.provider).Scan(&requests); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(fixture.ctx, 150*time.Millisecond)
	defer cancel()
	err = fixture.limiter.Reserve(ctx, fixture.provider, 10, ai.FreeUsageLimits(), fixture.at)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("blocked reservation error = %v; want context deadline exceeded", err)
	}
	if err := blocker.Rollback(); err != nil {
		t.Fatal(err)
	}
	assertQuotaIntegrationCounters(t, fixture, before)
	t.Logf("reservation blocked on a real PostgreSQL row lock: %v", err)
}

func TestPostgresQuotaUTCPeriodsIntegration(t *testing.T) {
	fixture := newQuotaIntegrationFixture(t)
	limits := ai.UsageLimits{RequestsPerDay: 1, RequestsPerMonth: 1, TokenUnitsPerDay: 10, TokenUnitsPerMonth: 10}
	at := time.Date(2026, time.November, 30, 23, 30, 0, 0, time.UTC)
	if err := fixture.limiter.Reserve(fixture.ctx, fixture.provider, 10, limits, at); err != nil {
		t.Fatal(err)
	}
	before := fixture.counters(t)
	// This instant is December 1 in Nigeria, but November 30 in the quota's UTC calendar.
	local := at.In(time.FixedZone("WAT", 3600))
	err := fixture.limiter.Reserve(fixture.ctx, fixture.provider, 1, limits, local)
	assertQuotaIntegrationLimit(t, err, fixture.provider, "daily")
	assertQuotaIntegrationCounters(t, fixture, before)
	if err := fixture.limiter.Reserve(fixture.ctx, fixture.provider, 10, limits, at.Add(time.Hour)); err != nil {
		t.Fatalf("reserve after UTC day and month rollover: %v", err)
	}
	want := []quotaIntegrationCounters{
		{Kind: "day", Start: "2026-11-30", Requests: 1, ReservedUnits: 10},
		{Kind: "day", Start: "2026-12-01", Requests: 1, ReservedUnits: 10},
		{Kind: "month", Start: "2026-11-01", Requests: 1, ReservedUnits: 10},
		{Kind: "month", Start: "2026-12-01", Requests: 1, ReservedUnits: 10},
	}
	assertQuotaIntegrationCounters(t, fixture, want)
}

func TestPostgresQuotaDailyResetPreservesMonthIntegration(t *testing.T) {
	fixture := newQuotaIntegrationFixture(t)
	limits := ai.UsageLimits{RequestsPerDay: 1, RequestsPerMonth: 2, TokenUnitsPerDay: 10, TokenUnitsPerMonth: 20}
	for day := 0; day < 2; day++ {
		if err := fixture.limiter.Reserve(fixture.ctx, fixture.provider, 10, limits, fixture.at.AddDate(0, 0, day)); err != nil {
			t.Fatalf("reserve UTC day %d: %v", day+1, err)
		}
	}
	before := fixture.counters(t)
	err := fixture.limiter.Reserve(fixture.ctx, fixture.provider, 1, limits, fixture.at.AddDate(0, 0, 2))
	assertQuotaIntegrationLimit(t, err, fixture.provider, "monthly")
	assertQuotaIntegrationCounters(t, fixture, before)
}

func TestPostgresQuotaProviderIsolationIntegration(t *testing.T) {
	fixture := newQuotaIntegrationFixture(t)
	limits := ai.UsageLimits{RequestsPerDay: 1, RequestsPerMonth: 1, TokenUnitsPerDay: 10, TokenUnitsPerMonth: 10}
	for _, name := range []string{ai.ProviderGemini, ai.ProviderGroq, ai.ProviderZAI, ai.ProviderOpenRouter} {
		provider := fixture.provider + "-" + name
		cleanupQuotaIntegrationProvider(t, fixture.db, provider)
		if err := fixture.limiter.Reserve(fixture.ctx, provider, 10, limits, fixture.at); err != nil {
			t.Fatalf("reserve independent %s provider budget: %v", name, err)
		}
		err := fixture.limiter.Reserve(fixture.ctx, provider, 1, limits, fixture.at)
		assertQuotaIntegrationLimit(t, err, provider, "daily")
		copy := fixture
		copy.provider = provider
		assertQuotaIntegrationCounters(t, copy, quotaIntegrationExpectedCounters(fixture.at, 1, 10, 0, 0))
	}
}

func TestPostgresQuotaPersistsAcrossPoolsIntegration(t *testing.T) {
	fixture := newQuotaIntegrationFixture(t)
	limits := ai.UsageLimits{RequestsPerDay: 1, RequestsPerMonth: 1, TokenUnitsPerDay: 10, TokenUnitsPerMonth: 10}
	if err := fixture.limiter.Reserve(fixture.ctx, fixture.provider, 10, limits, fixture.at); err != nil {
		t.Fatal(err)
	}
	_, independent := secondQuotaIntegrationPool(t, fixture)
	err := independent.Reserve(fixture.ctx, fixture.provider, 1, limits, fixture.at)
	assertQuotaIntegrationLimit(t, err, fixture.provider, "daily")
	if err := independent.RecordUsage(fixture.ctx, fixture.provider, ai.Usage{InputTokens: 3, OutputTokens: 2}, fixture.at); err != nil {
		t.Fatal(err)
	}
	assertQuotaIntegrationCounters(t, fixture, quotaIntegrationExpectedCounters(fixture.at, 1, 10, 3, 2))
}

func TestPostgresQuotaFailsClosedIntegration(t *testing.T) {
	fixture := newQuotaIntegrationFixture(t)
	ctx, cancel := context.WithCancel(fixture.ctx)
	cancel()
	if err := fixture.limiter.Reserve(ctx, fixture.provider, 1, ai.FreeUsageLimits(), fixture.at); !errors.Is(err, context.Canceled) {
		t.Errorf("canceled reservation error = %v; want context canceled", err)
	}
	if err := fixture.limiter.RecordUsage(ctx, fixture.provider, ai.Usage{}, fixture.at); !errors.Is(err, context.Canceled) {
		t.Errorf("canceled usage recording error = %v; want context canceled", err)
	}
	db, independent := secondQuotaIntegrationPool(t, fixture)
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	if err := independent.Reserve(fixture.ctx, fixture.provider, 1, ai.FreeUsageLimits(), fixture.at); err == nil {
		t.Errorf("unavailable database reservation error = %v; want closed database error", err)
	}
	if err := independent.RecordUsage(fixture.ctx, fixture.provider, ai.Usage{}, fixture.at); err == nil {
		t.Errorf("unavailable database usage recording error = %v; want closed database error", err)
	}
	if limiter, err := NewAIUsageLimiter(fixture.ctx, db); err == nil || limiter != nil {
		t.Errorf("construct limiter with unavailable database = %v, %v; want error", limiter, err)
	}
	assertQuotaIntegrationCounters(t, fixture, nil)
}

func TestPostgresQuotaConcurrentRequestsIntegration(t *testing.T) {
	cases := []struct {
		name, window string
		limits       ai.UsageLimits
		accepted     int
		distinctDays bool
	}{
		{name: "daily_requests", window: "daily", accepted: 20, limits: ai.UsageLimits{
			RequestsPerDay: 20, RequestsPerMonth: 300, TokenUnitsPerDay: 10_000, TokenUnitsPerMonth: 100_000,
		}},
		{name: "monthly_requests_across_days", window: "monthly", accepted: 20, distinctDays: true, limits: ai.UsageLimits{
			RequestsPerDay: 100, RequestsPerMonth: 20, TokenUnitsPerDay: 10_000, TokenUnitsPerMonth: 100_000,
		}},
		{name: "daily_tokens", window: "daily", accepted: 7, limits: ai.UsageLimits{
			RequestsPerDay: 100, RequestsPerMonth: 300, TokenUnitsPerDay: 70, TokenUnitsPerMonth: 700,
		}},
		{name: "monthly_tokens_across_days", window: "monthly", accepted: 7, distinctDays: true, limits: ai.UsageLimits{
			RequestsPerDay: 100, RequestsPerMonth: 300, TokenUnitsPerDay: 700, TokenUnitsPerMonth: 70,
		}},
	}
	for _, current := range cases {
		t.Run(current.name, func(t *testing.T) {
			fixture := newQuotaIntegrationFixture(t)
			_, independent := secondQuotaIntegrationPool(t, fixture)
			limiters := []*AIUsageLimiter{fixture.limiter, independent}
			const attempts = 100
			type outcome struct {
				reservationErr error
				recordingErr   error
			}
			start := make(chan struct{})
			results := make(chan outcome, attempts)
			var workers sync.WaitGroup
			for i := 0; i < attempts; i++ {
				workers.Add(1)
				go func(i int) {
					defer workers.Done()
					<-start
					at := fixture.at
					if current.distinctDays {
						at = at.AddDate(0, 0, i%5)
					}
					limiter := limiters[i%len(limiters)]
					result := outcome{reservationErr: limiter.Reserve(fixture.ctx, fixture.provider, 10, current.limits, at)}
					if result.reservationErr == nil {
						result.recordingErr = limiter.RecordUsage(fixture.ctx, fixture.provider,
							ai.Usage{InputTokens: 3, OutputTokens: 2}, at)
					}
					results <- result
				}(i)
			}
			close(start)
			workers.Wait()
			close(results)
			accepted, rejected := 0, 0
			for result := range results {
				if result.reservationErr == nil {
					accepted++
					if result.recordingErr != nil {
						t.Errorf("concurrent usage recording: %v", result.recordingErr)
					}
				} else if errors.Is(result.reservationErr, ai.ErrUsageLimitReached) {
					rejected++
					assertQuotaIntegrationLimit(t, result.reservationErr, fixture.provider, current.window)
				} else {
					t.Errorf("unexpected concurrent reservation error: %v", result.reservationErr)
				}
			}
			if accepted != current.accepted || rejected != attempts-current.accepted {
				t.Errorf("concurrent attempts accepted=%d rejected=%d; want accepted=%d rejected=%d",
					accepted, rejected, current.accepted, attempts-current.accepted)
			}
			wantMonth := quotaIntegrationExpectedCounters(fixture.at, int64(current.accepted),
				int64(current.accepted*10), int64(current.accepted*3), int64(current.accepted*2))[1]
			var dayTotals quotaIntegrationCounters
			months := 0
			for _, row := range fixture.counters(t) {
				if row.Kind == "month" {
					months++
					if row != wantMonth {
						t.Errorf("monthly concurrent counters = %+v; want %+v", row, wantMonth)
					}
					continue
				}
				if row.Requests > int64(current.limits.RequestsPerDay) || row.ReservedUnits > int64(current.limits.TokenUnitsPerDay) {
					t.Errorf("concurrent daily counters exceed caps: %+v", row)
				}
				dayTotals.Requests += row.Requests
				dayTotals.ReservedUnits += row.ReservedUnits
				dayTotals.InputTokens += row.InputTokens
				dayTotals.OutputTokens += row.OutputTokens
			}
			dayTotals.Kind, dayTotals.Start = wantMonth.Kind, wantMonth.Start
			if months != 1 || dayTotals != wantMonth {
				t.Errorf("daily sums = %+v, monthly rows = %d; want sums %+v and one monthly row", dayTotals, months, wantMonth)
			}
			t.Logf("%d simultaneous attempts across two pools: %d accepted, %d rejected; counters checked", attempts, accepted, rejected)
		})
	}
}
