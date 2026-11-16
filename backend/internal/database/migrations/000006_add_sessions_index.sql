CREATE INDEX sessions_user_expires_at_idx
    ON sessions (user_id, expires_at);
