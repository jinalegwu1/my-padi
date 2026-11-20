package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/jinalegwu1/my-padi/backend/internal/checkins"
)

type CheckInPreferencesStore struct{ db *sql.DB }

func NewCheckInPreferencesStore(ctx context.Context, db *sql.DB) (*CheckInPreferencesStore, error) {
	if db == nil {
		return nil, errors.New("PostgreSQL is required for check-in preferences")
	}
	var ready bool
	if err := db.QueryRowContext(ctx, `SELECT to_regclass('public.user_check_in_preferences') IS NOT NULL`).Scan(&ready); err != nil {
		return nil, fmt.Errorf("check check-in preferences schema: %w", err)
	}
	if !ready {
		return nil, errors.New("check-in preferences schema is missing; run migrations")
	}
	return &CheckInPreferencesStore{db: db}, nil
}

func (store *CheckInPreferencesStore) Get(ctx context.Context, userID string) (checkins.Preferences, error) {
	preferences := checkins.DefaultPreferences()
	err := store.db.QueryRowContext(ctx, `SELECT morning_enabled, morning_time,
		afternoon_enabled, afternoon_time, evening_enabled, evening_time, timezone,
		quiet_hours_enabled, quiet_hours_start, quiet_hours_end
		FROM user_check_in_preferences WHERE user_id = $1`, userID).Scan(
		&preferences.MorningEnabled, &preferences.MorningTime,
		&preferences.AfternoonEnabled, &preferences.AfternoonTime,
		&preferences.EveningEnabled, &preferences.EveningTime, &preferences.Timezone,
		&preferences.QuietHoursEnabled, &preferences.QuietHoursStart, &preferences.QuietHoursEnd,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return preferences, nil
	}
	if err != nil {
		return checkins.Preferences{}, fmt.Errorf("read check-in preferences: %w", err)
	}
	return preferences, nil
}

func (store *CheckInPreferencesStore) Update(ctx context.Context, userID string, patch checkins.PreferencesPatch) (checkins.Preferences, error) {
	patch, err := checkins.NormalizePreferencesPatch(patch)
	if err != nil {
		return checkins.Preferences{}, err
	}
	values := make([]any, 10)
	if patch.MorningEnabled != nil {
		values[0] = *patch.MorningEnabled
	}
	if patch.MorningTime != nil {
		values[1] = *patch.MorningTime
	}
	if patch.AfternoonEnabled != nil {
		values[2] = *patch.AfternoonEnabled
	}
	if patch.AfternoonTime != nil {
		values[3] = *patch.AfternoonTime
	}
	if patch.EveningEnabled != nil {
		values[4] = *patch.EveningEnabled
	}
	if patch.EveningTime != nil {
		values[5] = *patch.EveningTime
	}
	if patch.Timezone != nil {
		values[6] = *patch.Timezone
	}
	if patch.QuietHoursEnabled != nil {
		values[7] = *patch.QuietHoursEnabled
	}
	if patch.QuietHoursStart != nil {
		values[8] = *patch.QuietHoursStart
	}
	if patch.QuietHoursEnd != nil {
		values[9] = *patch.QuietHoursEnd
	}
	args := append([]any{userID}, values...)
	_, err = store.db.ExecContext(ctx, `INSERT INTO user_check_in_preferences (
		user_id, morning_enabled, morning_time, afternoon_enabled, afternoon_time,
		evening_enabled, evening_time, timezone, quiet_hours_enabled, quiet_hours_start, quiet_hours_end
	) VALUES ($1, COALESCE($2, false), COALESCE($3, '09:00'), COALESCE($4, false),
		COALESCE($5, '13:00'), COALESCE($6, false), COALESCE($7, '19:00'), COALESCE($8, ''),
		COALESCE($9, true), COALESCE($10, '22:00'), COALESCE($11, '08:00'))
	ON CONFLICT (user_id) DO UPDATE SET
		morning_enabled = COALESCE($2, user_check_in_preferences.morning_enabled),
		morning_time = COALESCE($3, user_check_in_preferences.morning_time),
		afternoon_enabled = COALESCE($4, user_check_in_preferences.afternoon_enabled),
		afternoon_time = COALESCE($5, user_check_in_preferences.afternoon_time),
		evening_enabled = COALESCE($6, user_check_in_preferences.evening_enabled),
		evening_time = COALESCE($7, user_check_in_preferences.evening_time),
		timezone = COALESCE($8, user_check_in_preferences.timezone),
		quiet_hours_enabled = COALESCE($9, user_check_in_preferences.quiet_hours_enabled),
		quiet_hours_start = COALESCE($10, user_check_in_preferences.quiet_hours_start),
		quiet_hours_end = COALESCE($11, user_check_in_preferences.quiet_hours_end),
		updated_at = now()`, args...)
	if err != nil {
		return checkins.Preferences{}, fmt.Errorf("update check-in preferences: %w", err)
	}
	return store.Get(ctx, userID)
}
