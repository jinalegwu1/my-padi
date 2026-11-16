CREATE TABLE auth_challenges (
    id TEXT PRIMARY KEY,
    phone_number VARCHAR(16) NOT NULL
        CHECK (phone_number ~ '^\+[1-9][0-9]{7,14}$'),
    full_name TEXT,
    date_of_birth DATE,
    purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
    code_hash BYTEA NOT NULL CHECK (octet_length(code_hash) = 32),
    expires_at TIMESTAMPTZ NOT NULL,
    attempt_count SMALLINT NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (purpose = 'register' AND full_name IS NOT NULL AND date_of_birth IS NOT NULL)
        OR (purpose = 'login' AND full_name IS NULL AND date_of_birth IS NULL)
    )
);
