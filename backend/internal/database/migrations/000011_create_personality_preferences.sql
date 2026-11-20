CREATE TABLE user_personality_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    humour TEXT NOT NULL DEFAULT 'occasional'
        CHECK (humour IN ('off', 'subtle', 'occasional', 'frequent')),
    humour_explicit BOOLEAN NOT NULL DEFAULT false,
    tone TEXT NOT NULL DEFAULT 'adaptive'
        CHECK (tone IN ('adaptive', 'playful', 'serious', 'gentle', 'direct')),
    learn_from_feedback BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
