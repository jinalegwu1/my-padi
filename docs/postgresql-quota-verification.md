# PostgreSQL quota verification

Date: 2026-11-17. Current feature status: **Verified**.

The existing quota system was tested against a real, disposable PostgreSQL
16.15 database. The application database was not changed. A minimal quota
correction was first tested using Go's source overlay, then applied after the
user approved it and verified again against the actual repository source.

## Results against the existing implementation

All eight embedded migrations applied successfully. Reapplying them preserved
the migration versions and original application timestamps. Database check
constraints rejected negative counters and invalid period types.

The tests passed for:

- The configured defaults: 20 requests/day, 300 requests/month, 25,000 reserved
  token units/day, and 250,000/month per provider.
- Separate daily/monthly request and token limits, including exact boundaries.
- Transaction rollback when monthly rejection follows a daily counter update
  or insertion; rejected requests left the ledger unchanged.
- Atomic actual-token recording, including rollback when the monthly row was
  deliberately removed for the test's own provider.
- Cancellation while a real PostgreSQL row lock blocked the monthly update;
  the earlier daily update was rolled back.
- UTC day/month rollover, preservation of monthly limits across days, provider
  isolation, persistence across independent connection pools, and failure
  when the database was unavailable.
- The existing PostgreSQL authentication/session integration test.

Four concurrency scenarios each launched 100 simultaneous attempts through
two independent connection pools. Daily and monthly request caps each accepted
20 and rejected 80. Daily and monthly token caps each accepted 7 reservations
of 10 units and rejected 93 against a 70-unit budget. The monthly scenarios
used five different days. Persisted daily/monthly request, reservation, and
actual-token totals matched the accepted requests; no unexpected database
errors occurred.

## Confirmed defect

The first reservation in an empty period bypasses the token limit. The SQL
`WHERE` checks apply to `ON CONFLICT ... DO UPDATE`, while the initial
`INSERT ... VALUES` has no equivalent cap check.

The real database accepted a first reservation of **25,001 units** against
the default **25,000-unit daily cap** and committed both period rows. A separate
test isolating the monthly cap also accepted 101 units against a 100-unit
monthly cap. Both regression tests failed against the existing implementation.

The defect was corrected with the user-approved checks described below.

## Applied correction and validation

These checks were added to `AIUsageLimiter.Reserve`, immediately after its existing
positive-value validation and before starting the transaction:

```go
if tokenUnits > limits.TokenUnitsPerDay {
    return &ai.UsageLimitError{Provider: provider, Window: "daily"}
}
if tokenUnits > limits.TokenUnitsPerMonth {
    return &ai.UsageLimitError{Provider: provider, Window: "monthly"}
}
```

This retains the existing transaction and concurrency logic and needs no
schema migration. The complete backend suite, including real PostgreSQL
integration tests, passed with the proposed correction and the Go race
detector. After explicit user approval, the correction was applied to the
repository and the complete suite passed again with real PostgreSQL and the
race detector. `go vet ./...` and `git diff --check` also passed.

The reviewable patch and complete logs are under
`/tmp/my-padi-quota-verification/`:

- `quota-limit-fix.patch`
- `quota-tests.log` (existing implementation; two failing regression cases)
- `quota-proposed-fix-tests.log` (proposed correction; complete suite passes)
- `quota-final-tests.log` (actual corrected source; complete race suite passes)

## Reproduction

Use only an explicitly disposable database for integration tests. From
`backend/`, with `PADI_TEST_DATABASE_URL` configured:

```sh
DATABASE_URL="$PADI_TEST_DATABASE_URL" go run ./cmd/migrate
go test -race ./... -count=1
```

Without `PADI_TEST_DATABASE_URL`, the database integration tests skip; that
result alone does not verify the PostgreSQL quota system.
