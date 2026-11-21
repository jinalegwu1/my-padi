package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jinalegwu1/my-padi/backend/internal/checkins"
	"github.com/jinalegwu1/my-padi/backend/internal/push"
)

type PushStore struct{ db *sql.DB }

func NewPushStore(ctx context.Context, db *sql.DB) (*PushStore, error) {
	if db == nil {
		return nil, errors.New("PostgreSQL is required for push notifications")
	}
	var ready bool
	if err := db.QueryRowContext(ctx, `SELECT
		to_regclass('public.padi_push_devices') IS NOT NULL AND
		to_regclass('public.padi_push_deliveries') IS NOT NULL`).Scan(&ready); err != nil {
		return nil, fmt.Errorf("check push notification schema: %w", err)
	}
	if !ready {
		return nil, errors.New("push notification schema is missing; run migrations")
	}
	return &PushStore{db: db}, nil
}

func (store *PushStore) Register(ctx context.Context, userID string, registration push.Registration) error {
	registration, err := push.NormalizeRegistration(registration)
	if err != nil {
		return err
	}
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin push device registration: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE padi_push_deliveries SET
		status = 'cancelled', updated_at = now()
		WHERE status IN ('pending', 'sending')
			AND (user_id <> $1 OR device_id <> $2)
			AND device_id IN (
				SELECT device_id FROM padi_push_devices
				WHERE device_id = $2 OR expo_push_token = $3
			)`, userID, registration.DeviceID, registration.Token); err != nil {
		return fmt.Errorf("cancel previous-account push deliveries: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM padi_push_devices
		WHERE device_id = $1 OR expo_push_token = $2`, registration.DeviceID, registration.Token); err != nil {
		return fmt.Errorf("replace push device registration: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO padi_push_devices
		(device_id, user_id, expo_push_token, platform, language)
		VALUES ($1, $2, $3, $4, $5)`,
		registration.DeviceID, userID, registration.Token, registration.Platform, registration.Language); err != nil {
		return fmt.Errorf("save push device registration: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit push device registration: %w", err)
	}
	return nil
}

func (store *PushStore) Unregister(ctx context.Context, userID, deviceID string) error {
	deviceID, err := push.NormalizeDeviceID(deviceID)
	if err != nil {
		return err
	}
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin push device removal: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE padi_push_deliveries SET
		status = 'cancelled', updated_at = now()
		WHERE user_id = $1 AND device_id = $2 AND status IN ('pending', 'sending')`,
		userID, deviceID); err != nil {
		return fmt.Errorf("cancel push deliveries for removed device: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM padi_push_devices WHERE user_id = $1 AND device_id = $2`,
		userID, deviceID); err != nil {
		return fmt.Errorf("remove push device: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit push device removal: %w", err)
	}
	return nil
}

func (store *PushStore) ScheduleDueCheckIns(ctx context.Context, now time.Time, grace time.Duration) error {
	rows, err := store.db.QueryContext(ctx, `SELECT p.user_id, d.device_id, d.language,
		p.morning_enabled, p.morning_time, p.afternoon_enabled, p.afternoon_time,
		p.evening_enabled, p.evening_time, p.timezone, p.quiet_hours_enabled,
		p.quiet_hours_start, p.quiet_hours_end
		FROM user_check_in_preferences p
		JOIN padi_push_devices d ON d.user_id = p.user_id
		WHERE p.morning_enabled OR p.afternoon_enabled OR p.evening_enabled`)
	if err != nil {
		return fmt.Errorf("read due check-in schedules: %w", err)
	}
	type candidate struct {
		userID, deviceID, language string
		preferences                checkins.Preferences
	}
	var candidates []candidate
	for rows.Next() {
		var item candidate
		if err := rows.Scan(
			&item.userID, &item.deviceID, &item.language,
			&item.preferences.MorningEnabled, &item.preferences.MorningTime,
			&item.preferences.AfternoonEnabled, &item.preferences.AfternoonTime,
			&item.preferences.EveningEnabled, &item.preferences.EveningTime,
			&item.preferences.Timezone, &item.preferences.QuietHoursEnabled,
			&item.preferences.QuietHoursStart, &item.preferences.QuietHoursEnd,
		); err != nil {
			rows.Close()
			return fmt.Errorf("read check-in schedule: %w", err)
		}
		candidates = append(candidates, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("iterate check-in schedules: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close check-in schedules: %w", err)
	}

	var failures []error
	for _, item := range candidates {
		dueSlots, err := checkins.DueSlots(item.preferences, now, grace)
		if err != nil {
			failures = append(failures, fmt.Errorf("evaluate check-in schedule: %w", err))
			continue
		}
		for _, due := range dueSlots {
			title, body, err := push.CheckInContent(item.language, due.Slot)
			if err != nil {
				failures = append(failures, err)
				continue
			}
			data, err := json.Marshal(map[string]string{
				"kind":  "padi_check_in",
				"slot":  due.Slot,
				"route": "/(tabs)/chat",
			})
			if err != nil {
				failures = append(failures, fmt.Errorf("encode check-in notification data: %w", err))
				continue
			}
			dedupeKey := "check_in:" + due.Slot + ":" + due.LocalDate
			if _, err := store.db.ExecContext(ctx, `INSERT INTO padi_push_deliveries
				(user_id, device_id, kind, slot, local_date, dedupe_key, title, body, data, scheduled_for)
				VALUES ($1, $2, 'check_in', $3, $4, $5, $6, $7, $8::jsonb, $9)
				ON CONFLICT (user_id, device_id, dedupe_key) DO NOTHING`,
				item.userID, item.deviceID, due.Slot, due.LocalDate, dedupeKey,
				title, body, string(data), due.Scheduled.UTC()); err != nil {
				failures = append(failures, fmt.Errorf("enqueue check-in notification: %w", err))
			}
		}
	}
	return errors.Join(failures...)
}

func (store *PushStore) ClaimPending(ctx context.Context, now time.Time, limit int) ([]push.Delivery, error) {
	if limit < 1 || limit > 500 {
		return nil, errors.New("push delivery batch size is invalid")
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE padi_push_deliveries SET
		status = 'failed', last_error_code = 'worker_timeout', updated_at = $1
		WHERE status = 'sending' AND attempts >= 5 AND updated_at < ($1::timestamptz - interval '10 minutes')`, now); err != nil {
		return nil, fmt.Errorf("expire stalled push deliveries: %w", err)
	}
	rows, err := store.db.QueryContext(ctx, `WITH available AS (
		SELECT d.id FROM padi_push_deliveries d
		JOIN padi_push_devices p ON p.device_id = d.device_id AND p.user_id = d.user_id
		WHERE d.attempts < 5 AND (
			(d.status = 'pending' AND d.next_attempt_at <= $1) OR
			(d.status = 'sending' AND d.updated_at < ($1::timestamptz - interval '5 minutes'))
		)
		ORDER BY d.scheduled_for, d.id
		LIMIT $2
		FOR UPDATE OF d SKIP LOCKED
	), claimed AS (
		UPDATE padi_push_deliveries d
		SET status = 'sending', attempts = d.attempts + 1, updated_at = $1
		FROM available a
		WHERE d.id = a.id
		RETURNING d.id, d.user_id, d.device_id, d.title, d.body, d.data, d.attempts
	)
	SELECT c.id, c.user_id, c.device_id, p.expo_push_token, c.title, c.body,
		c.data::text, c.attempts
	FROM claimed c
	JOIN padi_push_devices p ON p.device_id = c.device_id AND p.user_id = c.user_id
	ORDER BY c.id`, now, limit)
	if err != nil {
		return nil, fmt.Errorf("claim pending push deliveries: %w", err)
	}
	defer rows.Close()
	var deliveries []push.Delivery
	for rows.Next() {
		var delivery push.Delivery
		var data string
		if err := rows.Scan(&delivery.ID, &delivery.UserID, &delivery.DeviceID, &delivery.Token,
			&delivery.Title, &delivery.Body, &data, &delivery.Attempts); err != nil {
			return nil, fmt.Errorf("read claimed push delivery: %w", err)
		}
		if err := json.Unmarshal([]byte(data), &delivery.Data); err != nil {
			return nil, fmt.Errorf("decode claimed push delivery data: %w", err)
		}
		deliveries = append(deliveries, delivery)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate claimed push deliveries: %w", err)
	}
	return deliveries, nil
}

func (store *PushStore) RecordAccepted(ctx context.Context, deliveryID int64, ticketID string, now time.Time) error {
	result, err := store.db.ExecContext(ctx, `UPDATE padi_push_deliveries
		SET status = 'accepted', expo_ticket_id = $2, accepted_at = $3, updated_at = $3
		WHERE id = $1 AND status = 'sending'`, deliveryID, ticketID, now)
	if err != nil {
		return fmt.Errorf("record accepted push delivery: %w", err)
	}
	return requireOneRow(result, "accepted push delivery")
}

func (store *PushStore) RecordFailure(ctx context.Context, delivery push.Delivery, code string, retryAt time.Time, retry, deviceNotRegistered bool, now time.Time) error {
	status := "failed"
	if retry {
		status = "pending"
	} else {
		retryAt = now
	}
	result, err := store.db.ExecContext(ctx, `UPDATE padi_push_deliveries
		SET status = $2, last_error_code = $3, next_attempt_at = $4, updated_at = $5
		WHERE id = $1 AND status = 'sending'`,
		delivery.ID, status, code, retryAt, now)
	if err != nil {
		return fmt.Errorf("record failed push delivery: %w", err)
	}
	if err := requireOneRow(result, "failed push delivery"); err != nil {
		return err
	}
	if deviceNotRegistered {
		if _, err := store.db.ExecContext(ctx, `UPDATE padi_push_deliveries
			SET status = 'cancelled', updated_at = $3
			WHERE user_id = $1 AND device_id = $2 AND status IN ('pending', 'sending')`,
			delivery.UserID, delivery.DeviceID, now); err != nil {
			return fmt.Errorf("cancel pending deliveries for unregistered device: %w", err)
		}
		if _, err := store.db.ExecContext(ctx, `DELETE FROM padi_push_devices
			WHERE user_id = $1 AND device_id = $2`, delivery.UserID, delivery.DeviceID); err != nil {
			return fmt.Errorf("remove unregistered push device: %w", err)
		}
	}
	return nil
}

func requireOneRow(result sql.Result, operation string) error {
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("%s rows affected: %w", operation, err)
	}
	if affected != 1 {
		return fmt.Errorf("%s lost its claimed state", operation)
	}
	return nil
}
