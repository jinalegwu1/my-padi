CREATE TABLE user_check_in_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    morning_enabled BOOLEAN NOT NULL DEFAULT false,
    morning_time TEXT NOT NULL DEFAULT '09:00'
        CHECK (morning_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    afternoon_enabled BOOLEAN NOT NULL DEFAULT false,
    afternoon_time TEXT NOT NULL DEFAULT '13:00'
        CHECK (afternoon_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    evening_enabled BOOLEAN NOT NULL DEFAULT false,
    evening_time TEXT NOT NULL DEFAULT '19:00'
        CHECK (evening_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    timezone TEXT NOT NULL DEFAULT '' CHECK (char_length(timezone) <= 128),
    quiet_hours_enabled BOOLEAN NOT NULL DEFAULT true,
    quiet_hours_start TEXT NOT NULL DEFAULT '22:00'
        CHECK (quiet_hours_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    quiet_hours_end TEXT NOT NULL DEFAULT '08:00'
        CHECK (quiet_hours_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
