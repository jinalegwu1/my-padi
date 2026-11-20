CREATE TABLE padi_response_feedback (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id VARCHAR(128) NOT NULL
        CHECK (message_id ~ '^[A-Za-z0-9_-]{1,128}$'),
    rating TEXT NOT NULL
        CHECK (rating IN ('helpful', 'not_helpful', 'liked_humour', 'unwanted_humour')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, message_id)
);

CREATE INDEX padi_response_feedback_recent
    ON padi_response_feedback (user_id, created_at DESC);
