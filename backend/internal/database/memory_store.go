package database

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"

	"github.com/jinalegwu1/my-padi/backend/internal/memory"
)

type MemoryStore struct{ db *sql.DB }

func NewMemoryStore(ctx context.Context, db *sql.DB) (*MemoryStore, error) {
	if db == nil {
		return nil, errors.New("PostgreSQL is required for personal memory")
	}
	var ready bool
	if err := db.QueryRowContext(ctx, `SELECT to_regclass('public.user_memories') IS NOT NULL
		AND to_regclass('public.user_memory_settings') IS NOT NULL`).Scan(&ready); err != nil {
		return nil, err
	}
	if !ready {
		return nil, errors.New("personal memory schema is missing; run npm run migrate")
	}
	return &MemoryStore{db}, nil
}

func (store *MemoryStore) Snapshot(ctx context.Context, userID string) (memory.Snapshot, error) {
	tx, err := store.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return memory.Snapshot{}, err
	}
	defer tx.Rollback()
	result, err := readMemorySnapshot(ctx, tx, userID)
	if err != nil {
		return memory.Snapshot{}, err
	}
	if err := tx.Commit(); err != nil {
		return memory.Snapshot{}, err
	}
	return result, nil
}

func readMemorySnapshot(ctx context.Context, tx *sql.Tx, userID string) (memory.Snapshot, error) {
	result := memory.Snapshot{Items: []memory.Item{}}
	err := tx.QueryRowContext(ctx, `SELECT enabled, revision FROM user_memory_settings WHERE user_id = $1`, userID).Scan(&result.Enabled, &result.Revision)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return memory.Snapshot{}, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT id, category, label, value, created_at, paused, source
		FROM user_memories WHERE user_id = $1 ORDER BY created_at DESC, id LIMIT $2`, userID, memory.MaxItems)
	if err != nil {
		return memory.Snapshot{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var item memory.Item
		if err := rows.Scan(&item.ID, &item.Category, &item.Label, &item.Value, &item.CreatedAt, &item.Paused, &item.Source); err != nil {
			return memory.Snapshot{}, err
		}
		result.Items = append(result.Items, item)
	}
	return result, rows.Err()
}

func (store *MemoryStore) write(ctx context.Context, userID string, operation func(*sql.Tx, bool) (bool, error)) (memory.Snapshot, error) {
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return memory.Snapshot{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `INSERT INTO user_memory_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, userID); err != nil {
		return memory.Snapshot{}, err
	}
	var enabled bool
	if err := tx.QueryRowContext(ctx, `SELECT enabled FROM user_memory_settings WHERE user_id = $1 FOR UPDATE`, userID).Scan(&enabled); err != nil {
		return memory.Snapshot{}, err
	}
	changed, err := operation(tx, enabled)
	if err != nil {
		return memory.Snapshot{}, err
	}
	if changed {
		if _, err := tx.ExecContext(ctx, `UPDATE user_memory_settings SET revision = revision + 1, updated_at = now() WHERE user_id = $1`, userID); err != nil {
			return memory.Snapshot{}, err
		}
	}
	result, err := readMemorySnapshot(ctx, tx, userID)
	if err != nil {
		return memory.Snapshot{}, err
	}
	if err := tx.Commit(); err != nil {
		return memory.Snapshot{}, err
	}
	return result, nil
}

func (store *MemoryStore) SetEnabled(ctx context.Context, userID string, enabled bool) (memory.Snapshot, error) {
	return store.write(ctx, userID, func(tx *sql.Tx, current bool) (bool, error) {
		if current == enabled {
			return false, nil
		}
		_, err := tx.ExecContext(ctx, `UPDATE user_memory_settings SET enabled = $2 WHERE user_id = $1`, userID, enabled)
		return true, err
	})
}

func (store *MemoryStore) Create(ctx context.Context, userID string, draft memory.Draft) (memory.Snapshot, error) {
	draft, err := memory.Normalize(draft)
	if err != nil {
		return memory.Snapshot{}, err
	}
	bytes := make([]byte, 18)
	if _, err := rand.Read(bytes); err != nil {
		return memory.Snapshot{}, fmt.Errorf("create memory ID: %w", err)
	}
	id := "mem_" + base64.RawURLEncoding.EncodeToString(bytes)
	return store.write(ctx, userID, func(tx *sql.Tx, enabled bool) (bool, error) {
		if !enabled {
			return false, memory.ErrDisabled
		}
		var count int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM user_memories WHERE user_id = $1`, userID).Scan(&count); err != nil {
			return false, err
		}
		if count >= memory.MaxItems {
			return false, memory.ErrFull
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO user_memories (id, user_id, category, label, value) VALUES ($1, $2, $3, $4, $5)`, id, userID, draft.Category, draft.Label, draft.Value)
		return true, err
	})
}

func (store *MemoryStore) Update(ctx context.Context, userID, id string, update memory.Update) (memory.Snapshot, error) {
	update, err := memory.NormalizeUpdate(update)
	if err != nil {
		return memory.Snapshot{}, err
	}
	return store.write(ctx, userID, func(tx *sql.Tx, _ bool) (bool, error) {
		result, err := tx.ExecContext(ctx, `UPDATE user_memories SET value = COALESCE($3, value), paused = COALESCE($4, paused),
			approved_at = CASE WHEN $3 IS NOT NULL THEN now() ELSE approved_at END, updated_at = now()
			WHERE user_id = $1 AND id = $2`, userID, id, update.Value, update.Paused)
		if err != nil {
			return false, err
		}
		count, err := result.RowsAffected()
		if err != nil {
			return false, err
		}
		if count == 0 {
			return false, memory.ErrNotFound
		}
		return true, nil
	})
}

func (store *MemoryStore) Delete(ctx context.Context, userID, id string) (memory.Snapshot, error) {
	return store.write(ctx, userID, func(tx *sql.Tx, _ bool) (bool, error) {
		result, err := tx.ExecContext(ctx, `DELETE FROM user_memories WHERE user_id = $1 AND id = $2`, userID, id)
		if err != nil {
			return false, err
		}
		count, err := result.RowsAffected()
		if err != nil {
			return false, err
		}
		if count == 0 {
			return false, memory.ErrNotFound
		}
		return true, nil
	})
}
