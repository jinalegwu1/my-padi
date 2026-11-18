package database

import (
	"context"
	"testing"
)

func TestOpenRejectsInvalidConnectionString(t *testing.T) {
	db, err := Open(context.Background(), "postgres://%")
	if err == nil {
		t.Fatal("Open() error = nil, want invalid connection string error")
	}
	if db != nil {
		t.Fatal("Open() returned a database pool for an invalid connection string")
	}
}

func TestReadMigrations(t *testing.T) {
	migrations, err := readMigrations()
	if err != nil {
		t.Fatalf("readMigrations() error = %v", err)
	}
	if len(migrations) != 9 {
		t.Fatalf("readMigrations() returned %d migrations, want 9", len(migrations))
	}

	for i, current := range migrations {
		if current.version != int64(i+1) {
			t.Errorf("migration %q has version %d, want %d", current.name, current.version, i+1)
		}
		if current.sql == "" {
			t.Errorf("migration %q has empty SQL", current.name)
		}
	}
}
