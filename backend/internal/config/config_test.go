package config

import "testing"

func TestDevelopmentOTPBypass(t *testing.T) {
	for _, test := range []struct {
		name, environment, flag string
		want                    bool
		wantError               bool
	}{
		{name: "default keeps OTP", environment: "production"},
		{name: "explicit disabled switch", environment: "production", flag: "false"},
		{name: "development opt in", environment: "development", flag: "true", want: true},
		{name: "production rejected", environment: "production", flag: "true", wantError: true},
		{name: "missing environment rejected", flag: "true", wantError: true},
		{name: "invalid flag rejected", environment: "development", flag: "typo", wantError: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("PADI_ENV", test.environment)
			t.Setenv("PADI_DEV_BYPASS_OTP", test.flag)
			got, err := DevelopmentOTPBypass()
			if got != test.want || (err != nil) != test.wantError {
				t.Fatalf("DevelopmentOTPBypass() = %v, %v; want %v, error=%v", got, err, test.want, test.wantError)
			}
		})
	}
}

func TestDevelopmentAIUsageBypass(t *testing.T) {
	for _, test := range []struct {
		name, environment, flag string
		want, wantError         bool
	}{
		{name: "absent keeps caps", environment: "production"},
		{name: "false keeps caps", environment: "development", flag: "false"},
		{name: "development opt in", environment: "development", flag: "true", want: true},
		{name: "production rejected", environment: "production", flag: "true", wantError: true},
		{name: "unset environment rejected", flag: "true", wantError: true},
		{name: "invalid flag rejected", environment: "development", flag: "typo", wantError: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("PADI_ENV", test.environment)
			t.Setenv("PADI_DEV_BYPASS_AI_USAGE_LIMITS", test.flag)
			got, err := DevelopmentAIUsageBypass()
			if got != test.want || (err != nil) != test.wantError {
				t.Fatalf("DevelopmentAIUsageBypass() = %v, %v; want %v, error=%v", got, err, test.want, test.wantError)
			}
		})
	}
}

func TestLoad(t *testing.T) {
	t.Setenv("PADI_DATABASE_URL", "")
	t.Setenv("DATABASE_URL", "")
	tests := []struct {
		name    string
		address string
		want    string
	}{
		{name: "default address", address: "", want: ":8080"},
		{name: "configured address", address: "127.0.0.1:9090", want: "127.0.0.1:9090"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("PADI_HTTP_ADDR", test.address)

			if got := Load().HTTPAddr; got != test.want {
				t.Errorf("HTTPAddr = %q, want %q", got, test.want)
			}
		})
	}
}

func TestLoadDatabaseURL(t *testing.T) {
	t.Setenv("PADI_HTTP_ADDR", "")
	t.Setenv("DATABASE_URL", "postgres://localhost:5432/padi?sslmode=disable")
	t.Setenv("PADI_DATABASE_URL", "")

	if got := Load().DatabaseURL; got != "postgres://localhost:5432/padi?sslmode=disable" {
		t.Errorf("DatabaseURL = %q, want configured URL", got)
	}
}

func TestLoadLegacyDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("PADI_DATABASE_URL", "postgres://localhost:5432/legacy?sslmode=disable")

	if got := Load().DatabaseURL; got != "postgres://localhost:5432/legacy?sslmode=disable" {
		t.Errorf("DatabaseURL = %q, want legacy configured URL", got)
	}
}

func TestLoadPrefersDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost:5432/current?sslmode=disable")
	t.Setenv("PADI_DATABASE_URL", "postgres://localhost:5432/legacy?sslmode=disable")

	if got := Load().DatabaseURL; got != "postgres://localhost:5432/current?sslmode=disable" {
		t.Errorf("DatabaseURL = %q, want standard DATABASE_URL", got)
	}
}
