package voice

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jinalegwu1/my-padi/backend/internal/ai"
)

type testLimiter struct {
	calls int
	err   error
}

func (l *testLimiter) Reserve(context.Context, string, int, ai.UsageLimits, time.Time) error {
	l.calls++
	return l.err
}
func (*testLimiter) RecordUsage(context.Context, string, ai.Usage, time.Time) error { return nil }

func testWAV(samples int) []byte {
	data := make([]byte, 44+samples*2)
	copy(data, "RIFF")
	binary.LittleEndian.PutUint32(data[4:], uint32(len(data)-8))
	copy(data[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(data[16:], 16)
	binary.LittleEndian.PutUint16(data[20:], 1)
	binary.LittleEndian.PutUint16(data[22:], 1)
	binary.LittleEndian.PutUint32(data[24:], 16000)
	binary.LittleEndian.PutUint32(data[28:], 32000)
	binary.LittleEndian.PutUint16(data[32:], 2)
	binary.LittleEndian.PutUint16(data[34:], 16)
	copy(data[36:], "data")
	binary.LittleEndian.PutUint32(data[40:], uint32(samples*2))
	if samples > 0 {
		data[44] = 1
	}
	return data
}

func testInput() Input {
	return Input{Audio: append([]byte{0x1a, 0x45, 0xdf, 0xa3}, []byte("public test compressed fixture")...), MIME: "audio/webm;codecs=opus", UserID: "account-a", RequestID: strings.Repeat("a", 32), Language: "auto"}
}
func testTranscript(input Input) Transcript {
	return Transcript{Text: " Hello PADI 😊 ", UserID: input.UserID, RequestID: input.RequestID, Language: "en", LanguageProbability: .95, LanguageDetected: true, Model: "base", Duration: .1, AudioBytes: len(input.Audio), PCMBytes: 3200, Codec: "opus", Container: "webm", SampleRate: 16000, Channels: 1, DecodeMS: 1, PrepareMS: 1, TranscriptionMS: 1, ProcessingMS: 3, ServiceMS: 4}
}
func testService(server *httptest.Server) *Transcriber {
	return &Transcriber{key: strings.Repeat("x", 32), endpoint: server.URL + "/transcribe", client: server.Client(), active: make(chan struct{}, 1)}
}

func TestSpeechEnvironmentOptIn(t *testing.T) {
	t.Setenv("PADI_STT_ENABLED", "")
	if service, err := LoadEnvironment(nil); service != nil || err != nil {
		t.Fatal("local speech must default off")
	}
	t.Setenv("PADI_STT_ENABLED", "true")
	t.Setenv("PADI_VOICE_SERVICE_TOKEN", "")
	t.Setenv("PADI_PYTHON_VOICE_URL", "http://127.0.0.1:8090")
	t.Setenv("PADI_STT_TIMEOUT_SECONDS", "120")
	if _, err := LoadEnvironment(nil); err == nil {
		t.Fatal("private service credentials are mandatory")
	}
	t.Setenv("PADI_VOICE_SERVICE_TOKEN", strings.Repeat("x", 32))
	t.Setenv("GROQ_API_KEY", "")
	t.Setenv("GEMINI_API_KEY", "")
	limiter := &testLimiter{err: ai.ErrUsageLimitReached}
	if service, err := LoadEnvironment(limiter); service == nil || err != nil {
		t.Fatalf("local speech must work without external APIs: %v", err)
	}
	if limiter.calls != 0 {
		t.Fatal("local recognition charged an external provider")
	}
	for _, endpoint := range []string{"http://public.example", "https://user:secret@example.com", "https://example.com/path", "https:"} {
		t.Setenv("PADI_PYTHON_VOICE_URL", endpoint)
		if _, err := LoadEnvironment(nil); err == nil {
			t.Fatalf("unsafe private endpoint accepted: %s", endpoint)
		}
	}
}

func TestContainerAndContentTypeValidation(t *testing.T) {
	for _, item := range []struct {
		audio      []byte
		mime, name string
	}{{testWAV(1600), "audio/wav", "recording.wav"}, {[]byte("0000ftypM4A "), "audio/mp4", "recording.m4a"}, {testInput().Audio, "audio/webm;codecs=opus", "recording.webm"}} {
		if name, err := AudioFilename(item.audio); err != nil || name != item.name {
			t.Fatal("container signature was not recognised")
		}
		if _, err := ValidateContentType(item.audio, item.mime); err != nil {
			t.Fatal(err)
		}
	}
	for _, mime := range []string{"application/octet-stream", "audio/wav", "audio/webm;codecs=vorbis", "video/webm", "not a MIME type"} {
		if _, err := ValidateContentType(testInput().Audio, mime); err == nil {
			t.Fatalf("mismatched/unsupported type accepted: %s", mime)
		}
	}
	for _, data := range [][]byte{nil, []byte("fake audio"), make([]byte, MaxAudioBytes+1), testWAV(1600)[:43]} {
		if _, err := ValidateContentType(data, "audio/wav"); err == nil {
			t.Fatal("malformed audio accepted")
		}
	}
	extra := append(append(append([]byte{}, testWAV(1600)[:36]...), []byte("JUNK\x04\x00\x00\x00test")...), testWAV(1600)[36:]...)
	binary.LittleEndian.PutUint32(extra[4:], uint32(len(extra)-8))
	if _, err := ValidateContentType(extra, "audio/wav"); err != nil {
		t.Fatal("legal WAV metadata rejected", err)
	}
	if _, err := ValidateContentType(testWAV(61*16000), "audio/wav"); err == nil {
		t.Fatal("duration limit ignored")
	}
	malformed := testWAV(1600)
	binary.LittleEndian.PutUint32(malformed[40:], 3201)
	if _, err := ValidateContentType(malformed, "audio/wav"); err == nil {
		t.Fatal("truncated WAV accepted")
	}
}

func TestLocalTranscriptionForwardsCompressedBytesAndIdentity(t *testing.T) {
	input := testInput()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/transcribe" || r.Method != "POST" || r.Header.Get("Authorization") != "Bearer "+strings.Repeat("x", 32) {
			t.Error("private speech contract changed")
		}
		if err := r.ParseMultipartForm(MaxAudioBytes); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		defer r.MultipartForm.RemoveAll()
		if r.FormValue("request_id") != input.RequestID || r.FormValue("user_id") != input.UserID || r.FormValue("language") != "auto" || r.FormValue("model") != "" {
			t.Error("wrong owner, request or language; recognition belongs in Python")
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			t.Error(err)
			return
		}
		defer file.Close()
		raw, _ := io.ReadAll(file)
		if !bytes.Equal(raw, input.Audio) || header.Filename != "recording.webm" || !strings.Contains(header.Header.Get("Content-Type"), "opus") {
			t.Error("compressed upload was changed")
		}
		json.NewEncoder(w).Encode(testTranscript(input))
	}))
	defer server.Close()
	result, err := testService(server).TranscribeAudio(context.Background(), input)
	if err != nil || result.Text != "Hello PADI 😊" || result.UserID != input.UserID {
		t.Fatal(result, err)
	}
}

