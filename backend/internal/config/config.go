package config

import (
	"errors"
	"os"
	"strconv"
)

// DevelopmentOTPBypass requires an explicit development environment. OTP stays
// enabled when the switch is absent or false.
func DevelopmentOTPBypass() (bool, error) {
	raw := os.Getenv("PADI_DEV_BYPASS_OTP")
	if raw == "" {
		return false, nil
	}
	enabled, err := strconv.ParseBool(raw)
	if err != nil {
		return false, errors.New("PADI_DEV_BYPASS_OTP must be true or false")
	}
	if enabled && os.Getenv("PADI_ENV") != "development" {
		return false, errors.New("OTP bypass requires PADI_ENV=development")
	}
	return enabled, nil
}

// DevelopmentAIUsageBypass disables PADI-side caps only in explicit development
// environments. Provider limits and PostgreSQL usage recording still apply.
func DevelopmentAIUsageBypass() (bool, error) {
	raw := os.Getenv("PADI_DEV_BYPASS_AI_USAGE_LIMITS")
	if raw == "" {
		return false, nil
	}
	enabled, err := strconv.ParseBool(raw)
	if err != nil {
		return false, errors.New("PADI_DEV_BYPASS_AI_USAGE_LIMITS must be true or false")
	}
	if enabled && os.Getenv("PADI_ENV") != "development" {
		return false, errors.New("AI usage bypass requires PADI_ENV=development")
	}
	return enabled, nil
}

// Config contains the settings needed to start the API.
type Config struct {
	HTTPAddr    string
	DatabaseURL string
}

// Load reads configuration from the environment.
func Load() Config {
	address := os.Getenv("PADI_HTTP_ADDR")
	if address == "" {
		address = ":8080"
	}

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		databaseURL = os.Getenv("PADI_DATABASE_URL")
	}

	return Config{
		HTTPAddr:    address,
		DatabaseURL: databaseURL,
	}
}
