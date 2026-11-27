ALTER TABLE users ADD COLUMN country_code VARCHAR(2)
    CHECK (country_code ~ '^[A-Z]{2}$');