func TestLocalTranscriptionFailuresAreSafe(t *testing.T) {
	for _, item := range []struct {
		name   string
		status int
		code   string
		mutate func(*Transcript)
	}{
		{"busy", 429, "transcription_busy", nil}, {"model absent", 503, "model_not_installed", nil}, {"decode", 400, "invalid_audio", nil}, {"timeout", 504, "transcription_timeout", nil},
		{"unknown details", 500, "private key and recording", nil}, {"wrong service credential", 401, "unauthenticated", nil},
		{"other account", 200, "", func(r *Transcript) { r.UserID = "account-b"; r.Text = "Another account's private words" }},
		{"other request", 200, "", func(r *Transcript) { r.RequestID = strings.Repeat("b", 32) }},
		{"wrong byte count", 200, "", func(r *Transcript) { r.AudioBytes++ }}, {"wrong sample rate", 200, "", func(r *Transcript) { r.SampleRate = 48000 }},
		{"wrong duration", 200, "", func(r *Transcript) { r.Duration = 70 }}, {"empty transcript", 200, "", func(r *Transcript) { r.Text = " " }},
	} {
		t.Run(item.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(item.status)
				if item.status != 200 {
					json.NewEncoder(w).Encode(map[string]string{"error": item.code})
					return
				}
				value := testTranscript(testInput())
				item.mutate(&value)
				json.NewEncoder(w).Encode(value)
			}))
			defer server.Close()
			result, err := testService(server).TranscribeAudio(context.Background(), testInput())
			if err == nil || result.Text != "" || strings.Contains(err.Error(), "private") {
				t.Fatal("unsafe transcription failure", result, err)
			}
			if item.name == "empty transcript" && !errors.Is(err, ErrNoSpeech) {
				t.Fatal("empty transcript was accepted")
			}
			if item.status != 200 {
				var failure *SpeechFailure
				if !errors.As(err, &failure) {
					t.Fatal(err)
				}
				want := item.status
				if item.name == "unknown details" {
					want = 502
				}
				if item.status == 401 {
					want = 503
				}
				if failure.Status != want {
					t.Fatal("wrong safe status", failure)
				}
			}
		})
	}
}

