package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeProvider struct {
	mu       sync.Mutex
	calls    int
	response Response
	err      error
}

func (provider *fakeProvider) Generate(context.Context, ModelConfig, Request) (Response, error) {
	provider.mu.Lock()
	defer provider.mu.Unlock()
	provider.calls++
	return provider.response, provider.err
}

func (provider *fakeProvider) callCount() int {
	provider.mu.Lock()
	defer provider.mu.Unlock()
	return provider.calls
}

func TestRouterRoutesByTaskAndComplexity(t *testing.T) {
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
			name:        "extraction uses fast model",
			request:     testRequest(TaskExtraction, ComplexityNormal),
			wantContent: "fast",
		},
		{
			name:        "complex task uses reasoning model",
			request:     testRequest(TaskConversation, ComplexityComplex),
			wantContent: "reasoning",
		},
		{
			name:        "normal conversation uses primary model",
			request:     testRequest(TaskConversation, ComplexityNormal),
			wantContent: "primary",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
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

func TestRouterDoesNotFallbackOnNonRetryableFailure(t *testing.T) {
	primary := &fakeProvider{err: &ProviderError{Provider: "primary", Status: 401}}
	backup := &fakeProvider{response: Response{Content: "must not run"}}
	router := testRouter(t, []ModelConfig{
		{ID: "primary", Provider: "primary", Model: "p-model"},
		{ID: "backup", Provider: "backup", Model: "b-model"},
	}, map[string]Provider{"primary": primary, "backup": backup},
		RoutingConfig{PrimaryModel: "primary", BackupModel: "backup"}, nil)

	if _, err := router.Generate(context.Background(), testRequest(TaskConversation, ComplexityNormal)); err == nil {
		t.Fatal("Generate() error = nil, want provider rejection")
	}
	if backup.callCount() != 0 {
		t.Errorf("backup calls = %d, want no fallback on non-retryable error", backup.callCount())
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
	router, err := NewRouter(models, providers, routing, observer)
	if err != nil {
		t.Fatalf("NewRouter() error = %v", err)
	}
	return router
}

func testRequest(task Task, complexity Complexity) Request {
	return Request{
		Messages:   []Message{{Role: RoleUser, Content: "Help me with this."}},
		Task:       task,
		Complexity: complexity,
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
