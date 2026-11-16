CREATE TABLE ai_provider_usage_periods (
    provider TEXT NOT NULL,
    period_type TEXT NOT NULL CHECK (period_type IN ('day', 'month')),
    period_start DATE NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
    reserved_token_units BIGINT NOT NULL DEFAULT 0 CHECK (reserved_token_units >= 0),
    input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
    output_tokens BIGINT NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    PRIMARY KEY (provider, period_type, period_start)
);
