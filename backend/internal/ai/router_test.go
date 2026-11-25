package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeProvider struct {
	mu          sync.Mutex
	calls       int
	response    Response
	err         error
	lastRequest Request
}

func TestRouterRequiresValidStructuredOutput(t *testing.T) {
	fast := &fakeProvider{response: Response{Content: `{"intent":"question"}`}}
	router := testRouter(t, []ModelConfig{
		{ID: "fast", Provider: "fast", Model: "fast-model"},
	}, map[string]Provider{"fast": fast},
		RoutingConfig{PrimaryModel: "fast", FastModel: "fast"}, nil)

	response, err := router.Generate(context.Background(), Request{
		Messages:         []Message{{Role: RoleUser, Content: "What time is it?"}},
		Task:             TaskClassification,
		Complexity:       ComplexitySimple,
		StructuredOutput: true,
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if !json.Valid([]byte(response.Content)) {
		t.Errorf("response content = %q, want valid JSON", response.Content)
	}
}

func TestRouterRetriesInvalidStructuredOutputWithFallback(t *testing.T) {
	primary := &fakeProvider{response: Response{Content: "not JSON"}}
	fast := &fakeProvider{response: Response{Content: `{"summary":"done"}`}}
	router := testRouter(t, []ModelConfig{
		{ID: "fast", Provider: "fast", Model: "fast-model"},
		{ID: "primary", Provider: "primary", Model: "primary-model"},
	}, map[string]Provider{"fast": fast, "primary": primary},
		RoutingConfig{PrimaryModel: "primary", FastModel: "fast"}, nil)

	response, err := router.Generate(context.Background(), Request{
		Messages:         []Message{{Role: RoleUser, Content: "Summarize this discussion."}},
		Task:             TaskSummarization,
		Complexity:       ComplexityNormal,
		StructuredOutput: true,
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if response.Provider != "fast" || !json.Valid([]byte(response.Content)) {
		t.Errorf("response = %+v, want valid JSON from the next configured provider", response)
	}
	if primary.callCount() != 1 || fast.callCount() != 1 {
		t.Errorf("calls = primary:%d fast:%d, want one primary attempt and one fallback", primary.callCount(), fast.callCount())
	}
}

func (provider *fakeProvider) Generate(_ context.Context, _ ModelConfig, request Request) (Response, error) {
	provider.mu.Lock()
	defer provider.mu.Unlock()
	provider.calls++
	provider.lastRequest = request
	return provider.response, provider.err
}

func (provider *fakeProvider) callCount() int {
	provider.mu.Lock()
	defer provider.mu.Unlock()
	return provider.calls
}

func TestRouterInjectsOneSharedPADIInstructionForAllProviders(t *testing.T) {
	provider := &fakeProvider{response: Response{Content: "Hello"}}
	router := testRouter(t,
		[]ModelConfig{{ID: "main", Provider: "test", Model: "test-model"}},
		map[string]Provider{"test": provider},
		RoutingConfig{PrimaryModel: "main"}, nil)

	if _, err := router.Generate(context.Background(), Request{StyleGuidance: "Use a friendly tone.", Messages: []Message{
		{Role: RoleSystem, Content: "Respond in the user's selected language. The user prefers serious conversation."},
		{Role: RoleUser, Content: "Hello"},
	}}); err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	provider.mu.Lock()
	defer provider.mu.Unlock()
	messages := provider.lastRequest.Messages
	if len(messages) != 2 || messages[0].Role != RoleSystem ||
		!strings.Contains(messages[0].Content, "one consistent AI companion") ||
		!strings.Contains(messages[0].Content, "selected language") ||
		!strings.Contains(messages[0].Content, "response guidance, not fixed modes") ||
		!strings.Contains(messages[0].Content, "Never joke about a user's suffering") ||
		!strings.Contains(messages[0].Content, "stop joking") ||
		!strings.Contains(messages[0].Content, "signals are uncertain, not diagnoses") ||
		!strings.Contains(messages[0].Content, "Use a friendly tone.") ||
		!strings.Contains(messages[0].Content, "Do not infer a lasting preference") ||
		messages[1].Role != RoleUser {
		t.Fatalf("provider request messages = %+v, want shared personality guidance, application context, and user message", messages)
	}
}

func TestRouterTriesPrimaryBeforeFallbackForEveryTask(t *testing.T) {
	primary := &fakeProvider{response: Response{Content: "primary"}}
	fast := &fakeProvider{response: Response{Content: "fast"}}
	reasoning := &fakeProvider{response: Response{Content: "reasoning"}}
	router := testRouter(t, []ModelConfig{
		{ID: "primary", Provider: "primary", Model: "primary-model"},
		{ID: "fast", Provider: "fast", Model: "fast-model"},
		{ID: "reasoning", Provider: "reasoning", Model: "reasoning-model"},
	}, map[string]Provider{"primary": primary, "fast": fast, "reasoning": reasoning},
		RoutingConfig{PrimaryModel: "primary", FastModel: "fast", ReasoningModel: "reasoning"}, nil)

	tests := []struct {
		name        string
		request     Request
		wantContent string
	}{
		{
			name:        "extraction tries primary first",
			request:     testRequest(TaskExtraction, ComplexityNormal),
			wantContent: "primary",
		},
		{
			name:        "classification tries primary first",
			request:     testRequest(TaskClassification, ComplexityNormal),
			wantContent: "primary",
		},
		{
			name:        "summarization tries primary first",
			request:     testRequest(TaskSummarization, ComplexityComplex),
			wantContent: "primary",
		},
		{
			name:        "text processing tries primary first",
			request:     testRequest(TaskTextProcessing, ComplexityNormal),
			wantContent: "primary",
		},
		{
			name:        "simple conversation tries primary first",
			request:     testRequest(TaskConversation, ComplexitySimple),
			wantContent: "primary",
		},
		{
			name:        "complex task tries primary first",
			request:     testRequest(TaskConversation, ComplexityComplex),
			wantContent: "primary",
		},
		{
			name:        "planning tries primary first",
			request:     testRequest(TaskPlanning, ComplexityNormal),
			wantContent: "primary",
		},
		{
			name:        "technical assistance tries primary first",
			request:     testRequest(TaskTechnical, ComplexitySimple),
			wantContent: "primary",
		},
		{
			name:        "decision support tries primary first",
			request:     testRequest(TaskDecision, ComplexityNormal),
			wantContent: "primary",
		},
		{
			name:        "complex analysis tries primary first",
			request:     testRequest(TaskAnalysis, ComplexityNormal),
			wantContent: "primary",
		},
		{
			name:        "learning tries primary first",
			request:     testRequest(TaskLearning, ComplexityNormal),
			wantContent: "primary",
		},
		{
			name:        "quality review tries primary first",
			request:     testRequest(TaskQualityReview, ComplexityNormal),
			wantContent: "primary",
		},
		{
			name:        "normal conversation tries primary first",
			request:     testRequest(TaskConversation, ComplexityNormal),
			wantContent: "primary",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			// These routing cases are independent; shared usage budgets must not
			// trigger fallback as the common personality instructions evolve.
			router.limiter = newMemoryUsageLimiter()
			response, err := router.Generate(context.Background(), test.request)
			if err != nil {
				t.Fatalf("Generate() error = %v", err)
			}
			if response.Content != test.wantContent {
				t.Errorf("Content = %q, want %q", response.Content, test.wantContent)
			}
		})
	}
}

func TestRouterFallsBackGroqThenOpenRouterThenZAIForEveryTask(t *testing.T) {
	tests := []struct {
		name       string
		task       Task
		complexity Complexity
	}{
		{name: "conversation", task: TaskConversation, complexity: ComplexitySimple},
		{name: "reasoning", task: TaskPlanning, complexity: ComplexityComplex},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			groq := &fakeProvider{err: &ProviderError{Provider: ProviderGroq, Status: 503, Retryable: true}}
			openrouter := &fakeProvider{err: &ProviderError{Provider: ProviderOpenRouter, Status: 503, Retryable: true}}
			zai := &fakeProvider{response: Response{Content: "Z.ai fallback"}}
			var events []Event
			router := testRouter(t, []ModelConfig{
				{ID: "groq-fast", Provider: ProviderGroq, Model: "openai/gpt-oss-20b"},
				{ID: "openrouter-backup", Provider: ProviderOpenRouter, Model: "nvidia/nemotron-3.5-lightning:free"},
				{ID: "zai-reasoning", Provider: ProviderZAI, Model: ZAIFlashModel},
			}, map[string]Provider{
				ProviderGroq: groq, ProviderOpenRouter: openrouter, ProviderZAI: zai,
			}, RoutingConfig{
				PrimaryModel: "groq-fast", FastModel: "groq-fast",
				BackupModel: "openrouter-backup", ReasoningModel: "zai-reasoning",
			}, ObserverFunc(func(event Event) { events = append(events, event) }))

			response, err := router.Generate(context.Background(), Request{
				Messages:   []Message{{Role: RoleUser, Content: "Please help with a synthetic routing check."}},
				Task:       test.task,
				Complexity: test.complexity,
			})
			if err != nil {
				t.Fatalf("Generate() error = %v", err)
			}
			if response.Provider != ProviderZAI || response.Content != "Z.ai fallback" {
				t.Fatalf("response = %+v, want successful Z.ai third fallback", response)
			}
			if groq.callCount() != 1 || openrouter.callCount() != 1 || zai.callCount() != 1 {
				t.Fatalf("calls = Groq:%d OpenRouter:%d Z.ai:%d, want one per provider",
					groq.callCount(), openrouter.callCount(), zai.callCount())
			}
			if len(events) != 3 || events[0].Provider != ProviderGroq ||
				events[1].Provider != ProviderOpenRouter || events[2].Provider != ProviderZAI {
				t.Fatalf("attempt order = %+v, want Groq -> OpenRouter -> Z.ai", events)
			}
		})
	}
}

func TestRouterUsesGroqPrimaryThenOpenRouterForConversationFallback(t *testing.T) {
	groq := &fakeProvider{err: &ProviderError{Provider: ProviderGroq, Status: 429, Retryable: true}}
	openrouter := &fakeProvider{response: Response{Content: "OpenRouter conversation fallback"}}
	router := testRouter(t, []ModelConfig{
		{ID: "groq-fast", Provider: ProviderGroq, Model: "groq-model"},
		{ID: "openrouter-backup", Provider: ProviderOpenRouter, Model: "backup-model"},
	}, map[string]Provider{ProviderGroq: groq, ProviderOpenRouter: openrouter},
		RoutingConfig{PrimaryModel: "groq-fast", FastModel: "groq-fast", BackupModel: "openrouter-backup"}, nil)

	response, err := router.Generate(context.Background(), Request{
		Messages:   []Message{{Role: RoleUser, Content: "Fine and you?"}},
		Task:       TaskConversation,
		Complexity: ComplexitySimple,
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if response.Provider != ProviderOpenRouter || response.Content != "OpenRouter conversation fallback" ||
		groq.callCount() != 1 || openrouter.callCount() != 1 {
		t.Fatalf("response=%+v calls Groq:%d OpenRouter:%d; want Groq primary then OpenRouter fallback",
			response, groq.callCount(), openrouter.callCount())
	}
}

func TestRouterVoiceUsesOnlyGeminiThenGroqFallback(t *testing.T) {
	gemini := &fakeProvider{err: &ProviderError{Provider: "gemini", Status: 503, Retryable: true}}
	groq := &fakeProvider{response: Response{Content: "groq voice answer"}}
	openrouter := &fakeProvider{response: Response{Content: "unexpected backup"}}
	router := testRouter(t, []ModelConfig{
		{ID: "gemini-primary", Provider: "gemini", Model: "gemini-model", Retries: 2},
		{ID: "groq-fast", Provider: "groq", Model: "groq-model"},
		{ID: "openrouter-backup", Provider: "openrouter", Model: "backup-model"},
	}, map[string]Provider{
		"gemini": gemini, "groq": groq, "openrouter": openrouter,
	}, RoutingConfig{
		PrimaryModel: "gemini-primary",
		FastModel:    "groq-fast",
		BackupModel:  "openrouter-backup",
	}, nil)

	candidates := router.candidates(Request{Voice: true})
	if len(candidates) != 2 || candidates[0] != "gemini-primary" || candidates[1] != "groq-fast" {
		t.Fatalf("voice candidates = %v, want Gemini then Groq", candidates)
	}

	response, err := router.Generate(context.Background(), Request{
		Messages:   []Message{{Role: RoleUser, Content: "What is the weather?"}},
		Task:       TaskConversation,
		Complexity: ComplexitySimple,
		Voice:      true,
	})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if response.Content != "groq voice answer" {
		t.Fatalf("response content = %q, want Groq fallback answer", response.Content)
	}
	if gemini.callCount() != 1 {
		t.Errorf("Gemini calls = %d, want 1 immediate fallback attempt; response provider=%q", gemini.callCount(), response.Provider)
	}
	if groq.callCount() != 1 {
		t.Errorf("Groq calls = %d, want 1", groq.callCount())
	}
	if openrouter.callCount() != 0 {
		t.Errorf("OpenRouter calls = %d, want 0 for voice routing", openrouter.callCount())
	}
}

func TestRouterVoiceStreamingSupportsConfiguredTextModels(t *testing.T) {
	router := testRouter(t, []ModelConfig{
		{ID: "gemini-main", Provider: ProviderGemini, Model: "gemini-model"},
		{ID: "groq-fast", Provider: ProviderGroq, Model: "openai/gpt-oss-20b"},
	}, map[string]Provider{ProviderGemini: geminiProvider{}, ProviderGroq: groqProvider{}},
		RoutingConfig{PrimaryModel: "gemini-main", FastModel: "groq-fast"}, nil)
	if !router.SupportsGroqVoiceStreaming() {
		t.Fatal("configured Gemini and Groq text models should enable voice streaming")
	}

	request := Request{Messages: []Message{{Role: RoleUser, Content: "Hello"}}, Voice: true}
	if _, err := router.StreamVoice(context.Background(), request, nil); err == nil {
		t.Fatal("streaming without a configured Groq credential unexpectedly succeeded")
	}

	router.providers[ProviderGemini] = &fakeProvider{}
	if router.SupportsGroqVoiceStreaming() {
		t.Fatal("a provider without a streaming adapter enabled streaming")
	}
}

func TestRouterFallsBackOnRetryableFailureAndObservesUsage(t *testing.T) {
	primary := &fakeProvider{err: &ProviderError{Provider: "primary", Status: 503, Retryable: true}}
	backup := &fakeProvider{response: Response{
		Content: "backup answer",
		Usage:   Usage{InputTokens: 100, OutputTokens: 40},
	}}
	var events []Event
	router := testRouter(t, []ModelConfig{
		{ID: "primary", Provider: "primary", Model: "p-model"},
		{ID: "backup", Provider: "backup", Model: "b-model", InputCostPerMillion: 2, OutputCostPerMillion: 4},
	}, map[string]Provider{"primary": primary, "backup": backup},
		RoutingConfig{PrimaryModel: "primary", BackupModel: "backup"},
		ObserverFunc(func(event Event) { events = append(events, event) }))

	response, err := router.Generate(context.Background(), testRequest(TaskConversation, ComplexityNormal))
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if response.Content != "backup answer" || response.Provider != "backup" || response.Model != "b-model" {
		t.Errorf("response = %+v, want backup provider result", response)
	}
	if primary.callCount() != 1 || backup.callCount() != 1 {
		t.Errorf("calls = primary:%d backup:%d, want one each", primary.callCount(), backup.callCount())
	}
	if len(events) != 2 || events[0].ErrorClass != "provider_unavailable" || !events[1].Success {
		t.Fatalf("events = %+v, want failed primary and successful backup events", events)
	}
	if events[1].EstimatedCost != 0.00036 {
		t.Errorf("EstimatedCost = %f, want 0.00036", events[1].EstimatedCost)
	}
}

func TestRouterFallsBackWhenOpenRouterModelIsUnavailable(t *testing.T) {
	openRouter := &fakeProvider{err: &ProviderError{Provider: ProviderOpenRouter, Status: 404, Retryable: true}}
	gemini := &fakeProvider{response: Response{Content: "Gemini fallback"}}
	router := testRouter(t, []ModelConfig{
		{ID: "openrouter-backup", Provider: ProviderOpenRouter, Model: "vendor/unavailable-free-model", Retries: 2},
		{ID: "gemini", Provider: ProviderGemini, Model: "configured-gemini"},
	}, map[string]Provider{ProviderOpenRouter: openRouter, ProviderGemini: gemini},
		RoutingConfig{
			PrimaryModel:       "openrouter-backup",
			BackupModel:        "gemini",
			ApprovedFreeModels: []string{"openrouter:vendor/unavailable-free-model", "gemini:configured-gemini"},
		}, nil)

	response, err := router.Generate(context.Background(), testRequest(TaskConversation, ComplexityNormal))
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if response.Content != "Gemini fallback" || openRouter.callCount() != 1 || gemini.callCount() != 1 {
		t.Errorf("response = %+v, calls OpenRouter:%d Gemini:%d; want unavailable model then Gemini fallback",
			response, openRouter.callCount(), gemini.callCount())
	}
}

func TestRouterFallsBackOnRateLimitWithoutRepeatingLimitedProvider(t *testing.T) {
	groq := &fakeProvider{err: &ProviderError{Provider: ProviderGroq, Status: 429, Retryable: true}}
	gemini := &fakeProvider{response: Response{Content: "Gemini answer"}}
	router := testRouter(t, []ModelConfig{
		{ID: "groq-fast", Provider: ProviderGroq, Model: "fast-model", Retries: 2},
		{ID: "gemini-main", Provider: ProviderGemini, Model: "main-model"},
	}, map[string]Provider{ProviderGroq: groq, ProviderGemini: gemini},
		RoutingConfig{PrimaryModel: "groq-fast", FastModel: "groq-fast", BackupModel: "gemini-main"}, nil)

	response, err := router.Generate(context.Background(), testRequest(TaskClassification, ComplexitySimple))
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if response.Provider != ProviderGemini || groq.callCount() != 1 || gemini.callCount() != 1 {
		t.Errorf("response = %+v, calls Groq:%d Gemini:%d; want one rate-limited Groq attempt then Gemini",
			response, groq.callCount(), gemini.callCount())
	}
}

func TestRouterFallsBackWhenAdapterReturnsBlankSuccess(t *testing.T) {
	primary := &fakeProvider{response: Response{Content: " \n\t"}}
	backup := &fakeProvider{response: Response{Content: "Backup answer"}}
	router := testRouter(t, []ModelConfig{
		{ID: "primary", Provider: "primary", Model: "primary-model", Retries: 2},
		{ID: "backup", Provider: "backup", Model: "backup-model"},
	}, map[string]Provider{"primary": primary, "backup": backup},
		RoutingConfig{PrimaryModel: "primary", BackupModel: "backup"}, nil)
	response, err := router.Generate(context.Background(), testRequest(TaskConversation, ComplexityNormal))
	if err != nil || response.Content != "Backup answer" || primary.callCount() != 1 || backup.callCount() != 1 {
		t.Fatal("blank success must fall back without repeating the empty provider")
	}
}

func TestRouterReportsAllEmptyProvidersAsFailure(t *testing.T) {
	primary := &fakeProvider{response: Response{}}
	backup := &fakeProvider{response: Response{}}
	router := testRouter(t, []ModelConfig{
		{ID: "primary", Provider: "primary", Model: "primary-model"},
		{ID: "backup", Provider: "backup", Model: "backup-model"},
	}, map[string]Provider{"primary": primary, "backup": backup},
		RoutingConfig{PrimaryModel: "primary", BackupModel: "backup"}, nil)
	response, err := router.Generate(context.Background(), testRequest(TaskConversation, ComplexityNormal))
	if !errors.Is(err, ErrEmptyProviderResponse) || response.Content != "" || primary.callCount() != 1 || backup.callCount() != 1 {
		t.Fatal("all empty providers must return an error, never a fabricated answer")
	}
}

func TestRouterFallsBackAcrossConfiguredRoles(t *testing.T) {
	primary := &fakeProvider{err: &ProviderError{Provider: "primary", Status: 503, Retryable: true}}
	backup := &fakeProvider{err: &ProviderError{Provider: "backup", Status: 503, Retryable: true}}
	fast := &fakeProvider{err: &ProviderError{Provider: "fast", Status: 503, Retryable: true}}
	reasoning := &fakeProvider{response: Response{Content: "Reasoning fallback"}}
	router := testRouter(t, []ModelConfig{
		{ID: "primary", Provider: "primary", Model: "primary-model"},
		{ID: "backup", Provider: "backup", Model: "backup-model"},
		{ID: "fast", Provider: "fast", Model: "fast-model"},
		{ID: "reasoning", Provider: "reasoning", Model: "reasoning-model"},
	}, map[string]Provider{
		"primary": primary, "backup": backup, "fast": fast, "reasoning": reasoning,
	}, RoutingConfig{
		PrimaryModel: "primary", BackupModel: "backup", FastModel: "fast", ReasoningModel: "reasoning",
	}, nil)

	response, err := router.Generate(context.Background(), testRequest(TaskConversation, ComplexityNormal))
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if response.Content != "Reasoning fallback" {
		t.Errorf("response = %+v, want final configured role as fallback", response)
	}
	if primary.callCount() != 1 || backup.callCount() != 1 || fast.callCount() != 1 || reasoning.callCount() != 1 {
		t.Errorf("provider calls = primary:%d backup:%d fast:%d reasoning:%d; want one call each",
			primary.callCount(), backup.callCount(), fast.callCount(), reasoning.callCount())
	}
}

func TestRouterFallsBackAfterNonRetryableProviderFailure(t *testing.T) {
	primary := &fakeProvider{err: &ProviderError{Provider: "primary", Status: 401}}
	backup := &fakeProvider{response: Response{Content: "backup answer"}}
	router := testRouter(t, []ModelConfig{
		{ID: "primary", Provider: "primary", Model: "p-model"},
		{ID: "backup", Provider: "backup", Model: "b-model"},
	}, map[string]Provider{"primary": primary, "backup": backup},
		RoutingConfig{PrimaryModel: "primary", BackupModel: "backup"}, nil)

	response, err := router.Generate(context.Background(), testRequest(TaskConversation, ComplexityNormal))
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if response.Provider != "backup" || response.Content != "backup answer" ||
		primary.callCount() != 1 || backup.callCount() != 1 {
		t.Errorf("response=%+v calls primary:%d backup:%d; want backup after one primary failure",
			response, primary.callCount(), backup.callCount())
	}
}

func TestRouterDoesNotFallbackAfterCancellation(t *testing.T) {
	primary := &fakeProvider{err: &ProviderError{Provider: "primary", Err: context.Canceled}}
	backup := &fakeProvider{response: Response{Content: "must not run"}}
	router := testRouter(t, []ModelConfig{
		{ID: "primary", Provider: "primary", Model: "p-model"},
		{ID: "backup", Provider: "backup", Model: "b-model"},
	}, map[string]Provider{"primary": primary, "backup": backup},
		RoutingConfig{PrimaryModel: "primary", BackupModel: "backup"}, nil)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := router.Generate(ctx, testRequest(TaskConversation, ComplexityNormal))
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Generate() error = %v, want context cancellation", err)
	}
	if backup.callCount() != 0 {
		t.Errorf("backup calls = %d, want no fallback after cancellation", backup.callCount())
	}
}

func TestRouterAdvancesAfterProviderSpecificTimeout(t *testing.T) {
	primary := &fakeProvider{err: &ProviderError{
		Provider: "primary", Retryable: true, Err: context.DeadlineExceeded,
	}}
	backup := &fakeProvider{response: Response{Content: "backup answer"}}
	router := testRouter(t, []ModelConfig{
		{ID: "primary", Provider: "primary", Model: "p-model"},
		{ID: "backup", Provider: "backup", Model: "b-model"},
	}, map[string]Provider{"primary": primary, "backup": backup},
		RoutingConfig{PrimaryModel: "primary", BackupModel: "backup"}, nil)

	response, err := router.Generate(context.Background(), testRequest(TaskConversation, ComplexityNormal))
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if response.Provider != "backup" || primary.callCount() != 1 || backup.callCount() != 1 {
		t.Errorf("response=%+v calls primary:%d backup:%d; want provider-specific timeout to advance",
			response, primary.callCount(), backup.callCount())
	}
}

func TestRouterRetriesTransientFailureWithinConfiguredLimit(t *testing.T) {
	primary := &fakeProvider{err: &ProviderError{Provider: "primary", Status: 503, Retryable: true}}
	backup := &fakeProvider{response: Response{Content: "backup"}}
	router := testRouter(t, []ModelConfig{
		{ID: "primary", Provider: "primary", Model: "p-model", Retries: 1},
		{ID: "backup", Provider: "backup", Model: "b-model"},
	}, map[string]Provider{"primary": primary, "backup": backup},
		RoutingConfig{PrimaryModel: "primary", BackupModel: "backup"}, nil)

	if _, err := router.Generate(context.Background(), testRequest(TaskConversation, ComplexityNormal)); err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if primary.callCount() != 2 || backup.callCount() != 1 {
		t.Errorf("calls = primary:%d backup:%d, want primary retry then fallback", primary.callCount(), backup.callCount())
	}
}

func TestRouterOpensCircuitAfterRepeatedTransientFailures(t *testing.T) {
	provider := &fakeProvider{err: &ProviderError{Provider: "primary", Status: 503, Retryable: true}}
	router := testRouter(t, []ModelConfig{{ID: "primary", Provider: "primary", Model: "p-model"}},
		map[string]Provider{"primary": provider},
		RoutingConfig{PrimaryModel: "primary"}, nil)
	// Test the circuit independently of daily budgets as the shared prompt grows.
	// Usage-cap enforcement has its own tests below.
	router.limiter = &timestampUsageLimiter{}

	for i := 0; i < circuitFailureLimit; i++ {
		if _, err := router.Generate(context.Background(), testRequest(TaskConversation, ComplexityNormal)); err == nil {
			t.Fatal("Generate() error = nil, want provider failure")
		}
	}
	if _, err := router.Generate(context.Background(), testRequest(TaskConversation, ComplexityNormal)); !errors.Is(err, ErrCircuitOpen) {
		t.Errorf("Generate() error = %v, want ErrCircuitOpen", err)
	}
	if provider.callCount() != circuitFailureLimit {
		t.Errorf("provider calls = %d, want %d", provider.callCount(), circuitFailureLimit)
	}
}

func TestRouterValidatesRequestAndRegistry(t *testing.T) {
	provider := &fakeProvider{response: Response{Content: "ok"}}
	models := []ModelConfig{{ID: "primary", Provider: "primary", Model: "p-model"}}
	router := testRouter(t, models, map[string]Provider{"primary": provider}, RoutingConfig{PrimaryModel: "primary"}, nil)

	tests := []Request{
		{},
		{Messages: []Message{{Role: "tool", Content: "no"}}},
		{Messages: []Message{{Role: RoleUser, Content: "hello"}}, Task: "unknown"},
	}
	for _, request := range tests {
		if _, err := router.Generate(context.Background(), request); err == nil {
			t.Errorf("Generate(%+v) error = nil, want validation error", request)
		}
	}
	if _, err := NewRouter(models, map[string]Provider{}, RoutingConfig{PrimaryModel: "primary"}, nil); err == nil {
		t.Error("NewRouter() error = nil, want missing adapter error")
	}
}

func TestInferTaskAndComplexity(t *testing.T) {
	task, complexity := InferTaskAndComplexity([]Message{{Role: RoleUser, Content: "Summarize this short note."}})
	if task != TaskExtraction || complexity != ComplexitySimple {
		t.Errorf("inferred = (%q, %q), want extraction/simple", task, complexity)
	}
	longText := "Please compare these approaches and explain the tradeoffs step by step."
	task, complexity = InferTaskAndComplexity([]Message{{Role: RoleUser, Content: longText}})
	if task != TaskConversation || complexity != ComplexityComplex {
		t.Errorf("inferred = (%q, %q), want conversation/complex", task, complexity)
	}
}

func testRouter(t *testing.T, models []ModelConfig, providers map[string]Provider, routing RoutingConfig, observer Observer) *Router {
	t.Helper()
	for _, model := range models {
		identity := model.Provider + ":" + model.Model
		if !containsModel(routing.ApprovedFreeModels, identity) {
			routing.ApprovedFreeModels = append(routing.ApprovedFreeModels, identity)
		}
	}
	router, err := NewRouterWithUsageLimiter(models, providers, routing, observer, newMemoryUsageLimiter())
	if err != nil {
		t.Fatalf("NewRouter() error = %v", err)
	}
	return router
}

func TestRouterFallsBackWhenProviderUsageCapIsReached(t *testing.T) {
	limiter := newMemoryUsageLimiter()
	limits := FreeUsageLimits()
	for i := 0; i < limits.RequestsPerDay; i++ {
		if err := limiter.Reserve(context.Background(), ProviderGroq, 1, limits, time.Now()); err != nil {
			t.Fatalf("pre-fill Groq usage #%d: %v", i+1, err)
		}
	}

	groq := &fakeProvider{response: Response{Content: "should not be called"}}
	gemini := &fakeProvider{response: Response{Content: "Gemini fallback"}}
	router, err := NewRouterWithUsageLimiter([]ModelConfig{
		{ID: "groq-fast", Provider: ProviderGroq, Model: "fast-model"},
		{ID: "gemini-main", Provider: ProviderGemini, Model: "main-model"},
	}, map[string]Provider{ProviderGroq: groq, ProviderGemini: gemini},
		RoutingConfig{
			PrimaryModel:       "gemini-main",
			FastModel:          "groq-fast",
			ApprovedFreeModels: []string{"groq:fast-model", "gemini:main-model"},
		}, nil, limiter)
	if err != nil {
		t.Fatalf("NewRouterWithUsageLimiter() error = %v", err)
	}
	response, err := router.Generate(context.Background(), testRequest(TaskClassification, ComplexitySimple))
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if response.Provider != ProviderGemini || groq.callCount() != 0 || gemini.callCount() != 1 {
		t.Errorf("response = %+v, calls Groq:%d Gemini:%d; want exhausted Groq skipped for Gemini",
			response, groq.callCount(), gemini.callCount())
	}
}

func testRequest(task Task, complexity Complexity) Request {
	return Request{
		Messages:   []Message{{Role: RoleUser, Content: "Help me with this."}},
		Task:       task,
		Complexity: complexity,
	}
}

type timestampUsageLimiter struct {
	reservedAt time.Time
	recordedAt time.Time
}

func (limiter *timestampUsageLimiter) Reserve(_ context.Context, _ string, _ int, _ UsageLimits, at time.Time) error {
	limiter.reservedAt = at
	return nil
}

func (limiter *timestampUsageLimiter) RecordUsage(_ context.Context, _ string, _ Usage, at time.Time) error {
	limiter.recordedAt = at
	return nil
}

func TestRouterRecordsUsageInReservationPeriod(t *testing.T) {
	limiter := &timestampUsageLimiter{}
	provider := &fakeProvider{response: Response{Content: "answer", Usage: Usage{InputTokens: 10, OutputTokens: 5}}}
	router, err := NewRouterWithUsageLimiter(
		[]ModelConfig{{ID: "main", Provider: "test", Model: "test-model"}},
		map[string]Provider{"test": provider},
		RoutingConfig{
			PrimaryModel:       "main",
			ApprovedFreeModels: []string{"test:test-model"},
		},
		nil,
		limiter,
	)
	if err != nil {
		t.Fatalf("NewRouterWithUsageLimiter() error = %v", err)
	}

	times := []time.Time{
		time.Date(2026, time.December, 31, 23, 59, 58, 0, time.UTC),
		time.Date(2026, time.December, 31, 23, 59, 59, 0, time.UTC),
		time.Date(2027, time.January, 1, 0, 0, 0, 0, time.UTC),
		time.Date(2027, time.January, 1, 0, 0, 1, 0, time.UTC),
	}
	router.now = func() time.Time {
		if len(times) == 0 {
			t.Fatal("router requested unexpected additional clock time")
		}
		at := times[0]
		times = times[1:]
		return at
	}

	if _, err := router.Generate(context.Background(), testRequest(TaskConversation, ComplexityNormal)); err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if !limiter.reservedAt.Equal(limiter.recordedAt) {
		t.Errorf("reservation time = %s, usage recording time = %s; want identical period timestamps",
			limiter.reservedAt, limiter.recordedAt)
	}
	if limiter.reservedAt.Month() != time.December || limiter.recordedAt.Month() != time.December {
		t.Errorf("reservation month = %s, recorded month = %s; want usage recorded in reserved month",
			limiter.reservedAt.Month(), limiter.recordedAt.Month())
	}
}

func TestRouterRejectsNegativeProviderUsage(t *testing.T) {
	provider := &fakeProvider{response: Response{
		Content: "answer",
		Usage:   Usage{InputTokens: -1, OutputTokens: 5},
	}}
	router := testRouter(t,
		[]ModelConfig{{ID: "main", Provider: "test", Model: "test-model"}},
		map[string]Provider{"test": provider},
		RoutingConfig{PrimaryModel: "main"},
		nil,
	)

	_, err := router.Generate(context.Background(), testRequest(TaskConversation, ComplexityNormal))
	if !errors.Is(err, ErrInvalidProviderUsage) {
		t.Fatalf("Generate() error = %v, want invalid provider usage error", err)
	}
}

func TestNewRouterRejectsBadConfiguration(t *testing.T) {
	tests := []struct {
		name     string
		models   []ModelConfig
		routing  RoutingConfig
		provider map[string]Provider
	}{
		{
			name:     "missing primary",
			provider: map[string]Provider{"provider": &fakeProvider{}},
		},
		{
			name:     "unknown model reference",
			models:   []ModelConfig{{ID: "known", Provider: "provider", Model: "model"}},
			routing:  RoutingConfig{PrimaryModel: "missing"},
			provider: map[string]Provider{"provider": &fakeProvider{}},
		},
		{
			name:     "duplicate model id",
			models:   []ModelConfig{{ID: "same", Provider: "provider", Model: "one"}, {ID: "same", Provider: "provider", Model: "two"}},
			routing:  RoutingConfig{PrimaryModel: "same"},
			provider: map[string]Provider{"provider": &fakeProvider{}},
		},
		{
			name: "insecure remote provider endpoint",
			models: []ModelConfig{{
				ID: "main", Provider: "provider", Model: "model", Endpoint: "http://ai.example.test/v1",
			}},
			routing:  RoutingConfig{PrimaryModel: "main"},
			provider: map[string]Provider{"provider": &fakeProvider{}},
		},
		{
			name: "OpenRouter model missing free-model approval",
			models: []ModelConfig{
				{ID: "main", Provider: ProviderOpenRouter, Model: "vendor/model-free"},
			},
			provider: map[string]Provider{ProviderOpenRouter: &fakeProvider{}},
			routing:  RoutingConfig{PrimaryModel: "main"},
		},
		{
			name: "OpenRouter allowlist references unconfigured model",
			models: []ModelConfig{
				{ID: "main", Provider: "primary", Model: "primary-model"},
			},
			provider: map[string]Provider{"primary": &fakeProvider{}},
			routing: RoutingConfig{
				PrimaryModel:       "main",
				ApprovedFreeModels: []string{"openrouter:vendor/unconfigured"},
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := NewRouter(test.models, test.provider, test.routing, nil); err == nil {
				t.Fatal("NewRouter() error = nil, want configuration error")
			}
		})
	}
}

func TestCircuitBreakerHalfOpenProbe(t *testing.T) {
	breaker := &circuitBreaker{}
	now := time.Now()
	for i := 0; i < circuitFailureLimit; i++ {
		breaker.allow(now)
		breaker.recordFailure(now, true)
	}
	if breaker.allow(now.Add(time.Second)) {
		t.Fatal("allow() = true while circuit is open")
	}
	afterCooldown := now.Add(circuitOpenDuration + time.Second)
	if !breaker.allow(afterCooldown) {
		t.Fatal("allow() = false after circuit cooldown")
	}
	if breaker.allow(afterCooldown) {
		t.Fatal("allow() = true for concurrent half-open probe")
	}
	breaker.recordSuccess()
	if !breaker.allow(afterCooldown) {
		t.Fatal("allow() = false after successful half-open probe")
	}
}

func TestProviderErrorDoesNotExposeWrappedDetails(t *testing.T) {
	err := &ProviderError{Provider: "sample", Err: fmt.Errorf("secret=%s", "must-not-leak")}
	if strings.Contains(err.Error(), "must-not-leak") {
		t.Fatalf("provider error leaks wrapped error: %v", err)
	}
}
