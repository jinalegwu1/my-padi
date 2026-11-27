package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

type liveRecognizer interface {
	OpenLive(context.Context) (*websocket.Conn, error)
}

// Gorilla's wire limit applies before decompression. Bound the decoded message
// as well before passing credentials, commands or PCM to the existing service.
func readLiveFrame(conn *websocket.Conn, limit int64) (int, []byte, error) {
	kind, reader, err := conn.NextReader()
	if err != nil {
		return 0, nil, err
	}
	frame, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if int64(len(frame)) > limit {
		return 0, nil, errors.New("live frame exceeds decoded byte limit")
	}
	return kind, frame, err
}

// Browser WebSockets cannot carry an Authorization header. The first frame
// authenticates the session, keeping the bearer token out of URLs and logs.
func liveRecognitionHandler(deps Dependencies) http.HandlerFunc {
	slots := make(chan struct{}, 8)
	return func(w http.ResponseWriter, r *http.Request) {
		service, ok := deps.Speech.(liveRecognizer)
		if !ok || deps.Auth == nil {
			writeAPIError(w, 503, "live_unavailable", "Live recognition is unavailable.")
			return
		}
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			writeAPIError(w, 429, "transcription_busy", "Live recognition is busy.")
			return
		}
		// The router's CORS middleware already validates web origins. Native
		// clients authenticate with the same first frame.
		upgrader := websocket.Upgrader{EnableCompression: true, CheckOrigin: func(*http.Request) bool { return true }}
		client, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer client.Close()
		client.EnableWriteCompression(false)
		client.SetReadLimit(4096 + 128) // allow framing overhead on incompressible input
		client.SetReadDeadline(time.Now().Add(5 * time.Second))
		var hello struct{ Token, Language string }
		fail := func(message string) {
			client.SetWriteDeadline(time.Now().Add(time.Second))
			_ = client.WriteJSON(map[string]string{"type": "error", "message": message})
		}
		_, credentials, err := readLiveFrame(client, 4096)
		if err != nil || json.Unmarshal(credentials, &hello) != nil || hello.Token == "" {
			fail("Sign in to use live captions.")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		_, err = deps.Auth.Authenticate(ctx, hello.Token)
		cancel()
		if err != nil {
			fail("Sign in to use live captions.")
			return
		}
		switch hello.Language {
		case "en-NG", "pcm-NG", "en-GB":
		default:
			fail("Live recognition is unavailable for this language.")
			return
		}
		upstream, err := service.OpenLive(r.Context())
		if err != nil {
			fail("Live recognition could not start.")
			return
		}
		defer upstream.Close()
		upstream.SetReadLimit(16 * 1024)
		client.SetReadLimit(32000 + 128)
		client.SetReadDeadline(time.Time{})
		if client.WriteJSON(map[string]string{"type": "ready"}) != nil {
			return
		}
		// Allow a short window of microphone frames in flight. Acknowledgements
		// provide backpressure without adding a network round trip to every frame.
		pending := make(chan struct{}, 8)
		closed := make(chan struct{})
		defer close(closed)
		inputEnded := make(chan string, 1)
		go func() {
			for {
				kind, data, err := readLiveFrame(client, 32000)
				if err != nil {
					inputEnded <- ""
					return
				}
				if (kind == websocket.BinaryMessage && (len(data) == 0 || len(data)%2 != 0)) ||
					(kind == websocket.TextMessage && len(data) > 128) {
					inputEnded <- "Invalid live recognition frame."
					return
				}
				select {
				case pending <- struct{}{}:
				case <-closed:
					return
				}
				upstream.SetWriteDeadline(time.Now().Add(5 * time.Second))
				if err = upstream.WriteMessage(kind, data); err != nil {
					inputEnded <- "Live recognition was interrupted."
					return
				}
			}
		}()
		for {
			select {
			case message := <-inputEnded:
				if message != "" {
					fail(message)
				}
				return
			case <-pending:
			}
			upstream.SetReadDeadline(time.Now().Add(8 * time.Second))
			_, data, err := upstream.ReadMessage()
			var event struct{ Type string }
			if err != nil || json.Unmarshal(data, &event) != nil {
				fail("Live recognition was interrupted.")
				return
			}
			if event.Type != "ack" {
				client.SetWriteDeadline(time.Now().Add(5 * time.Second))
				if client.WriteMessage(websocket.TextMessage, data) != nil {
					return
				}
			}
		}
	}
}
