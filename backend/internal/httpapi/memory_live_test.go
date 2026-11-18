package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jinalegwu1/my-padi/backend/internal/ai"
	"github.com/jinalegwu1/my-padi/backend/internal/auth"
	"github.com/jinalegwu1/my-padi/backend/internal/config"
	"github.com/jinalegwu1/my-padi/backend/internal/database"
	"github.com/jinalegwu1/my-padi/backend/internal/memory"
)

// Explicit opt-in: synthetic account/fact only, normal authenticated handlers,
// the configured AI router, and PostgreSQL. No SMS is sent.
func TestPersonalMemoryLiveAI(t *testing.T) {
	if os.Getenv("PADI_VERIFY_MEMORY_LIVE_AI") != "1" {
		t.Skip("explicit live memory verification is disabled")
	}
	if os.Getenv("PADI_ENV") != "development" {
		t.Fatal("live memory verification requires development mode")
	}
	configuration, err := ai.LoadEnvironment()
	if err != nil || len(configuration.Models) == 0 {
		t.Fatal("live model configuration is unavailable")
	}
	confirmed := strings.Split(os.Getenv("PADI_AI_FREE_ACCOUNT_CONFIRMED"), ",")
	for _, model := range configuration.Models {
		allowed := false
		for _, provider := range confirmed {
			if strings.TrimSpace(provider) == model.Provider {
				allowed = true
			}
		}
		if !allowed {
			t.Fatal("confirm free account eligibility before live memory verification")
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Second)
	defer cancel()
	db, err := database.Open(ctx, config.Load().DatabaseURL)
	if err != nil {
		t.Fatal("PostgreSQL is unavailable")
	}
	defer db.Close()
	store, err := database.NewMemoryStore(ctx, db)
	if err != nil {
		t.Fatal("apply the personal-memory migration first")
	}
	authStore, err := database.NewAuthStore(ctx, db)
	if err != nil {
		t.Fatal("authentication store is unavailable")
	}
	service, err := auth.NewDevelopmentService(authStore)
	if err != nil {
		t.Fatal(err)
	}
	seed := time.Now().UnixNano()
	phone := fmt.Sprintf("+1%010d", seed%10_000_000_000)
	registration, err := service.RequestRegistration(ctx, auth.Profile{FullName: "Memory Verification", DateOfBirth: "1990-01-01", PhoneNumber: phone}, fmt.Sprintf("memory-live-%d", seed))
	if err != nil || registration.Session == nil {
		t.Fatal("could not create the synthetic development account without SMS")
	}
	session := registration.Session
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := db.ExecContext(cleanup, `DELETE FROM users WHERE id = $1`, session.User.ID); err != nil {
			t.Error("could not remove the synthetic account")
		}
		if _, err := db.ExecContext(cleanup, `DELETE FROM auth_challenges WHERE phone_number = $1`, phone); err != nil {
			t.Error("could not remove the synthetic auth challenge")
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
		t.Fatal("usage ledger is unavailable")
	}
	generator, err := ai.NewRouterFromEnvironment(configuration, nil, limiter)
	if err != nil || generator == nil {
		t.Fatal("AI router is unavailable")
	}
	router := NewRouter(db, Dependencies{Auth: service, Memory: store, Chat: generator})
	call := func(method, path string, body any, status int) []byte {
		t.Helper()
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest(method, path, strings.NewReader(string(encoded))).WithContext(ctx)
		request.Header.Set("Authorization", "Bearer "+session.Token)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != status {
			t.Fatalf("%s returned HTTP %d; response omitted for privacy", path, response.Code)
		}
		return response.Body.Bytes()
	}
	call("PATCH", "/v1/memory/settings", map[string]bool{"enabled": true}, 200)
	marker := "MarigoldLamp451"
	var saved memory.Snapshot
	if err := json.Unmarshal(call("POST", "/v1/memory", memory.Draft{Category: "plans", Label: "Project codename", Value: marker, Approved: true}, 201), &saved); err != nil || len(saved.Items) != 1 {
		t.Fatal("approved fact was not saved")
	}
	query := "What is my current project codename? Reply only with the codename if you know it; otherwise say unknown."
	var active struct {
		Reply    string `json:"reply"`
		Revision int64  `json:"memory_revision"`
	}
	if err := json.Unmarshal(call("POST", "/v1/chat", map[string]any{"memory_revision": saved.Revision, "messages": []ai.Message{{Role: ai.RoleUser, Content: query}}}, 200), &active); err != nil || !strings.Contains(active.Reply, marker) {
		t.Fatal("live AI did not recall the explicitly approved fact")
	}
	call("PATCH", "/v1/memory/"+saved.Items[0].ID, map[string]bool{"paused": true}, 200)
	var paused struct {
		Reply string `json:"reply"`
	}
	if err := json.Unmarshal(call("POST", "/v1/chat", map[string]any{"memory_revision": active.Revision, "messages": []ai.Message{{Role: ai.RoleAssistant, Content: active.Reply}, {Role: ai.RoleUser, Content: query}}}, 200), &paused); err != nil || strings.TrimSpace(paused.Reply) == "" || strings.Contains(paused.Reply, marker) {
		t.Fatal("paused fact or stale recalled reply leaked into the next live response")
	}
	t.Logf("Synthetic approved fact recalled: %s; after pause: %s", active.Reply, paused.Reply)
}
