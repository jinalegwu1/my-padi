ALTER TABLE auth_challenges
    ADD COLUMN source_ip TEXT NOT NULL DEFAULT '';

CREATE INDEX auth_challenges_source_ip_created_at_idx
    ON auth_challenges (source_ip, created_at DESC)
    WHERE source_ip <> '';

CREATE INDEX auth_challenges_created_at_idx
    ON auth_challenges (created_at);
