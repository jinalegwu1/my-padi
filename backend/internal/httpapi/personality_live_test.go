package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jinalegwu1/my-padi/backend/internal/ai"
	"github.com/jinalegwu1/my-padi/backend/internal/auth"
	"github.com/jinalegwu1/my-padi/backend/internal/personality"
)

type livePersonalityUsageLimiter struct{}

func (livePersonalityUsageLimiter) Reserve(context.Context, string, int, ai.UsageLimits, time.Time) error {
	return nil
}

func (livePersonalityUsageLimiter) RecordUsage(context.Context, string, ai.Usage, time.Time) error {
	return nil
}

type personalityLiveEvent struct {
	ModelID    string   `json:"model_id"`
	Model      string   `json:"model"`
	Provider   string   `json:"provider"`
	Success    bool     `json:"success"`
	ErrorClass string   `json:"error_class,omitempty"`
	Usage      ai.Usage `json:"usage"`
}

type personalityLiveResult struct {
	ID       string                 `json:"id"`
	User     string                 `json:"user"`
	Reply    string                 `json:"reply,omitempty"`
	Error    string                 `json:"error,omitempty"`
	Delivery string                 `json:"delivery"`
	Humour   string                 `json:"humour"`
	Events   []personalityLiveEvent `json:"provider_attempts"`
}

