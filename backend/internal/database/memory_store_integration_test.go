package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jinalegwu1/my-padi/backend/internal/memory"
)

// These checks create only their own synthetic users and delete them on cleanup.
// They do not inspect or alter any existing account or provider usage counters.
func memoryFixture(t *testing.T) (context.Context, *sql.DB, *MemoryStore, string, string) {
	t.Helper()
	url := os.Getenv("PADI_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set PADI_TEST_DATABASE_URL for PostgreSQL memory tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	t.Cleanup(cancel)
	db, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	store, err := NewMemoryStore(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	seed := time.Now().UnixNano()
	first, second := fmt.Sprintf("memory-test-a-%d", seed), fmt.Sprintf("memory-test-b-%d", seed)
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := db.ExecContext(cleanup, `DELETE FROM users WHERE id = $1 OR id = $2`, first, second); err != nil {
			t.Error("could not clean up memory test accounts")
		}
	})
	for i, id := range []string{first, second} {
		phone := fmt.Sprintf("+1%010d", (seed+int64(i))%10_000_000_000)
		if _, err := db.ExecContext(ctx, `INSERT INTO users (id, full_name, date_of_birth, phone_number) VALUES ($1, 'Memory Test', '1990-01-01', $2)`, id, phone); err != nil {
			t.Fatal(err)
		}
	}
	return ctx, db, store, first, second
}

func TestPostgresMemoryConsentOwnershipAndPersistence(t *testing.T) {
	ctx, db, store, owner, other := memoryFixture(t)
	snapshot, err := store.Snapshot(ctx, owner)
	if err != nil || snapshot.Enabled || snapshot.Revision != 0 || len(snapshot.Items) != 0 {
		t.Fatal("new account did not start with empty, disabled memory")
	}
	draft := memory.Draft{Category: "interests", Label: "Favourite fruit", Value: "Mango", Approved: true}
	if _, err := store.Create(ctx, owner, draft); !errors.Is(err, memory.ErrDisabled) {
		t.Fatal("saving was allowed before consent")
	}
	if _, err := store.SetEnabled(ctx, owner, true); err != nil {
		t.Fatal(err)
	}
	unapproved := draft
	unapproved.Approved = false
	if _, err := store.Create(ctx, owner, unapproved); !errors.Is(err, memory.ErrInvalid) {
		t.Fatal("unapproved memory was saved")
	}
	snapshot, err = store.Create(ctx, owner, draft)
	if err != nil || snapshot.Revision != 2 || len(snapshot.Items) != 1 {
		t.Fatal("approved memory was not saved")
	}
	id := snapshot.Items[0].ID
	value := "Pineapple"
	if _, err := store.Update(ctx, other, id, memory.Update{Value: &value}); !errors.Is(err, memory.ErrNotFound) {
		t.Fatal("another account changed a memory")
	}
	if _, err := store.Delete(ctx, other, id); !errors.Is(err, memory.ErrNotFound) {
		t.Fatal("another account deleted a memory")
	}
	otherSnapshot, err := store.Snapshot(ctx, other)
	if err != nil || len(otherSnapshot.Items) != 0 || otherSnapshot.Enabled || otherSnapshot.Revision != 0 {
		t.Fatal("memory or consent leaked across accounts")
	}
	snapshot, err = store.Update(ctx, owner, id, memory.Update{Value: &value})
	if err != nil || snapshot.Revision != 3 || snapshot.Items[0].Value != value {
		t.Fatal("correction did not persist")
	}
	paused := true
	snapshot, err = store.Update(ctx, owner, id, memory.Update{Paused: &paused})
	if err != nil || snapshot.Revision != 4 || len(memory.Relevant(snapshot, "favourite fruit")) != 0 {
		t.Fatal("paused memory remained available to AI")
	}
	snapshot, err = store.SetEnabled(ctx, owner, false)
	if err != nil || snapshot.Enabled || snapshot.Revision != 5 {
		t.Fatal("consent could not be revoked")
	}
	if _, err := store.Create(ctx, owner, draft); !errors.Is(err, memory.ErrDisabled) {
		t.Fatal("saving continued after consent revocation")
	}
	// Review and correction remain available while memory use is off.
	value = "Orange"
	if _, err := store.Update(ctx, owner, id, memory.Update{Value: &value}); err != nil {
		t.Fatal(err)
	}
	independent, err := Open(ctx, os.Getenv("PADI_TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer independent.Close()
	fresh, err := NewMemoryStore(ctx, independent)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err = fresh.Snapshot(ctx, owner)
	if err != nil || snapshot.Enabled || snapshot.Revision != 6 || len(snapshot.Items) != 1 || snapshot.Items[0].Value != "Orange" {
		t.Fatal("memory state was not persistent across independent pools")
	}
	snapshot, err = store.Delete(ctx, owner, id)
	if err != nil || snapshot.Revision != 7 || len(snapshot.Items) != 0 {
		t.Fatal("deletion did not persist")
	}
	var count int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM user_memories WHERE user_id = $1`, owner).Scan(&count); err != nil || count != 0 {
		t.Fatal("deleted memory remains in PostgreSQL")
	}
}

func TestPostgresMemoryConcurrentCapacityAndFailureRollback(t *testing.T) {
	ctx, db, store, owner, _ := memoryFixture(t)
	if _, err := store.SetEnabled(ctx, owner, true); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO user_memories (id, user_id, category, label, value)
		SELECT $1 || '-' || number::text, $1, 'preferences', 'Fixture', 'Test-only fact'
		FROM generate_series(1, 99) AS number`, owner); err != nil {
		t.Fatal(err)
	}
	var wait sync.WaitGroup
	errorsOut := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			_, err := store.Create(ctx, owner, memory.Draft{Category: "name", Label: "Test", Value: "Approved test", Approved: true})
			errorsOut <- err
		}()
	}
	wait.Wait()
	close(errorsOut)
	successes, blocked := 0, 0
	for err := range errorsOut {
		if err == nil {
			successes++
		} else if errors.Is(err, memory.ErrFull) {
			blocked++
		} else {
			t.Fatal(err)
		}
	}
	snapshot, err := store.Snapshot(ctx, owner)
	if err != nil || successes != 1 || blocked != 1 || len(snapshot.Items) != 100 || snapshot.Revision != 2 {
		t.Fatal("concurrent saves exceeded capacity or failed to roll back")
	}
	before := snapshot.Revision
	if _, err := store.Delete(ctx, owner, "not-an-owned-memory"); !errors.Is(err, memory.ErrNotFound) {
		t.Fatal("unknown deletion succeeded")
	}
	snapshot, err = store.Snapshot(ctx, owner)
	if err != nil || snapshot.Revision != before || len(snapshot.Items) != 100 {
		t.Fatal("failed operation changed memory state")
	}
}
