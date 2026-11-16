package database

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"errors"
	"fmt"
	"hash/fnv"
	"sort"
	"time"

	"github.com/jinalegwu1/my-padi/backend/internal/auth"
)

type AuthStore struct {
	db *sql.DB
}

func NewAuthStore(ctx context.Context, db *sql.DB) (*AuthStore, error) {
	if db == nil {
		return nil, errors.New("PostgreSQL connection is required for authentication")
	}
	var schemaReady bool
	if err := db.QueryRowContext(ctx, `
		SELECT to_regclass('public.users') IS NOT NULL
		   AND to_regclass('public.auth_challenges') IS NOT NULL
		   AND to_regclass('public.sessions') IS NOT NULL
		   AND EXISTS (
		       SELECT 1 FROM information_schema.columns
		       WHERE table_schema = 'public'
		         AND table_name = 'auth_challenges'
		         AND column_name = 'source_ip'
		   )
	`).Scan(&schemaReady); err != nil {
		return nil, fmt.Errorf("check authentication schema: %w", err)
	}
	if !schemaReady {
		return nil, errors.New("authentication schema is missing; run `go run ./cmd/migrate` before enabling phone authentication")
	}
	return &AuthStore{db: db}, nil
}

func (store *AuthStore) CreateChallenge(ctx context.Context, challenge auth.Challenge) (bool, error) {
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return false, fmt.Errorf("begin authentication challenge: %w", err)
	}
	defer tx.Rollback()

	keys := []int64{advisoryKey("phone:" + challenge.PhoneNumber)}
	if challenge.SourceIP != "" {
		keys = append(keys, advisoryKey("ip:"+challenge.SourceIP))
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })
	for _, key := range keys {
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1)`, key); err != nil {
			return false, fmt.Errorf("lock authentication challenge rate limit: %w", err)
		}
	}

	if _, err := tx.ExecContext(ctx, `
		DELETE FROM auth_challenges
		WHERE created_at < now() - interval '24 hours'
	`); err != nil {
		return false, fmt.Errorf("purge expired authentication challenges: %w", err)
	}

	var phoneCount int
	if err := tx.QueryRowContext(ctx, `
		SELECT count(*)
		FROM auth_challenges
		WHERE phone_number = $1 AND created_at >= now() - interval '15 minutes'
	`, challenge.PhoneNumber).Scan(&phoneCount); err != nil {
		return false, fmt.Errorf("check phone authentication rate limit: %w", err)
	}
	if phoneCount >= 3 {
		return false, auth.ErrRateLimited
	}
	var phoneDailyCount int
	if err := tx.QueryRowContext(ctx, `
		SELECT count(*)
		FROM auth_challenges
		WHERE phone_number = $1 AND created_at >= now() - interval '24 hours'
	`, challenge.PhoneNumber).Scan(&phoneDailyCount); err != nil {
		return false, fmt.Errorf("check daily phone authentication rate limit: %w", err)
	}
	if phoneDailyCount >= 10 {
		return false, auth.ErrRateLimited
	}
	if challenge.SourceIP != "" {
		var ipCount int
		if err := tx.QueryRowContext(ctx, `
			SELECT count(*)
			FROM auth_challenges
			WHERE source_ip = $1 AND created_at >= now() - interval '15 minutes'
		`, challenge.SourceIP).Scan(&ipCount); err != nil {
			return false, fmt.Errorf("check IP authentication rate limit: %w", err)
		}
		if ipCount >= 10 {
			return false, auth.ErrRateLimited
		}
		var ipHourlyCount int
		if err := tx.QueryRowContext(ctx, `
			SELECT count(*)
			FROM auth_challenges
			WHERE source_ip = $1 AND created_at >= now() - interval '1 hour'
		`, challenge.SourceIP).Scan(&ipHourlyCount); err != nil {
			return false, fmt.Errorf("check hourly IP authentication rate limit: %w", err)
		}
		if ipHourlyCount >= 20 {
			return false, auth.ErrRateLimited
		}
		var ipDailyCount int
		if err := tx.QueryRowContext(ctx, `
			SELECT count(*)
			FROM auth_challenges
			WHERE source_ip = $1 AND created_at >= now() - interval '24 hours'
		`, challenge.SourceIP).Scan(&ipDailyCount); err != nil {
			return false, fmt.Errorf("check daily IP authentication rate limit: %w", err)
		}
		if ipDailyCount >= 50 {
			return false, auth.ErrRateLimited
		}
	}

	var accountExists bool
	if err := tx.QueryRowContext(ctx,
		`SELECT EXISTS (SELECT 1 FROM users WHERE phone_number = $1)`,
		challenge.PhoneNumber,
	).Scan(&accountExists); err != nil {
		return false, fmt.Errorf("check authentication account: %w", err)
	}
	eligible := (challenge.Purpose == "register" && !accountExists) ||
		(challenge.Purpose == "login" && accountExists)
	if !eligible {
		if err := tx.Commit(); err != nil {
			return false, fmt.Errorf("finish authentication eligibility check: %w", err)
		}
		return false, nil
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE auth_challenges
		SET consumed_at = now()
		WHERE phone_number = $1 AND purpose = $2 AND consumed_at IS NULL
	`, challenge.PhoneNumber, challenge.Purpose); err != nil {
		return false, fmt.Errorf("expire previous authentication challenges: %w", err)
	}

	var dateOfBirth any
	if challenge.Purpose == "register" {
		dateOfBirth = challenge.DateOfBirth
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO auth_challenges (
			id, phone_number, full_name, date_of_birth, purpose,
			code_hash, expires_at, source_ip
		) VALUES ($1, $2, NULLIF($3, ''), $4::date, $5, $6, $7, $8)
	`, challenge.ID, challenge.PhoneNumber, challenge.FullName, dateOfBirth,
		challenge.Purpose, challenge.CodeHash, challenge.ExpiresAt, challenge.SourceIP); err != nil {
		return false, fmt.Errorf("store authentication challenge: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return false, fmt.Errorf("commit authentication challenge: %w", err)
	}
	return true, nil
}

func (store *AuthStore) CancelChallenge(ctx context.Context, challengeID string) error {
	if _, err := store.db.ExecContext(ctx, `
		UPDATE auth_challenges SET consumed_at = now()
		WHERE id = $1 AND consumed_at IS NULL
	`, challengeID); err != nil {
		return fmt.Errorf("invalidate unsent authentication challenge: %w", err)
	}
	return nil
}

func (store *AuthStore) VerifyChallenge(
	ctx context.Context,
	challengeID string,
	codeHash []byte,
	session auth.SessionRecord,
	now time.Time,
) (auth.User, error) {
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return auth.User{}, fmt.Errorf("begin authentication verification: %w", err)
	}
	defer tx.Rollback()

	var challenge struct {
		phone       string
		fullName    sql.NullString
		dateOfBirth sql.NullTime
		purpose     string
		codeHash    []byte
		expiresAt   time.Time
		attempts    int
		consumedAt  sql.NullTime
	}
	if err := tx.QueryRowContext(ctx, `
		SELECT phone_number, full_name, date_of_birth, purpose, code_hash,
		       expires_at, attempt_count, consumed_at
		FROM auth_challenges
		WHERE id = $1
		FOR UPDATE
	`, challengeID).Scan(
		&challenge.phone, &challenge.fullName, &challenge.dateOfBirth, &challenge.purpose,
		&challenge.codeHash, &challenge.expiresAt, &challenge.attempts, &challenge.consumedAt,
	); errors.Is(err, sql.ErrNoRows) {
		return auth.User{}, auth.ErrInvalidChallenge
	} else if err != nil {
		return auth.User{}, fmt.Errorf("load authentication challenge: %w", err)
	}

	if challenge.consumedAt.Valid || !challenge.expiresAt.After(now) || challenge.attempts >= 5 {
		if _, err := tx.ExecContext(ctx, `
			UPDATE auth_challenges
			SET consumed_at = COALESCE(consumed_at, $2)
			WHERE id = $1
		`, challengeID, now); err != nil {
			return auth.User{}, fmt.Errorf("expire authentication challenge: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return auth.User{}, fmt.Errorf("commit expired authentication challenge: %w", err)
		}
		return auth.User{}, auth.ErrInvalidChallenge
	}
	if subtle.ConstantTimeCompare(challenge.codeHash, codeHash) != 1 {
		if _, err := tx.ExecContext(ctx, `
			UPDATE auth_challenges
			SET attempt_count = attempt_count + 1,
			    consumed_at = CASE WHEN attempt_count >= 4 THEN $2 ELSE consumed_at END
			WHERE id = $1
		`, challengeID, now); err != nil {
			return auth.User{}, fmt.Errorf("record invalid authentication code: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return auth.User{}, fmt.Errorf("commit invalid authentication code: %w", err)
		}
		return auth.User{}, auth.ErrInvalidChallenge
	}

	if _, err := tx.ExecContext(ctx,
		`UPDATE auth_challenges SET consumed_at = $2 WHERE id = $1`,
		challengeID, now,
	); err != nil {
		return auth.User{}, fmt.Errorf("consume authentication challenge: %w", err)
	}

	var user auth.User
	if challenge.purpose == "register" {
		user = auth.User{ID: session.UserID, FullName: challenge.fullName.String}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO users (id, full_name, date_of_birth, phone_number)
			VALUES ($1, $2, $3::date, $4)
		`, user.ID, user.FullName, challenge.dateOfBirth.Time, challenge.phone); err != nil {
			return auth.User{}, fmt.Errorf("create authenticated user: %w", err)
		}
	} else {
		if err := tx.QueryRowContext(ctx, `
			SELECT id, full_name FROM users WHERE phone_number = $1
		`, challenge.phone).Scan(&user.ID, &user.FullName); err != nil {
			return auth.User{}, fmt.Errorf("load authenticated user: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO sessions (token_hash, user_id, expires_at)
		VALUES ($1, $2, $3)
	`, session.TokenHash, user.ID, session.ExpiresAt); err != nil {
		return auth.User{}, fmt.Errorf("create user session: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return auth.User{}, fmt.Errorf("commit authenticated session: %w", err)
	}
	return user, nil
}

func (store *AuthStore) ResolveSession(ctx context.Context, tokenHash []byte, now time.Time) (auth.User, error) {
	var user auth.User
	if err := store.db.QueryRowContext(ctx, `
		SELECT users.id, users.full_name
		FROM sessions
		JOIN users ON users.id = sessions.user_id
		WHERE sessions.token_hash = $1
		  AND sessions.expires_at > $2
		  AND sessions.revoked_at IS NULL
	`, tokenHash, now).Scan(&user.ID, &user.FullName); errors.Is(err, sql.ErrNoRows) {
		return auth.User{}, auth.ErrUnauthenticated
	} else if err != nil {
		return auth.User{}, fmt.Errorf("resolve user session: %w", err)
	}
	return user, nil
}

func (store *AuthStore) RevokeSession(ctx context.Context, tokenHash []byte, now time.Time) error {
	if _, err := store.db.ExecContext(ctx, `
		UPDATE sessions
		SET revoked_at = $2
		WHERE token_hash = $1 AND revoked_at IS NULL
	`, tokenHash, now); err != nil {
		return fmt.Errorf("revoke user session: %w", err)
	}
	return nil
}

func advisoryKey(value string) int64 {
	hash := fnv.New64a()
	_, _ = hash.Write([]byte(value))
	return int64(hash.Sum64())
}
