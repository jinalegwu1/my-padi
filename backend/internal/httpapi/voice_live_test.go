package httpapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jinalegwu1/my-padi/backend/internal/ai"
	"github.com/jinalegwu1/my-padi/backend/internal/auth"
	"github.com/jinalegwu1/my-padi/backend/internal/config"
	"github.com/jinalegwu1/my-padi/backend/internal/database"
	"github.com/jinalegwu1/my-padi/backend/internal/voice"
)

// Explicit opt-in. Uses a public speech fixture, a synthetic account, and the
// normal authenticated transcription/chat handlers. No personal audio or SMS.
func TestVoiceLiveTranscriptionAndChat(t *testing.T) {
	if os.Getenv("PADI_VERIFY_VOICE_LIVE") != "1" {
		t.Skip("live voice verification disabled")
	}
	if os.Getenv("PADI_ENV") != "development" {
		t.Fatal("live voice test requires development")
	}
	audio, err := os.ReadFile(os.Getenv("PADI_VOICE_TEST_AUDIO_PATH"))
	if err != nil {
		t.Fatal("public WAV fixture is unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	db, err := database.Open(ctx, config.Load().DatabaseURL)
	if err != nil {
		t.Fatal("PostgreSQL is unavailable")
	}
	defer db.Close()
	store, err := database.NewAuthStore(ctx, db)
	if err != nil {
		t.Fatal("authentication store unavailable")
	}
	service, err := auth.NewDevelopmentService(store)
	if err != nil {
		t.Fatal(err)
	}
	seed := time.Now().UnixNano()
	phone := fmt.Sprintf("+1%010d", seed%10_000_000_000)
	registration, err := service.RequestRegistration(ctx, auth.Profile{FullName: "Voice Verification", DateOfBirth: "1990-01-01", PhoneNumber: phone}, fmt.Sprintf("voice-live-%d", seed))
	if err != nil || registration.Session == nil {
		t.Fatal("synthetic account registration failed")
	}
	session := registration.Session
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := db.ExecContext(cleanup, `DELETE FROM users WHERE id = $1`, session.User.ID); err != nil {
			t.Error("synthetic account cleanup failed")
		}
		if _, err := db.ExecContext(cleanup, `DELETE FROM auth_challenges WHERE phone_number = $1`, phone); err != nil {
			t.Error("synthetic challenge cleanup failed")
		}
	}()
	bypass, err := config.DevelopmentAIUsageBypass()
	if err != nil {
		t.Fatal(err)
	}
	var limiter *database.AIUsageLimiter
	if bypass {
		limiter, err = database.NewDevelopmentAIUsageLimiter(ctx, db)
	} else {
		limiter, err = database.NewAIUsageLimiter(ctx, db)
	}
	if err != nil {
		t.Fatal("usage ledger unavailable")
	}
	speech, err := voice.LoadEnvironment(limiter)
	if err != nil || speech == nil {
		t.Fatal("real transcription configuration unavailable")
	}
	synthesis, err := voice.LoadPythonSpeech(limiter)
	if err != nil || synthesis == nil {
		t.Fatal("real Python speech configuration unavailable")
	}
	configuration, err := ai.LoadEnvironment()
	if err != nil {
		t.Fatal("AI configuration unavailable")
	}
	generator, err := ai.NewRouterFromEnvironment(configuration, nil, limiter)
	if err != nil || generator == nil {
		t.Fatal("AI router unavailable")
	}
	memories, err := database.NewMemoryStore(ctx, db)
	if err != nil {
		t.Fatal("memory store unavailable")
	}
	router := NewRouter(db, Dependencies{Auth: service, Chat: generator, Speech: speech, Synthesis: synthesis, Memory: memories})
	transcribe := func(data []byte, status int) string {
		t.Helper()
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		part, err := writer.CreateFormFile("audio", "public-sample.wav")
		if err != nil {
			t.Fatal(err)
		}
		part.Write(data)
		writer.Close()
		request := httptest.NewRequest("POST", "/v1/voice/transcribe", &body).WithContext(ctx)
		request.Header.Set("Authorization", "Bearer "+session.Token)
		request.Header.Set("Content-Type", writer.FormDataContentType())
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != status {
			t.Fatalf("transcription HTTP %d, wanted %d; response omitted", response.Code, status)
		}
		if status != 200 {
			return ""
		}
		var result struct {
			Text string `json:"text"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal("invalid transcription JSON")
		}
		return result.Text
	}
	transcriptionStart := time.Now()
	text := transcribe(audio, 200)
	transcriptionDuration := time.Since(transcriptionStart)
	if !strings.Contains(strings.ToLower(text), "ask not what your country") {
		t.Fatal("recognised speech did not match public fixture")
	}
	// A silent one-second PCM WAV must not become a made-up user utterance.
	silence := make([]byte, 44+32000)
	copy(silence, "RIFF")
	binary.LittleEndian.PutUint32(silence[4:], uint32(len(silence)-8))
	copy(silence[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(silence[16:], 16)
	binary.LittleEndian.PutUint16(silence[20:], 1)
	binary.LittleEndian.PutUint16(silence[22:], 1)
	binary.LittleEndian.PutUint32(silence[24:], 16000)
	binary.LittleEndian.PutUint32(silence[28:], 32000)
	binary.LittleEndian.PutUint16(silence[32:], 2)
	binary.LittleEndian.PutUint16(silence[34:], 16)
	copy(silence[36:], "data")
	binary.LittleEndian.PutUint32(silence[40:], 32000)
	transcribe(silence, 422)
	requestBody, _ := json.Marshal(map[string]any{"messages": []ai.Message{{Role: ai.RoleUser, Content: "In one short sentence, summarise this recognised speech: " + text}}, "memory_revision": 0, "delivery": "voice"})
	request := httptest.NewRequest("POST", "/v1/chat", bytes.NewReader(requestBody)).WithContext(ctx)
	request.Header.Set("Authorization", "Bearer "+session.Token)
	response := httptest.NewRecorder()
	chatStart := time.Now()
	router.ServeHTTP(response, request)
	chatDuration := time.Since(chatStart)
	var reply struct {
		Reply string `json:"reply"`
	}
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &reply) != nil || strings.TrimSpace(reply.Reply) == "" {
		t.Fatal("recognised speech did not receive a real chat reply")
	}
	spokenBody, _ := json.Marshal(map[string]any{"text": reply.Reply, "style": "ada", "rate": 1, "live": true})
	spokenRequest := httptest.NewRequest("POST", "/v1/voice/speak", bytes.NewReader(spokenBody)).WithContext(ctx)
	spokenRequest.Header.Set("Authorization", "Bearer "+session.Token)
	spokenResponse := httptest.NewRecorder()
	speechStart := time.Now()
	router.ServeHTTP(spokenResponse, spokenRequest)
	speechDuration := time.Since(speechStart)
	var spoken struct {
		AudioBase64 string `json:"audio_base64"`
		MIME        string `json:"mime_type"`
	}
	if spokenResponse.Code != 200 || json.Unmarshal(spokenResponse.Body.Bytes(), &spoken) != nil || spoken.MIME != "audio/wav" {
		t.Fatalf("real spoken reply failed with HTTP %d; response omitted", spokenResponse.Code)
	}
	decoded, err := base64.StdEncoding.DecodeString(spoken.AudioBase64)
	if err != nil || len(decoded) < 46 || string(decoded[:4]) != "RIFF" || binary.LittleEndian.Uint32(decoded[24:28]) != 24000 {
		t.Fatal("spoken reply was not playable 24 kHz PCM audio")
	}
	var count, tokens int64
	if err := db.QueryRowContext(ctx, `SELECT request_count,input_tokens+output_tokens FROM ai_provider_usage_periods WHERE provider='groq-speech' AND period_type='day' AND period_start=CURRENT_DATE`).Scan(&count, &tokens); err != nil || count < 1 || tokens != 0 {
		t.Fatal("speech ledger missing or audio counted as text tokens")
	}
	t.Log("Public speech matched; silence rejected; authenticated AI reply and real PCM speech received; usage persisted.")
	t.Logf("Voice stages: transcription %.2fs, chat %.2fs, speech %.2fs; total %.2fs.", transcriptionDuration.Seconds(), chatDuration.Seconds(), speechDuration.Seconds(), (transcriptionDuration + chatDuration + speechDuration).Seconds())
}
