package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/jinalegwu1/my-padi/backend/internal/auth"
	"github.com/jinalegwu1/my-padi/backend/internal/voice"
)

type countingVoiceConn struct {
	net.Conn
	written int
}

func (conn *countingVoiceConn) Write(p []byte) (int, error) {
	n, err := conn.Conn.Write(p)
	conn.written += n
	return n, err
}

func TestLivePCMCompression(t *testing.T) {
	file, err := os.ReadFile("../../../frontend/tests/fixtures/hi-soft-onset.wav")
	if err != nil {
		t.Fatal(err)
	}
	const frameSize = 1600 // 50 ms, 16 kHz mono
	// The capture fixture retains the one-second window starting at 850 ms.
	start := 44 + 850*32
	pcm := file[start : start+32000]
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upgrader := websocket.Upgrader{EnableCompression: true}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		conn.SetReadLimit(frameSize + 128)
		var received []byte
		for len(received) < len(pcm) {
			kind, data, err := readLiveFrame(conn, frameSize)
			if err != nil || kind != websocket.BinaryMessage {
				return
			}
			received = append(received, data...)
		}
		_, _, oversized := readLiveFrame(conn, frameSize)
		_ = conn.WriteJSON(bytes.Equal(received, pcm) && oversized != nil)
	}))
	defer server.Close()
	for _, compress := range []bool{false, true} {
		var counted *countingVoiceConn
		dialer := websocket.Dialer{EnableCompression: compress, NetDialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			raw, err := (&net.Dialer{}).DialContext(ctx, network, addr)
			if err != nil {
				return nil, err
			}
			counted = &countingVoiceConn{Conn: raw}
			return counted, nil
		}}
		conn, _, err := dialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
		if err != nil {
			t.Fatal(err)
		}
		defer conn.Close()
		before := counted.written
		for i := 0; i < len(pcm); i += frameSize {
			if err := conn.WriteMessage(websocket.BinaryMessage, pcm[i:i+frameSize]); err != nil {
				t.Fatal(err)
			}
		}
		wire := counted.written - before
		if compress && wire >= len(pcm) {
			t.Fatalf("compressed microphone frames took %d bytes", wire)
		}
		if err := conn.WriteMessage(websocket.BinaryMessage, make([]byte, frameSize+2)); err != nil {
			t.Fatal(err)
		}
		var verified bool
		if err := conn.ReadJSON(&verified); err != nil || !verified {
			t.Fatalf("PCM round trip or decoded-size boundary failed: %v", err)
		}
		t.Logf("deflate=%t PCM=%d wire=%d", compress, len(pcm), wire)
	}
}

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
