CREATE TABLE padi_push_devices (
    device_id TEXT PRIMARY KEY CHECK (char_length(device_id) BETWEEN 16 AND 128),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expo_push_token TEXT NOT NULL UNIQUE CHECK (char_length(expo_push_token) <= 256),
    platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
    language TEXT NOT NULL DEFAULT 'en-NG' CHECK (char_length(language) <= 35),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX padi_push_devices_user_idx ON padi_push_devices (user_id);

CREATE TABLE padi_push_deliveries (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind = 'check_in'),
    slot TEXT NOT NULL CHECK (slot IN ('morning', 'afternoon', 'evening')),
    local_date DATE NOT NULL,
    dedupe_key TEXT NOT NULL,
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 128),
    body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 512),
    data JSONB NOT NULL,
    scheduled_for TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sending', 'accepted', 'failed', 'cancelled')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expo_ticket_id TEXT,
    last_error_code TEXT,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, device_id, dedupe_key)
);

CREATE INDEX padi_push_deliveries_pending_idx
    ON padi_push_deliveries (next_attempt_at, scheduled_for, id)
    WHERE status IN ('pending', 'sending');

CREATE INDEX padi_push_deliveries_user_history_idx
    ON padi_push_deliveries (user_id, created_at DESC);
