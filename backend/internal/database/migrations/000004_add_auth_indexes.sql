CREATE INDEX auth_challenges_phone_created_at_idx
    ON auth_challenges (phone_number, created_at DESC);
