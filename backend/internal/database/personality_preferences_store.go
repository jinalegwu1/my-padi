package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/jinalegwu1/my-padi/backend/internal/personality"
)

type PersonalityPreferencesStore struct{ db *sql.DB }

func NewPersonalityPreferencesStore(ctx context.Context, db *sql.DB) (*PersonalityPreferencesStore, error) {
	if db == nil {
		return nil, errors.New("PostgreSQL is required for personality preferences")
	}
	var ready bool
	if err := db.QueryRowContext(ctx, `SELECT to_regclass('public.user_personality_preferences') IS NOT NULL`).Scan(&ready); err != nil {
		return nil, fmt.Errorf("check personality preferences schema: %w", err)
	}
	if !ready {
		return nil, errors.New("personality preferences schema is missing; run migrations")
	}
	return &PersonalityPreferencesStore{db: db}, nil
}

func (store *PersonalityPreferencesStore) Get(ctx context.Context, userID string) (personality.Preferences, error) {
	preferences := personality.DefaultPreferences()
	err := store.db.QueryRowContext(ctx, `SELECT humour, humour_explicit, tone, learn_from_feedback
		FROM user_personality_preferences WHERE user_id = $1`, userID).Scan(
		&preferences.Humour, &preferences.HumourExplicit, &preferences.Tone, &preferences.LearnFromFeedback,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return preferences, nil
	}
	if err != nil {
		return personality.Preferences{}, fmt.Errorf("read personality preferences: %w", err)
	}
	return preferences, nil
}

func (store *PersonalityPreferencesStore) Update(ctx context.Context, userID string, patch personality.PreferencesPatch) (personality.Preferences, error) {
	patch, err := personality.NormalizePreferencesPatch(patch)
	if err != nil {
		return personality.Preferences{}, err
	}
	var humour, tone any
	var learnFromFeedback any
	if patch.Humour != nil {
		humour = string(*patch.Humour)
	}
	if patch.Tone != nil {
		tone = string(*patch.Tone)
	}
	if patch.LearnFromFeedback != nil {
		learnFromFeedback = *patch.LearnFromFeedback
	}
	_, err = store.db.ExecContext(ctx, `INSERT INTO user_personality_preferences
		(user_id, humour, humour_explicit, tone, learn_from_feedback)
		VALUES ($1, COALESCE($2, 'occasional'), ($2 IS NOT NULL), COALESCE($3, 'adaptive'), COALESCE($4, false))
		ON CONFLICT (user_id) DO UPDATE SET
			humour = COALESCE($2, user_personality_preferences.humour),
			humour_explicit = CASE WHEN $2 IS NOT NULL THEN true ELSE user_personality_preferences.humour_explicit END,
			tone = COALESCE($3, user_personality_preferences.tone),
			learn_from_feedback = COALESCE($4, user_personality_preferences.learn_from_feedback),
			updated_at = now()`,
		userID, humour, tone, learnFromFeedback)
	if err != nil {
		return personality.Preferences{}, fmt.Errorf("update personality preferences: %w", err)
	}
	return store.Get(ctx, userID)
}
