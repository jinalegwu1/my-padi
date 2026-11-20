package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jinalegwu1/my-padi/backend/internal/personality"
)

type ResponseFeedbackStore struct{ db *sql.DB }

func NewResponseFeedbackStore(ctx context.Context, db *sql.DB) (*ResponseFeedbackStore, error) {
	if db == nil {
		return nil, errors.New("PostgreSQL is required for response feedback")
	}
	var ready bool
	if err := db.QueryRowContext(ctx, `SELECT to_regclass('public.padi_response_feedback') IS NOT NULL`).Scan(&ready); err != nil {
		return nil, fmt.Errorf("check response feedback schema: %w", err)
	}
	if !ready {
		return nil, errors.New("response feedback schema is missing; run migrations")
	}
	return &ResponseFeedbackStore{db: db}, nil
}

func (store *ResponseFeedbackStore) Submit(ctx context.Context, userID string, feedback personality.Feedback) error {
	feedback, err := personality.NormalizeFeedback(feedback)
	if err != nil {
		return err
	}
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin response feedback: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1)`, advisoryKey("response-feedback:"+userID)); err != nil {
		return fmt.Errorf("lock response feedback: %w", err)
	}
	var exists bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (
		SELECT 1 FROM padi_response_feedback WHERE user_id = $1 AND message_id = $2
	)`, userID, feedback.MessageID).Scan(&exists); err != nil {
		return fmt.Errorf("check existing response feedback: %w", err)
	}
	if !exists {
		var count int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM padi_response_feedback
			WHERE user_id = $1 AND created_at >= $2`, userID, time.Now().Add(-24*time.Hour)).Scan(&count); err != nil {
			return fmt.Errorf("check response feedback rate: %w", err)
		}
		if count >= 100 {
			return personality.ErrFeedbackRateLimited
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO padi_response_feedback (user_id, message_id, rating)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, message_id) DO UPDATE SET rating = EXCLUDED.rating, updated_at = now()`,
		userID, feedback.MessageID, feedback.Rating); err != nil {
		return fmt.Errorf("store response feedback: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit response feedback: %w", err)
	}
	return nil
}

func (store *ResponseFeedbackStore) RecentHumourFeedback(ctx context.Context, userID string) (personality.FeedbackTrend, error) {
	var trend personality.FeedbackTrend
	err := store.db.QueryRowContext(ctx, `SELECT
		count(*) FILTER (WHERE rating = 'liked_humour'),
		count(*) FILTER (WHERE rating = 'unwanted_humour')
		FROM (
			SELECT rating FROM padi_response_feedback
			WHERE user_id = $1 AND created_at >= now() - interval '30 days'
				AND rating IN ('liked_humour', 'unwanted_humour')
			ORDER BY created_at DESC
			LIMIT 5
		) recent`, userID).Scan(&trend.LikedHumour, &trend.UnwantedHumour)
	if err != nil {
		return personality.FeedbackTrend{}, fmt.Errorf("read recent humour feedback: %w", err)
	}
	return trend, nil
}
