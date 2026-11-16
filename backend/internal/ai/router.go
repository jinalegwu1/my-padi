package ai

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	defaultModelTimeout = 20 * time.Second
	maxModelTimeout     = 2 * time.Minute
	circuitFailureLimit = 3
	circuitOpenDuration = 30 * time.Second
)

type Router struct {
	models    map[string]ModelConfig
	providers map[string]Provider
	routing   RoutingConfig
	observer  Observer
	breakers  map[string]*circuitBreaker
	breakerMu sync.Mutex
	now       func() time.Time
}

func NewRouter(models []ModelConfig, providers map[string]Provider, routing RoutingConfig, observer Observer) (*Router, error) {
	if routing.PrimaryModel == "" {
		return nil, errors.New("primary AI model is required")
	}

	registered := make(map[string]ModelConfig, len(models))
	for _, model := range models {
		if model.ID == "" || model.Provider == "" || model.Model == "" {
			return nil, fmt.Errorf("AI model requires id, provider, and model")
		}
		if _, exists := registered[model.ID]; exists {
			return nil, fmt.Errorf("duplicate AI model id %q", model.ID)
		}
		if providers[model.Provider] == nil {
			return nil, fmt.Errorf("no AI provider adapter registered for %q", model.Provider)
		}
		if model.TimeoutMillis < 0 || time.Duration(model.TimeoutMillis)*time.Millisecond > maxModelTimeout {
			return nil, fmt.Errorf("AI model %q timeout must be between 0 and %s", model.ID, maxModelTimeout)
		}
		if model.Retries < 0 || model.Retries > 2 {
			return nil, fmt.Errorf("AI model %q retries must be between 0 and 2", model.ID)
		}
		if model.InputCostPerMillion < 0 || model.OutputCostPerMillion < 0 ||
			math.IsNaN(model.InputCostPerMillion) || math.IsNaN(model.OutputCostPerMillion) ||
			math.IsInf(model.InputCostPerMillion, 0) || math.IsInf(model.OutputCostPerMillion, 0) {
			return nil, fmt.Errorf("AI model %q has invalid token cost", model.ID)
		}
		if model.Endpoint != "" {
			endpoint, err := url.Parse(model.Endpoint)
			if err != nil || (endpoint.Scheme != "https" && endpoint.Scheme != "http") ||
				endpoint.Host == "" || endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" {
				return nil, fmt.Errorf("AI model %q has an invalid endpoint", model.ID)
			}
			if endpoint.Scheme == "http" && !isLoopbackHost(endpoint.Hostname()) {
				return nil, fmt.Errorf("AI model %q must use HTTPS for non-local endpoints", model.ID)
			}
		}
		registered[model.ID] = model
	}

	for _, modelID := range []string{
		routing.PrimaryModel,
		routing.FastModel,
		routing.ReasoningModel,
		routing.BackupModel,
	} {
		if modelID != "" {
			if _, exists := registered[modelID]; !exists {
				return nil, fmt.Errorf("routing references unknown AI model %q", modelID)
			}
		}
	}

	return &Router{
		models:    registered,
		providers: providers,
		routing:   routing,
		observer:  observer,
		breakers:  make(map[string]*circuitBreaker),
		now:       time.Now,
	}, nil
}

func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (router *Router) Generate(ctx context.Context, request Request) (Response, error) {
	if err := validateRequest(request); err != nil {
		return Response{}, err
	}
	if request.Task == "" || request.Complexity == "" {
		inferredTask, inferredComplexity := InferTaskAndComplexity(request.Messages)
		if request.Task == "" {
			request.Task = inferredTask
		}
		if request.Complexity == "" {
			request.Complexity = inferredComplexity
		}
	}

	candidates := router.candidates(request)
	var lastErr error
	for _, modelID := range candidates {
		result, err := router.generateWithModel(ctx, modelID, request)
		if err == nil {
			return result, nil
		}
		lastErr = err
		if !retryable(err) && !errors.Is(err, ErrCircuitOpen) {
			return Response{}, err
		}
	}

	if lastErr == nil {
		lastErr = ErrCircuitOpen
	}
	return Response{}, lastErr
}

// GenerateWithModel bypasses task routing for explicit tests and evaluations.
func (router *Router) GenerateWithModel(ctx context.Context, modelID string, request Request) (Response, error) {
	if err := validateRequest(request); err != nil {
		return Response{}, err
	}
	if request.Task == "" || request.Complexity == "" {
		inferredTask, inferredComplexity := InferTaskAndComplexity(request.Messages)
		if request.Task == "" {
			request.Task = inferredTask
		}
		if request.Complexity == "" {
			request.Complexity = inferredComplexity
		}
	}
	if _, exists := router.models[modelID]; !exists {
		return Response{}, fmt.Errorf("unknown AI model %q", modelID)
	}
	return router.generateWithModel(ctx, modelID, request)
}

