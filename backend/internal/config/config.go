package config

import "os"

// Config contains the settings needed to start the API.
type Config struct {
	HTTPAddr string
}

// Load reads configuration from the environment.
func Load() Config {
	address := os.Getenv("PADI_HTTP_ADDR")
	if address == "" {
		address = ":8080"
	}

	return Config{HTTPAddr: address}
}
