package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jinalegwu1/my-padi/backend/internal/ai"
	"github.com/jinalegwu1/my-padi/backend/internal/auth"
	"github.com/jinalegwu1/my-padi/backend/internal/memory"
	"github.com/jinalegwu1/my-padi/backend/internal/personality"
)

func TestTextAndVoiceRequestsSharePreferenceAndEmotionalGuidance(t *testing.T) {
	for _, delivery := range []string{"text", "voice"} {
		for _, test := range []struct {
			name, user, want string
			humour           personality.HumourPreference
		}{
			{"greeting", "Hi", "A small bit of wit is welcome", personality.HumourOccasional},
			{"returning grief greeting", "Greet me briefly. Recent user turn for greeting continuity: My father died yesterday. Please just listen.", "Conversation signal: empathetic.", personality.HumourFrequent},
			{"everyday", "I opened the fridge three times and dinner still hasn't appeared.", "A small bit of wit is welcome", personality.HumourOccasional},
			{"user joke", "My Wi-Fi and I live in the same room but have a long-distance relationship.", "A small bit of wit is welcome", personality.HumourOccasional},
			{"teasing", "PADI, did you swallow a dictionary?", "A small bit of wit is welcome", personality.HumourOccasional},
			{"subtle", "What should I cook today?", "keep it understated", personality.HumourSubtle},
			{"off", "What should I cook today?", "without jokes or teasing", personality.HumourOff},
			{"grief", "My father died. Tell me a joke.", "Conversation signal: empathetic.", personality.HumourFrequent},
			{"serious", "Give me a serious response about my interview.", "Conversation signal: serious.", personality.HumourFrequent},
		} {
			t.Run(delivery+"/"+test.name, func(t *testing.T) {
				generator := &testChatGenerator{}
				preferences := personality.DefaultPreferences()
				preferences.Humour, preferences.HumourExplicit = test.humour, true
				store := &testPersonalityPreferencesAPI{current: preferences}
				router := NewRouter(nil, Dependencies{Auth: testAuthAPI{user: auth.User{ID: "owner", FullName: "Ada"}}, Chat: generator, Personality: store})
				body, _ := json.Marshal(map[string]any{"delivery": delivery, "messages": []ai.Message{{Role: ai.RoleUser, Content: test.user}}})
				request := httptest.NewRequest(http.MethodPost, "/v1/chat", strings.NewReader(string(body)))
				request.Header.Set("Authorization", "Bearer valid")
				response := httptest.NewRecorder()
				router.ServeHTTP(response, request)
				if response.Code != http.StatusOK || store.userID != "owner" || !strings.Contains(generator.request.StyleGuidance, test.want) {
					t.Fatalf("status=%d owner=%q guidance=%q", response.Code, store.userID, generator.request.StyleGuidance)
				}
				if generator.request.Voice != (delivery == "voice") {
					t.Fatal("personality changed delivery routing")
				}
				if generator.request.SuppressHumour != !personality.Assess(test.user, preferences).HumourAllowed {
					t.Fatal("request lost the no-humour boundary")
				}
				if delivery == "voice" {
					found := false
					for _, message := range generator.request.Messages {
						if message.Role == ai.RoleSystem &&
							strings.Contains(message.Content, "selected conversation language is English with natural Nigerian English phrasing") {
							found = true
						}
					}
					if !found {
						t.Fatal("spoken response did not retain the selected-language instruction")
					}
				}
			})
		}
	}
}

func TestReturningGreetingAssessesOnlyContextWithinMemoryRevision(t *testing.T) {
	for _, revision := range []int{4, 5} {
		generator := &testChatGenerator{}
		preferences := personality.DefaultPreferences()
		preferences.Humour = personality.HumourFrequent
		router := NewRouter(nil, Dependencies{
			Auth: testAuthAPI{user: auth.User{ID: "owner"}}, Chat: generator,
			Personality: &testPersonalityPreferencesAPI{current: preferences},
			Memory:      &testMemoryAPI{snapshot: memory.Snapshot{Revision: 5}},
		})
		body, _ := json.Marshal(map[string]any{
			"greeting": true, "memory_revision": revision,
			"messages": []ai.Message{{Role: ai.RoleUser, Content: "My father died. Just listen."},
				{Role: ai.RoleAssistant, Content: "I'm here with you."}, {Role: ai.RoleUser, Content: "Greet me briefly."}},
		})
		request := httptest.NewRequest(http.MethodPost, "/v1/chat", strings.NewReader(string(body)))
		request.Header.Set("Authorization", "Bearer valid")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("greeting returned HTTP %d", response.Code)
		}
		if got := strings.Contains(generator.request.StyleGuidance, "without jokes or teasing"); got != (revision == 5) {
			t.Fatalf("revision %d: greeting assessed stale or missing context: %s", revision, generator.request.StyleGuidance)
		}
	}
}
