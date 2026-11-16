CREATE TABLE users (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 120),
    date_of_birth DATE NOT NULL,
    phone_number VARCHAR(16) NOT NULL UNIQUE
        CHECK (phone_number ~ '^\+[1-9][0-9]{7,14}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
