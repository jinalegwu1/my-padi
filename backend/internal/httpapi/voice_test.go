package httpapi

import (
	"bytes"
	"context"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jinalegwu1/my-padi/backend/internal/ai"
	"github.com/jinalegwu1/my-padi/backend/internal/auth"
	"github.com/jinalegwu1/my-padi/backend/internal/voice"
)

type testSpeech struct {
	calls int
	err   error
}

func (s *testSpeech) Transcribe(context.Context, []byte) (string, error) {
	s.calls++
	return "Hello PADI", s.err
}

func audioRequest(t *testing.T, audio []byte, field string, duplicate bool) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for i := 0; i < 1+btoi(duplicate); i++ {
		part, err := writer.CreateFormFile(field, "malicious-path.exe")
		if err != nil {
			t.Fatal(err)
		}
		part.Write(audio)
	}
	writer.Close()
	request := httptest.NewRequest("POST", "/v1/voice/transcribe", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("Authorization", "Bearer test-token")
	return request
}
func btoi(b bool) int {
	if b {
		return 1
	}
	return 0
}

func TestVoiceUploadValidationAndAuthentication(t *testing.T) {
	for _, test := range []struct {
		name                             string
		data                             []byte
		field                            string
		duplicate, expired, missingToken bool
		status, calls                    int
	}{
		{"valid", []byte("RIFF0000WAVEdata"), "audio", false, false, false, 200, 1},
		{"expired", []byte("RIFF0000WAVEdata"), "audio", false, true, false, 401, 0},
		{"no token", []byte("RIFF0000WAVEdata"), "audio", false, false, true, 401, 0},
		{"fake", []byte("not a real WAV file"), "audio", false, false, false, 400, 0},
		{"duplicate", []byte("RIFF0000WAVEdata"), "audio", true, false, false, 400, 0},
		{"wrong field", []byte("RIFF0000WAVEdata"), "other", false, false, false, 400, 0},
		{"oversize", append([]byte("RIFF0000WAVE"), make([]byte, voice.MaxAudioBytes)...), "audio", false, false, false, 413, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			service := &testSpeech{}
			authAPI := testAuthAPI{user: auth.User{ID: "a"}}
			if test.expired {
				authAPI.err = auth.ErrUnauthenticated
			}
			router := NewRouter(nil, Dependencies{Auth: authAPI, Speech: service})
			request := audioRequest(t, test.data, test.field, test.duplicate)
			if test.missingToken {
				request.Header.Del("Authorization")
			}
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != test.status || service.calls != test.calls {
				t.Fatalf("status %d, calls %d", response.Code, service.calls)
			}
			if response.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("audio response allowed caching")
			}
		})
	}
}

func TestVoiceProviderErrorsAreSanitized(t *testing.T) {
	for _, test := range []struct {
		err    error
		status int
		code   string
	}{
		{voice.ErrNoSpeech, 422, "no_speech"},
		{voice.ErrBusy, 429, "voice_busy"},
		{context.DeadlineExceeded, 504, "provider_timeout"},
		{&ai.ProviderError{Status: 429}, 429, "provider_rate_limited"},
		{errors.New("private recording and credentials"), 502, "provider_unavailable"},
	} {
		router := NewRouter(nil, Dependencies{Auth: testAuthAPI{}, Speech: &testSpeech{err: test.err}})
		response := httptest.NewRecorder()
		router.ServeHTTP(response, audioRequest(t, []byte("RIFF0000WAVEdata"), "audio", false))
		if response.Code != test.status || !strings.Contains(response.Body.String(), test.code) || strings.Contains(response.Body.String(), "private recording") {
			t.Fatal("incorrect or unsafe speech error")
		}
	}
}

func TestVoiceConfigurationRequiresCompleteServices(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		deps := Dependencies{}
		if enabled {
			deps.Auth = testAuthAPI{}
			deps.Chat = &testChatGenerator{}
			deps.Speech = &testSpeech{}
		}
		response := httptest.NewRecorder()
		NewRouter(nil, deps).ServeHTTP(response, httptest.NewRequest("GET", "/v1/voice/config", nil))
		if response.Code != 200 || strings.Contains(response.Body.String(), `"enabled":true`) != enabled {
			t.Fatal("incorrect capability disclosure")
		}
	}
}
