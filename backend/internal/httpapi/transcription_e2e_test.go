//go:build !windows

package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/jinalegwu1/my-padi/backend/internal/auth"
	"github.com/jinalegwu1/my-padi/backend/internal/config"
	"github.com/jinalegwu1/my-padi/backend/internal/database"
	"github.com/jinalegwu1/my-padi/backend/internal/voice"
)

func unusedLoopbackPort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port
}

// Explicit verification: real PostgreSQL authentication, the production Go
// route, the actual Python/Whisper workers and the exported PADI browser app.
// Only publicly licensed prerecorded fixtures enter the fake microphone.
func TestIncomingTranscriptionBrowser(t *testing.T) {
	if os.Getenv("PADI_VERIFY_TRANSCRIPTION") != "1" {
		t.Skip("explicit incoming browser/model verification disabled")
	}
	if os.Getenv("PADI_ENV") != "development" {
		t.Fatal("synthetic-account verification requires development mode")
	}
	root, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Minute)
	defer cancel()
	db, err := database.Open(ctx, config.Load().DatabaseURL)
	if err != nil {
		t.Fatal("test PostgreSQL is unavailable")
	}
	defer db.Close()
	store, err := database.NewAuthStore(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	authentication, err := auth.NewDevelopmentService(store)
	if err != nil {
		t.Fatal(err)
	}
	seed := time.Now().UnixNano()
	phone := fmt.Sprintf("+1%010d", seed%10_000_000_000)
	registration, err := authentication.RequestRegistration(ctx, auth.Profile{FullName: "Incoming Voice Verification", DateOfBirth: "1990-01-01", PhoneNumber: phone}, fmt.Sprintf("incoming-voice-%d", seed))
	if err != nil || registration.Session == nil {
		t.Fatal("synthetic registration failed")
	}
	defer func() {
		cleanup, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		if _, err := db.ExecContext(cleanup, `DELETE FROM users WHERE id=$1`, registration.Session.User.ID); err != nil {
			t.Error("synthetic account cleanup failed")
		}
		if _, err := db.ExecContext(cleanup, `DELETE FROM auth_challenges WHERE phone_number=$1`, phone); err != nil {
			t.Error("synthetic challenge cleanup failed")
		}
	}()

	privateToken, err := voice.NewRequestID()
	if err != nil {
		t.Fatal(err)
	}
	pythonPort, frontendPort := unusedLoopbackPort(t), unusedLoopbackPort(t)
	pythonURL := fmt.Sprintf("http://127.0.0.1:%d", pythonPort)
	frontendURL := fmt.Sprintf("http://127.0.0.1:%d", frontendPort)
	python := os.Getenv("PADI_VOICE_PYTHON")
	if python == "" {
		python = filepath.Join(root, "services/voice/.venv/bin/python")
	}
	model := os.Getenv("PADI_STT_MODEL")
	if model == "" {
		model = "base"
	}
	modelPath := os.Getenv("PADI_STT_MODEL_PATH")
	if modelPath == "" {
		modelPath = filepath.Join(root, "services/voice/models", model)
	}
	log, err := os.Create(filepath.Join(t.TempDir(), "python-service.log"))
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	command := exec.CommandContext(ctx, python, "-B", filepath.Join(root, "services/voice/app.py"))
	command.Dir = filepath.Join(root, "services/voice")
	command.Env = []string{"PATH=" + os.Getenv("PATH"), "PYTHONUNBUFFERED=1", "PADI_STT_ENABLED=true", "PADI_PYTHON_VOICE_ENABLED=false", "PADI_VOICE_SERVICE_TOKEN=" + privateToken, fmt.Sprintf("PADI_PYTHON_VOICE_PORT=%d", pythonPort), "PADI_STT_MODEL=" + model, "PADI_STT_MODEL_PATH=" + modelPath, "PADI_STT_WORKERS=1", "PADI_STT_THREADS=2", "HF_HUB_OFFLINE=1"}
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	command.Stdout, command.Stderr = log, log
	if err := command.Start(); err != nil {
		t.Fatal("local Python process could not start")
	}
	processDone := make(chan struct{})
	var processError error
	go func() { processError = command.Wait(); close(processDone) }()
	defer func() {
		_ = command.Process.Signal(syscall.SIGTERM)
		select {
		case <-processDone:
		case <-time.After(5 * time.Second):
			_ = syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
			<-processDone
		}
	}()
	t.Setenv("PADI_STT_ENABLED", "true")
	t.Setenv("PADI_PYTHON_VOICE_URL", pythonURL)
	t.Setenv("PADI_VOICE_SERVICE_TOKEN", privateToken)
	t.Setenv("PADI_STT_TIMEOUT_SECONDS", "120")
	speech, err := voice.LoadEnvironment(nil)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(60 * time.Second)
	for !speech.Ready(ctx).Ready {
		if time.Now().After(deadline) {
			t.Fatal("installed local speech model did not become ready; inspect the Python test log")
		}
		select {
		case <-processDone:
			t.Fatalf("Python exited before readiness: %v", processError)
		case <-time.After(200 * time.Millisecond):
		}
	}
	server := httptest.NewServer(NewRouter(db, Dependencies{Auth: authentication, Speech: speech, AllowedOrigins: []string{frontendURL}, DevelopmentOTPBypass: true}))
	defer server.Close()
	// No chat or synthesis dependency is provided: the incoming feature must
	// function entirely independently of conversational AI and outgoing speech.
	sessionPath := filepath.Join(t.TempDir(), "synthetic-session.json")
	file, err := os.OpenFile(sessionPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.NewEncoder(file).Encode(registration.Session); err != nil {
		file.Close()
		t.Fatal(err)
	}
	file.Close()
	browser := exec.CommandContext(ctx, "node", filepath.Join(root, "frontend/tests/transcription-browser.cjs"), sessionPath)
	browser.Env = []string{"PATH=" + os.Getenv("PATH"), "PADI_TRANSCRIPTION_API_URL=" + server.URL, "PADI_TRANSCRIPTION_PYTHON_URL=" + pythonURL, fmt.Sprintf("PADI_TRANSCRIPTION_FRONTEND_PORT=%d", frontendPort), "PADI_TRANSCRIPTION_WEB_DIRECTORY=" + filepath.Join(t.TempDir(), "web"), "CI=1"}
	for _, name := range []string{"PADI_VOICE_BROWSER_EXECUTABLE", "PADI_TRANSCRIPTION_REPORT_PATH", "PADI_TRANSCRIPTION_REUSE_WEB"} {
		if value := os.Getenv(name); value != "" {
			browser.Env = append(browser.Env, name+"="+value)
		}
	}
	browser.Stdout, browser.Stderr = os.Stdout, os.Stderr
	if err := browser.Run(); err != nil {
		t.Fatalf("real incoming voice browser verification failed: %v", err)
	}
	verified, err := authentication.Authenticate(ctx, registration.Session.Token)
	if err != nil || verified.ID != registration.Session.User.ID {
		t.Fatal("synthetic account identity changed during recording")
	}
	t.Log("Verified browser compression, authenticated Go forwarding, local Python recognition and transcript display.")
}