func TestLocalTranscriptionCancellationReachesPythonAndReleasesSlot(t *testing.T) {
	started := make(chan struct{})
	cancelled := make(chan Input, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/cancel" {
			var identity struct {
				RequestID string `json:"request_id"`
				UserID    string `json:"user_id"`
			}
			json.NewDecoder(r.Body).Decode(&identity)
			cancelled <- Input{RequestID: identity.RequestID, UserID: identity.UserID}
			w.WriteHeader(202)
			return
		}
		io.Copy(io.Discard, r.Body)
		close(started)
		select {
		case <-r.Context().Done():
		case <-time.After(3 * time.Second):
		}
	}))
	defer server.Close()
	service := testService(server)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { _, err := service.TranscribeAudio(ctx, testInput()); done <- err }()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("Python request did not start")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("cancelled upload remained blocked")
	}
	select {
	case identity := <-cancelled:
		if identity.RequestID != testInput().RequestID || identity.UserID != testInput().UserID {
			t.Fatal("wrong cancellation owner")
		}
	case <-time.After(time.Second):
		t.Fatal("Python cancellation was not sent")
	}
	if len(service.active) != 0 {
		t.Fatal("concurrency slot leaked")
	}
}

func TestLocalCapacityAndCancelledRequestsDoNotStartInference(t *testing.T) {
	service := &Transcriber{active: make(chan struct{}, 1)}
	service.active <- struct{}{}
	if _, err := service.TranscribeAudio(context.Background(), testInput()); !errors.Is(err, ErrBusy) {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := service.TranscribeAudio(ctx, testInput()); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}

func TestSelectedLanguageIsForwardedWithoutTranslation(t *testing.T) {
	var selected string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.ParseMultipartForm(MaxAudioBytes)
		defer r.MultipartForm.RemoveAll()
		selected = r.FormValue("language")
		result := testTranscript(testInput())
		result.RequestID = r.FormValue("request_id")
		result.UserID = r.FormValue("user_id")
		result.LanguageDetected = selected == "auto"
		json.NewEncoder(w).Encode(result)
	}))
	defer server.Close()
	service := testService(server)
	for _, item := range []struct{ locale, language string }{{"auto", "auto"}, {"en-NG", "en"}, {"en-GB", "en"}, {"fr-FR", "fr"}, {"pcm-NG", "pcm"}} {
		input := testInput()
		input.Language = item.locale
		if _, err := service.TranscribeAudio(context.Background(), input); err != nil || selected != item.language {
			t.Fatal("selected recognition language was dropped", err)
		}
	}
}

func TestModelReadinessIsDistinctFromServiceAvailability(t *testing.T) {
	for _, item := range []struct {
		status int
		body   string
		want   string
	}{{503, `{"ready":false,"model":"base","error":"model_not_installed"}`, "model_not_installed"}, {500, `{"ready":false,"error":"private credentials"}`, "service_unavailable"}} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/ready" {
				t.Error("wrong readiness endpoint")
			}
			w.WriteHeader(item.status)
			io.WriteString(w, item.body)
		}))
		state := testService(server).Ready(context.Background())
		server.Close()
		if state.Ready || state.Error != item.want {
			t.Fatal(state)
		}
	}
}
