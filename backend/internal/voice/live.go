package voice

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

// OpenLive connects only to the private recognition service configured at startup.
func (s *Transcriber) OpenLive(ctx context.Context) (*websocket.Conn, error) {
	endpoint, err := url.Parse(strings.TrimSuffix(s.endpoint, "/transcribe") + "/listen")
	if err != nil {
		return nil, err
	}
	if endpoint.Scheme == "https" {
		endpoint.Scheme = "wss"
	} else {
		endpoint.Scheme = "ws"
	}
	dialer := websocket.Dialer{HandshakeTimeout: 5 * time.Second}
	conn, response, err := dialer.DialContext(ctx, endpoint.String(), http.Header{"Authorization": {"Bearer " + s.key}})
	if response != nil && response.Body != nil {
		response.Body.Close()
	}
	return conn, err
}
