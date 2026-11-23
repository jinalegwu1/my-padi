package httpapi

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"testing"

	"github.com/jinalegwu1/my-padi/backend/internal/auth"
	"github.com/jinalegwu1/my-padi/backend/internal/voice"
)

type testSpeech struct {
	calls int
	err   error
}

type testLanguageSpeech struct {
	testSpeech
	language string
}

func (s *testLanguageSpeech) TranscribeLanguage(_ context.Context, _ []byte, language string) (string, error) {
	s.calls++
	s.language = language
	return "Hello PADI", nil
}

func TestVoiceUploadPassesSelectedLanguageAndDefaultsToEnglish(t *testing.T) {
	for _, test := range []struct {
		query, language string
		status          int
	}{
		{"", "en-NG", 200},
		{"?language=en-GB", "en-GB", 200},
		{"?language=fr-FR", "fr-FR", 200},
		{"?language=unknown", "", 400},
		{"?language=en-NG&language=fr-FR", "", 400},
	} {
		speech := &testLanguageSpeech{}
		router := NewRouter(nil, Dependencies{Auth: testAuthAPI{}, Speech: speech})
		request := audioRequest(t, uploadWAV(), "audio", false)
		request.URL.RawQuery = strings.TrimPrefix(test.query, "?")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != test.status || speech.language != test.language {
			t.Fatal("Selected transcription language was dropped or invalid language accepted")
		}
	}
}

func (s *testSpeech) Transcribe(context.Context, []byte) (string, error) {
	s.calls++
	return "Hello PADI", s.err
}

func audioRequest(t *testing.T, audio []byte, field string, duplicate bool) *http.Request {
	return audioRequestType(t, audio, field, duplicate, "audio/wav")
}

func audioRequestType(t *testing.T, audio []byte, field string, duplicate bool, media string) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for i := 0; i < 1+btoi(duplicate); i++ {
		headers := make(textproto.MIMEHeader)
		headers.Set("Content-Disposition", `form-data; name="`+field+`"; filename="malicious-path.exe"`)
		headers.Set("Content-Type", media)
		part, err := writer.CreatePart(headers)
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

func uploadWAV() []byte {
	audio := make([]byte, 44+3200)
	copy(audio, "RIFF")
	binary.LittleEndian.PutUint32(audio[4:], uint32(len(audio)-8))
	copy(audio[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(audio[16:], 16)
	binary.LittleEndian.PutUint16(audio[20:], 1)
	binary.LittleEndian.PutUint16(audio[22:], 1)
	binary.LittleEndian.PutUint32(audio[24:], 16000)
	binary.LittleEndian.PutUint32(audio[28:], 32000)
	binary.LittleEndian.PutUint16(audio[32:], 2)
	binary.LittleEndian.PutUint16(audio[34:], 16)
	copy(audio[36:], "data")
	binary.LittleEndian.PutUint32(audio[40:], 3200)
	audio[44] = 1
	return audio
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
		{"valid", uploadWAV(), "audio", false, false, false, 200, 1},
		{"expired", uploadWAV(), "audio", false, true, false, 401, 0},
		{"no token", uploadWAV(), "audio", false, false, true, 401, 0},
		{"fake", []byte("not a real WAV file"), "audio", false, false, false, 400, 0},
		{"duplicate", uploadWAV(), "audio", true, false, false, 400, 0},
		{"wrong field", uploadWAV(), "other", false, false, false, 400, 0},
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
		{voice.ErrBusy, 429, "transcription_busy"},
		{context.DeadlineExceeded, 504, "transcription_timeout"},
		{&voice.SpeechFailure{Status: 503, Code: "model_not_installed"}, 503, "model_not_installed"},
		{errors.New("private recording and credentials"), 502, "transcription_failed"},
	} {
		router := NewRouter(nil, Dependencies{Auth: testAuthAPI{}, Speech: &testSpeech{err: test.err}})
		response := httptest.NewRecorder()
		router.ServeHTTP(response, audioRequest(t, uploadWAV(), "audio", false))
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
