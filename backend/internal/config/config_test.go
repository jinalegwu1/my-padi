package config

import "testing"

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
