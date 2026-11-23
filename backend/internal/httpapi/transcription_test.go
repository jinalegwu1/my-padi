package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jinalegwu1/my-padi/backend/internal/auth"
	"github.com/jinalegwu1/my-padi/backend/internal/voice"
)

type accountSpeech struct {
	testSpeech
	mu     sync.Mutex
	inputs []voice.Input
	action func(context.Context, voice.Input) (voice.Transcript, error)
}

func (s *accountSpeech) TranscribeAudio(ctx context.Context, input voice.Input) (voice.Transcript, error) {
	s.mu.Lock()
	s.inputs = append(s.inputs, input)
	s.mu.Unlock()
	if s.action != nil {
		return s.action(ctx, input)
	}
	return voice.Transcript{Text: "Words for " + input.UserID, UserID: input.UserID, RequestID: input.RequestID, Language: "en", Model: "base", AudioBytes: len(input.Audio), Duration: .1, PCMBytes: 3200, SampleRate: 16000, Channels: 1, Codec: "opus", Container: "webm"}, nil
}

type accountAuth struct{ testAuthAPI }

func (accountAuth) Authenticate(_ context.Context, token string) (auth.User, error) {
	if token == "account-a" || token == "account-b" {
		return auth.User{ID: token}, nil
	}
	return auth.User{}, auth.ErrUnauthenticated
}

func TestCompressedUploadUsesAuthenticatedOwnerAndUniqueRequest(t *testing.T) {
	service := &accountSpeech{}
	router := NewRouter(nil, Dependencies{Auth: accountAuth{}, Speech: service})
	audio := append([]byte{0x1a, 0x45, 0xdf, 0xa3}, []byte("public test Opus container bytes")...)
	ids := map[string]bool{}
	for _, owner := range []string{"account-a", "account-b"} {
		request := audioRequestType(t, audio, "audio", false, "audio/webm;codecs=opus")
		request.Header.Set("Authorization", "Bearer "+owner)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		var result voice.Transcript
		if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &result) != nil || result.UserID != owner || result.Text != "Words for "+owner || len(result.RequestID) != 32 || ids[result.RequestID] {
			t.Fatal("account/request isolation failed", response.Code)
		}
		ids[result.RequestID] = true
	}
	if len(service.inputs) != 2 || !bytes.Equal(service.inputs[0].Audio, audio) || service.inputs[0].MIME != "audio/webm; codecs=opus" {
		t.Fatal("compressed audio changed in Go")
	}
}

func TestUploadRejectsTypesMalformedMultipartAndOversizedAudio(t *testing.T) {
	for _, item := range []struct {
		name, media string
		data        []byte
		status      int
	}{{"uncompressed lie", "audio/webm;codecs=opus", uploadWAV(), 415}, {"unsupported codec", "audio/webm;codecs=vorbis", append([]byte{0x1a, 0x45, 0xdf, 0xa3}, make([]byte, 20)...), 415}, {"invalid part type", "text/plain", uploadWAV(), 415}, {"empty", "audio/wav", nil, 400}, {"oversized", "audio/webm;codecs=opus", make([]byte, voice.MaxAudioBytes+1), 413}} {
		t.Run(item.name, func(t *testing.T) {
			speech := &accountSpeech{}
			response := httptest.NewRecorder()
			NewRouter(nil, Dependencies{Auth: accountAuth{}, Speech: speech}).ServeHTTP(response, withAccount(audioRequestType(t, item.data, "audio", false, item.media)))
			if response.Code != item.status || len(speech.inputs) != 0 {
				t.Fatalf("got %d; accepted unsupported upload", response.Code)
			}
		})
	}
	for _, media := range []string{"audio/webm", "multipart/form-data; boundary=missing"} {
		request := httptest.NewRequest("POST", "/v1/voice/transcribe", strings.NewReader("malformed multipart"))
		request.Header.Set("Content-Type", media)
		withAccount(request)
		response := httptest.NewRecorder()
		NewRouter(nil, Dependencies{Auth: accountAuth{}, Speech: &accountSpeech{}}).ServeHTTP(response, request)
		if response.Code != 400 && response.Code != 415 {
			t.Fatal("malformed request accepted")
		}
	}
}
func withAccount(request *http.Request) *http.Request {
	request.Header.Set("Authorization", "Bearer account-a")
	return request
}

func TestAnotherAccountsTranscriptCannotBeReturned(t *testing.T) {
	speech := &accountSpeech{action: func(_ context.Context, input voice.Input) (voice.Transcript, error) {
		return voice.Transcript{Text: "Private account B words", UserID: "account-b", RequestID: input.RequestID}, nil
	}}
	response := httptest.NewRecorder()
	NewRouter(nil, Dependencies{Auth: accountAuth{}, Speech: speech}).ServeHTTP(response, withAccount(audioRequest(t, uploadWAV(), "audio", false)))
	if response.Code != 502 || strings.Contains(response.Body.String(), "Private account B words") {
		t.Fatal("cross-account transcript was disclosed")
	}
}

func TestCancelledUploadCancelsCoordinatorWork(t *testing.T) {
	started, cancelled := make(chan struct{}), make(chan struct{})
	speech := &accountSpeech{action: func(ctx context.Context, _ voice.Input) (voice.Transcript, error) {
		close(started)
		<-ctx.Done()
		close(cancelled)
		return voice.Transcript{}, ctx.Err()
	}}
	server := httptest.NewServer(NewRouter(nil, Dependencies{Auth: accountAuth{}, Speech: speech}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	template := withAccount(audioRequest(t, uploadWAV(), "audio", false))
	request, err := http.NewRequestWithContext(ctx, "POST", server.URL+"/v1/voice/transcribe", template.Body)
	if err != nil {
		t.Fatal(err)
	}
	request.Header = template.Header
	done := make(chan error, 1)
	go func() {
		response, err := server.Client().Do(request)
		if response != nil {
			io.Copy(io.Discard, response.Body)
			response.Body.Close()
		}
		done <- err
	}()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("coordinator work did not start")
	}
	cancel()
	select {
	case <-cancelled:
	case <-time.After(2 * time.Second):
		t.Fatal("request cancellation was dropped")
	}
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}