func TestLivePersonalityConversations(t *testing.T) {
	if os.Getenv("PADI_RUN_LIVE_PERSONALITY_TESTS") != "true" {
		t.Skip("set PADI_RUN_LIVE_PERSONALITY_TESTS=true to run real-provider conversation checks")
	}

	configuration, err := ai.LoadEnvironment()
	if err != nil {
		t.Fatalf("load configured AI models: %v", err)
	}
	var primary ai.ModelConfig
	modelNames := make(map[string]string, len(configuration.Models))
	for _, model := range configuration.Models {
		modelNames[model.ID] = model.Model
		if model.ID == configuration.Routing.PrimaryModel {
			primary = model
		}
	}
	if primary.Provider != ai.ProviderGroq || primary.Model != "openai/gpt-oss-20b" {
		t.Fatalf("live personality test requires configured Groq primary openai/gpt-oss-20b; got %s:%s", primary.Provider, primary.Model)
	}

	var events []ai.Event
	generator, err := ai.NewRouterWithUsageLimiter(
		configuration.Models,
		ai.NewProviderAdapters(nil),
		configuration.Routing,
		ai.ObserverFunc(func(event ai.Event) { events = append(events, event) }),
		livePersonalityUsageLimiter{},
	)
	if err != nil {
		t.Fatalf("create configured live AI router: %v", err)
	}

	preferences := &testPersonalityPreferencesAPI{current: personality.DefaultPreferences()}
	handler := NewRouter(nil, Dependencies{
		Auth:        testAuthAPI{user: auth.User{ID: "personality-live-test"}},
		Chat:        generator,
		Personality: preferences,
	})
	type turn struct {
		role    ai.MessageRole
		content string
	}
	var results []personalityLiveResult
	var lastRequest time.Time
	writeEvidence := func() {
		t.Helper()
		if path := os.Getenv("PADI_PERSONALITY_EVIDENCE_FILE"); path != "" {
			encoded, err := json.MarshalIndent(results, "", "  ")
			if err != nil {
				t.Fatalf("encode live evidence: %v", err)
			}
			if err := os.WriteFile(path, encoded, 0o600); err != nil {
				t.Fatalf("write live evidence: %v", err)
			}
		}
	}
	run := func(id, user, humour, delivery string, history []turn) string {
		t.Helper()
		if !lastRequest.IsZero() {
			if wait := time.Until(lastRequest.Add(12 * time.Second)); wait > 0 {
				time.Sleep(wait)
			}
		}
		lastRequest = time.Now()
		if humour == "" {
			humour = "occasional"
		}
		preferences.current = personality.Preferences{
			Humour:         personality.HumourPreference(humour),
			HumourExplicit: true,
			Tone:           personality.ToneAdaptive,
		}
		messages := make([]ai.Message, 0, len(history)+1)
		for _, item := range history {
			messages = append(messages, ai.Message{Role: item.role, Content: item.content})
		}
		messages = append(messages, ai.Message{Role: ai.RoleUser, Content: user})
		requestBody := struct {
			Delivery string       `json:"delivery"`
			Stream   bool         `json:"stream,omitempty"`
			Greeting bool         `json:"greeting,omitempty"`
			Language string       `json:"language,omitempty"`
			Messages []ai.Message `json:"messages"`
		}{Delivery: delivery, Messages: messages, Greeting: id == "first-greeting"}
		if delivery == "voice" || id == "first-greeting" {
			requestBody.Language = "en-NG"
		}
		if delivery == "voice" {
			requestBody.Stream = true
		}
		encoded, err := json.Marshal(requestBody)
		if err != nil {
			t.Fatalf("%s: encode request: %v", id, err)
		}
		before := len(events)
		request := httptest.NewRequest(http.MethodPost, "/v1/chat", strings.NewReader(string(encoded)))
		request.Header.Set("Authorization", "Bearer personality-live-test")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		result := personalityLiveResult{ID: id, User: user, Delivery: delivery, Humour: humour,
			Events: make([]personalityLiveEvent, 0)}
		for _, event := range events[before:] {
			result.Events = append(result.Events, personalityLiveEvent{
				ModelID: event.ModelID, Model: modelNames[event.ModelID], Provider: event.Provider, Success: event.Success,
				ErrorClass: event.ErrorClass, Usage: event.Usage,
			})
		}
		if response.Code != http.StatusOK {
			result.Error = "HTTP " + response.Result().Status
		} else if delivery == "voice" {
			for _, event := range strings.Split(response.Body.String(), "\n\n") {
				eventName := ""
				var data strings.Builder
				for _, line := range strings.Split(event, "\n") {
					switch {
					case strings.HasPrefix(line, "event:"):
						eventName = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
					case strings.HasPrefix(line, "data:"):
						data.WriteString(strings.TrimSpace(strings.TrimPrefix(line, "data:")))
					}
				}
				switch eventName {
				case "done":
					var body struct {
						Reply string `json:"reply"`
					}
					if err := json.Unmarshal([]byte(data.String()), &body); err == nil {
						result.Reply = body.Reply
					}
				case "error":
					result.Error = data.String()
				}
			}
		} else {
			var body struct {
				Reply string `json:"reply"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &body); err == nil {
				result.Reply = body.Reply
			}
		}
		if result.Reply == "" && result.Error == "" {
			result.Error = "response did not contain a completed reply"
		}
		results = append(results, result)
		encodedResult, _ := json.Marshal(result)
		t.Log(string(encodedResult))
		if result.Error != "" {
			t.Logf("%s did not complete: %s", id, result.Error)
		}
		return result.Reply
	}

	if os.Getenv("PADI_PERSONALITY_LIVE_FILTER") == "focused" {
		firstGreeting := run("first-greeting", "Hi", "occasional", "text", nil)
		run("ordinary-small-talk", "Hey, how are you today?", "occasional", "text", nil)
		run("fine-and-you", "Fine and you?", "occasional", "text", []turn{
			{role: ai.RoleUser, content: "Hi"},
			{role: ai.RoleAssistant, content: firstGreeting},
		})
		run("casual-sharing", "I can't find the tab.", "occasional", "text", nil)
		run("humour-off-sharing", "I left my coffee on the counter again. No joke, please; I just wanted to tell someone.", "off", "text", nil)
		longHistory := []turn{}
		for index, user := range []string{
			"I tried meal planning this week, but Tuesday's leftovers have already formed a committee.",
			"At least the committee agrees on pasta. What should I cook tonight?",
			"I made it. The kitchen looks like the pasta fought back.",
		} {
			reply := run("long-conversation-"+string(rune('1'+index)), user, "occasional", "text", longHistory)
			if reply != "" {
				longHistory = append(longHistory, turn{role: ai.RoleUser, content: user}, turn{role: ai.RoleAssistant, content: reply})
			}
		}
		writeEvidence()
		for _, result := range results {
			if result.Error != "" {
				t.Errorf("%s did not complete: %s", result.ID, result.Error)
			}
		}
		return
	}

	if os.Getenv("PADI_PERSONALITY_LIVE_FILTER") == "voice" {
		firstGreeting := run("first-greeting", "Hi", "occasional", "text", nil)
		run("voice-small-talk", "Fine and you?", "occasional", "voice", []turn{
			{role: ai.RoleUser, content: "Hi"},
			{role: ai.RoleAssistant, content: firstGreeting},
		})
		run("voice-user-joke", "I told my suitcase there would be no holiday this year. Now it's dealing with emotional baggage.", "occasional", "voice", nil)
		run("voice-painful-news", "My dog died last night and I can't stop crying.", "frequent", "voice", nil)
		writeEvidence()
		for _, result := range results {
			if result.Error != "" {
				t.Errorf("%s did not complete: %s", result.ID, result.Error)
			}
		}
		return
	}

	firstGreeting := run("first-greeting", "Hi", "occasional", "text", nil)
	run("ordinary-small-talk", "Hey, how are you today?", "occasional", "text", nil)
	fineAndYou := run("fine-and-you", "Fine and you?", "occasional", "text", []turn{
		{role: ai.RoleUser, content: "Hi"},
		{role: ai.RoleAssistant, content: firstGreeting},
	})
	run("genuinely-funny-joke", "I told my suitcase there would be no holiday this year. Now it's dealing with emotional baggage.", "occasional", "text", nil)
	teaseReply := run("playful-tease", "PADI, you use so many words I could knit a scarf before your answer ends.", "occasional", "text", nil)
	run("affectionate-comeback-follow-up", "That comeback was suspiciously quick. Did you practise it?", "occasional", "text", []turn{
		{role: ai.RoleUser, content: "PADI, you use so many words I could knit a scarf before your answer ends."},
		{role: ai.RoleAssistant, content: teaseReply},
	})
	run("spontaneous-observation", "I have 37 browser tabs open and can't find the one I need.", "occasional", "text", nil)
	run("funny-story", "Tell me a funny little story about an ordinary Tuesday.", "occasional", "text", nil)
	run("good-news", "I got the job! I've been hoping for this for months.", "occasional", "text", nil)
	run("frustrated", "I'm so frustrated. Nothing is working today.", "frequent", "text", nil)
	run("painful-news", "My dog died last night and I can't stop crying.", "frequent", "text", nil)
	run("explicit-serious", "Please give me a serious answer: should I leave my job without another offer?", "frequent", "text", nil)
	run("humour-occasional", "My houseplants look more organised than my calendar.", "occasional", "text", nil)
	run("humour-subtle", "The bus is late again. I've been waiting here for ages.", "subtle", "text", nil)
	run("humour-frequent", "I could use a laugh about my overflowing inbox.", "frequent", "text", nil)
	run("humour-off", "I left my coffee on the counter again. No joke, please; I just wanted to tell someone.", "off", "text", nil)
	run("joke-to-serious", "Actually, serious question: my manager says my role may be cut and I'm scared. What should I do?", "frequent", "text", []turn{
		{role: ai.RoleUser, content: "I set five alarms and negotiated with every single one."},
		{role: ai.RoleAssistant, content: "The snooze button has clearly hired a very convincing lawyer."},
	})

	longHistory := []turn{}
	openings := make(map[string]bool)
	for index, user := range []string{
		"I tried meal planning this week, but Tuesday's leftovers have already formed a committee.",
		"At least the committee agrees on pasta. What should I cook tonight?",
		"I made it. The kitchen looks like the pasta fought back.",
		"Good news: I cleaned up and still have dessert.",
	} {
		id := "long-conversation-" + string(rune('1'+index))
		reply := run(id, user, "occasional", "text", longHistory)
		if reply != "" {
			longHistory = append(longHistory, turn{role: ai.RoleUser, content: user}, turn{role: ai.RoleAssistant, content: reply})
			firstWord := strings.ToLower(strings.Fields(reply)[0])
			if openings[firstWord] {
				t.Logf("opening repeated in long conversation: %q", firstWord)
			}
			openings[firstWord] = true
		}
	}

	for _, test := range []struct {
		id, user, humour string
		history          []turn
	}{
		{"voice-small-talk", "Fine and you?", "occasional", []turn{
			{role: ai.RoleUser, content: "Hi"},
			{role: ai.RoleAssistant, content: firstGreeting},
		}},
		{"voice-user-joke", "I told my suitcase there would be no holiday this year. Now it's dealing with emotional baggage.", "occasional", nil},
		{"voice-painful-news", "My dog died last night and I can't stop crying.", "frequent", nil},
	} {
		run(test.id, test.user, test.humour, "voice", test.history)
	}

	writeEvidence()
	var failures []string
	for _, result := range results {
		if result.Error != "" {
			failures = append(failures, result.ID+": "+result.Error)
		}
	}
	if len(results) != 24 {
		t.Fatalf("recorded %d conversations, want 24 (18 scenarios, three additional long-conversation turns, and three voice comparisons)", len(results))
	}
	if len(failures) > 0 {
		t.Logf("live provider failures (not replaced by successful fallback claims): %s", strings.Join(failures, "; "))
		t.Errorf("%d live conversation(s) did not complete: %s", len(failures), strings.Join(failures, "; "))
	}
	if fineAndYou == "" {
		t.Fatal("fine-and-you response was empty")
	}
}