func (router *Router) generateWithModel(ctx context.Context, modelID string, request Request) (Response, error) {
	model := router.models[modelID]
	breaker := router.breaker(modelID)
	var lastErr error
	for attempt := 0; attempt <= model.Retries; attempt++ {
		if !breaker.allow(router.now()) {
			return Response{}, ErrCircuitOpen
		}

		timeout := defaultModelTimeout
		if model.TimeoutMillis > 0 {
			timeout = time.Duration(model.TimeoutMillis) * time.Millisecond
		}
		modelContext, cancel := context.WithTimeout(ctx, timeout)
		started := router.now()
		result, err := router.providers[model.Provider].Generate(modelContext, model, request)
		cancel()
		duration := router.now().Sub(started)

		if err != nil {
			breaker.recordFailure(router.now(), retryable(err))
			router.observe(model, duration, false, classifyError(err), Usage{})
			lastErr = err
			if retryable(err) {
				continue
			}
			return Response{}, err
		}

		breaker.recordSuccess()
		result.Provider = model.Provider
		result.Model = model.Model
		router.observe(model, duration, true, "", result.Usage)
		return result, nil
	}
	return Response{}, lastErr
}

func (router *Router) candidates(request Request) []string {
	preferred := router.routing.PrimaryModel
	switch {
	case request.Task == TaskExtraction && router.routing.FastModel != "":
		preferred = router.routing.FastModel
	case (request.Task == TaskReasoning || request.Complexity == ComplexityComplex) && router.routing.ReasoningModel != "":
		preferred = router.routing.ReasoningModel
	}

	candidates := []string{preferred, router.routing.PrimaryModel, router.routing.BackupModel}
	seen := make(map[string]bool, len(candidates))
	unique := candidates[:0]
	for _, modelID := range candidates {
		if modelID == "" || seen[modelID] {
			continue
		}
		seen[modelID] = true
		unique = append(unique, modelID)
	}
	return unique
}

func (router *Router) breaker(modelID string) *circuitBreaker {
	router.breakerMu.Lock()
	defer router.breakerMu.Unlock()
	if router.breakers[modelID] == nil {
		router.breakers[modelID] = &circuitBreaker{}
	}
	return router.breakers[modelID]
}

func (router *Router) observe(model ModelConfig, duration time.Duration, success bool, errorClass string, usage Usage) {
	if router.observer == nil {
		return
	}
	cost := (float64(usage.InputTokens)*model.InputCostPerMillion +
		float64(usage.OutputTokens)*model.OutputCostPerMillion) / 1_000_000
	router.observer.ObserveAI(Event{
		ModelID:       model.ID,
		Provider:      model.Provider,
		Duration:      duration,
		Success:       success,
		ErrorClass:    errorClass,
		Usage:         usage,
		EstimatedCost: cost,
	})
}

func classifyError(err error) string {
	var providerErr *ProviderError
	if errors.As(err, &providerErr) {
		switch {
		case providerErr.Status == 429:
			return "rate_limited"
		case providerErr.Status >= 500:
			return "provider_unavailable"
		case providerErr.Status != 0:
			return "provider_rejected"
		}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	return "provider_error"
}

func validateRequest(request Request) error {
	if len(request.Messages) == 0 {
		return errors.New("at least one AI message is required")
	}
	if len(request.Messages) > 50 {
		return errors.New("AI request exceeds the message limit")
	}
	totalCharacters := 0
	for _, message := range request.Messages {
		switch message.Role {
		case RoleSystem, RoleUser, RoleAssistant:
		default:
			return fmt.Errorf("unsupported AI message role %q", message.Role)
		}
		if !utf8.ValidString(message.Content) || strings.TrimSpace(message.Content) == "" {
			return errors.New("AI message content must not be empty or invalid UTF-8")
		}
		totalCharacters += utf8.RuneCountInString(message.Content)
		if totalCharacters > 100_000 {
			return errors.New("AI request exceeds the content size limit")
		}
	}
	if request.Task != "" && request.Task != TaskConversation && request.Task != TaskReasoning && request.Task != TaskExtraction {
		return fmt.Errorf("unsupported AI task %q", request.Task)
	}
	if request.Complexity != "" && request.Complexity != ComplexitySimple && request.Complexity != ComplexityNormal && request.Complexity != ComplexityComplex {
		return fmt.Errorf("unsupported AI complexity %q", request.Complexity)
	}
	return nil
}

// InferTaskAndComplexity provides a conservative default; callers can supply
// explicit task metadata after applying PADI's own intent and safety rules.
func InferTaskAndComplexity(messages []Message) (Task, Complexity) {
	var latest string
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == RoleUser {
			latest = strings.ToLower(messages[i].Content)
			break
		}
	}

	task := TaskConversation
	for _, keyword := range []string{"extract ", "classify ", "summarize ", "translate "} {
		if strings.Contains(latest, keyword) {
			task = TaskExtraction
			break
		}
	}

	complexity := ComplexityNormal
	if utf8.RuneCountInString(latest) < 80 {
		complexity = ComplexitySimple
	}
	if utf8.RuneCountInString(latest) > 800 || strings.Contains(latest, "compare ") ||
		strings.Contains(latest, "step by step") || strings.Contains(latest, "analyze ") ||
		strings.Contains(latest, "analyse ") || strings.Contains(latest, "multi-step") {
		complexity = ComplexityComplex
	}
	return task, complexity
}
