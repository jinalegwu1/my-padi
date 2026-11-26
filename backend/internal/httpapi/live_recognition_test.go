package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jinalegwu1/my-padi/backend/internal/auth"
	"github.com/jinalegwu1/my-padi/backend/internal/voice"
)

// Optional microphone-to-speaker regression through the actual exported app,
// Go gateway and both local engines. Only the account and reply text are fixtures.
func TestLocalVoiceConversationBrowser(t *testing.T) {
	web := os.Getenv("PADI_LIVE_WEB_EXPORT")
	if web == "" {
		t.Skip("set PADI_LIVE_WEB_EXPORT to the web build configured for http://127.0.0.1:19221")
	}
	root, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	port := strconv.Itoa(unusedLoopbackPort(t))
	privateToken, err := voice.NewRequestID()
	if err != nil {
		t.Fatal(err)
	}
	python := exec.CommandContext(ctx, filepath.Join(root, "services/voice/.venv/bin/python"), "app.py")
	python.Dir = filepath.Join(root, "services/voice")
	python.Env = []string{"PATH=" + os.Getenv("PATH"), "PADI_STT_ENABLED=true", "PADI_PYTHON_VOICE_ENABLED=true",
		"PADI_PYTHON_VOICE_ENGINE=local", "PADI_VOICE_SERVICE_TOKEN=" + privateToken, "PADI_PYTHON_VOICE_PORT=" + port}
	python.Stdout, python.Stderr = os.Stdout, os.Stderr
	if err := python.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { cancel(); _ = python.Wait() }()
	t.Setenv("PADI_PYTHON_VOICE_URL", "http://127.0.0.1:"+port)
	t.Setenv("PADI_PYTHON_VOICE_ENABLED", "true")
	t.Setenv("PADI_PYTHON_VOICE_ENGINE", "local")
	t.Setenv("PADI_STT_ENABLED", "true")
	t.Setenv("PADI_VOICE_SERVICE_TOKEN", privateToken)
	speech, err := voice.LoadEnvironment(nil)
	if err != nil {
		t.Fatal(err)
	}
	out, err := voice.LoadPythonSpeech(livePersonalityUsageLimiter{})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(90 * time.Second)
	for len(speech.Ready(ctx).LiveLanguages) == 0 {
		if time.Now().After(deadline) {
			t.Fatal("live recognition did not become ready")
		}
		time.Sleep(200 * time.Millisecond)
	}
	addr := "127.0.0.1:19221"
	origin := "http://" + addr
	user := auth.User{ID: "voice-fixture", FullName: "Voice Reviewer"}
	router := NewRouter(nil, Dependencies{Auth: testAuthAPI{user: user}, Chat: &testStreamingChat{}, Speech: speech, Synthesis: out, AllowedOrigins: []string{origin}})
	mux := http.NewServeMux()
	mux.Handle("/v1/", router)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(filepath.Base(r.URL.Path), ".") {
			http.FileServer(http.Dir(web)).ServeHTTP(w, r)
		} else {
			http.ServeFile(w, r, filepath.Join(web, "index.html"))
		}
	})
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go server.Serve(listener)
	defer server.Close()
	session := filepath.Join(t.TempDir(), "session.json")
	body, _ := json.Marshal(map[string]any{"token": "voice-fixture", "user": user, "expires_at": time.Now().Add(time.Hour)})
	if err := os.WriteFile(session, body, 0600); err != nil {
		t.Fatal(err)
	}
	command := exec.CommandContext(ctx, "node", filepath.Join(root, "frontend/tests/voice-browser.cjs"), session)
	command.Env = []string{"PATH=" + os.Getenv("PATH"), "PADI_VERIFY_LIVE_CAPTIONS=1", "PADI_VOICE_API_URL=" + origin, "PADI_VOICE_FRONTEND_URL=" + origin,
		"PADI_VOICE_TEST_AUDIO_PATH=" + filepath.Join(root, "frontend/tests/fixtures/nigerian-english-short.wav")}
	if chrome := os.Getenv("PADI_VOICE_BROWSER_EXECUTABLE"); chrome != "" {
		command.Env = append(command.Env, fmt.Sprintf("PADI_VOICE_BROWSER_EXECUTABLE=%s", chrome))
	}
	command.Stdout, command.Stderr = os.Stdout, os.Stderr
	if err := command.Run(); err != nil {
		t.Fatal(err)
	}
}
