package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jinalegwu1/my-padi/backend/internal/auth"
	"github.com/jinalegwu1/my-padi/backend/internal/config"
	"github.com/jinalegwu1/my-padi/backend/internal/database"
	"os"
	"os/exec"
	"testing"
	"time"
)

// Browser harness uses only a synthetic account and public speech fixture.
func TestHandsfreeBrowser(t *testing.T) {
	if os.Getenv("PADI_VERIFY_VOICE_BROWSER") != "1" {
		t.Skip("explicit browser voice verification disabled")
	}
	if os.Getenv("PADI_VERIFY_VOICE_LATENCY") == "1" {
		runBrowserVerification(t, 2*time.Hour)
		return
	}
	runBrowserVerification(t, 6*time.Minute)
}

func TestPersonalityBrowser(t *testing.T) {
	if os.Getenv("PADI_VERIFY_PERSONALITY_BROWSER") != "1" {
		t.Skip("explicit live personality verification disabled")
	}
	runBrowserVerification(t, 14*time.Minute)
}

func runBrowserVerification(t *testing.T, timeout time.Duration) {
	t.Helper()
	if os.Getenv("PADI_ENV") != "development" {
		t.Fatal("browser test requires development mode")
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	db, err := database.Open(ctx, config.Load().DatabaseURL)
	if err != nil {
		t.Fatal("database unavailable")
	}
	defer db.Close()
	store, err := database.NewAuthStore(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	service, err := auth.NewDevelopmentService(store)
	if err != nil {
		t.Fatal(err)
	}
	seed := time.Now().UnixNano()
	phone := fmt.Sprintf("+1%010d", seed%10_000_000_000)
	result, err := service.RequestRegistration(ctx, auth.Profile{FullName: "Voice Browser Verification", DateOfBirth: "1990-01-01", PhoneNumber: phone}, fmt.Sprintf("voice-browser-%d", seed))
	if err != nil || result.Session == nil {
		t.Fatal("synthetic registration failed")
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := db.ExecContext(cleanup, `DELETE FROM users WHERE id=$1`, result.Session.User.ID); err != nil {
			t.Error("synthetic account cleanup failed")
		}
		if _, err := db.ExecContext(cleanup, `DELETE FROM auth_challenges WHERE phone_number=$1`, phone); err != nil {
			t.Error("synthetic challenge cleanup failed")
		}
	}()
	file, err := os.CreateTemp("", "padi-browser-session-*.json")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(file.Name())
	if err := json.NewEncoder(file).Encode(result.Session); err != nil {
		t.Fatal(err)
	}
	file.Close()
	command := exec.CommandContext(ctx, "node", os.Getenv("PADI_VOICE_BROWSER_SCRIPT"), file.Name())
	command.Env = []string{"PATH=" + os.Getenv("PATH")}
	// The browser receives public test settings and its synthetic session only.
	// Backend provider keys, database credentials, and the internal voice token
	// stay in Go; none are inherited by the browser driver.
	for _, name := range []string{"PADI_VOICE_TEST_AUDIO_PATH", "PADI_VOICE_API_URL", "PADI_VOICE_FRONTEND_URL", "PADI_VOICE_BROWSER_EXECUTABLE", "PADI_VOICE_BROWSER_FAILURES_ONLY", "PADI_VERIFY_VOICE_LATENCY", "SystemRoot", "WINDIR", "TMP", "TEMP"} {
		if value := os.Getenv(name); value != "" {
			command.Env = append(command.Env, name+"="+value)
		}
	}
	if os.Getenv("PADI_VERIFY_VOICE_LATENCY") == "1" {
		command.Stdout, command.Stderr = os.Stdout, os.Stderr
		if err := command.Run(); err != nil {
			t.Fatal(err)
		}
		return
	}
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("browser verification failed: %s", output)
	}
	t.Log(string(output))
}
