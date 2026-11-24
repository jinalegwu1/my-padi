package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	defaultModelTimeout    = 20 * time.Second
	maxModelTimeout        = 2 * time.Minute
	defaultMaxOutputTokens = 1024
	maxOutputTokens        = 4096
	circuitFailureLimit    = 3
	circuitOpenDuration    = 30 * time.Second
)

type Router struct {
	models        map[string]ModelConfig
	providers     map[string]Provider
	routing       RoutingConfig
	observer      Observer
	limiter       UsageLimiter
	breakers      map[string]*circuitBreaker
	breakerMu     sync.Mutex
	now           func() time.Time
	disableLimits bool
}

func containsModel(models []string, model string) bool {
	for _, candidate := range models {
		if candidate == model {
			return true
		}
	}
	return false
}

func NewRouter(models []ModelConfig, providers map[string]Provider, routing RoutingConfig, observer Observer) (*Router, error) {
	return newRouter(models, providers, routing, observer, nil)
}

func NewRouterWithUsageLimiter(models []ModelConfig, providers map[string]Provider, routing RoutingConfig, observer Observer, limiter UsageLimiter) (*Router, error) {
	if limiter == nil {
		return nil, errors.New("persistent AI usage limiter is required")
	}
	return newRouter(models, providers, routing, observer, limiter)
}

func newRouter(models []ModelConfig, providers map[string]Provider, routing RoutingConfig, observer Observer, limiter UsageLimiter) (*Router, error) {
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
		approvedIdentity := model.Provider + ":" + model.Model
		if !containsModel(routing.ApprovedFreeModels, approvedIdentity) {
			return nil, fmt.Errorf("AI model %q (%s) is not in PADI_AI_APPROVED_FREE_MODELS", model.ID, approvedIdentity)
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

	configuredModels := make(map[string]struct{}, len(registered))
	for _, model := range registered {
		configuredModels[model.Provider+":"+model.Model] = struct{}{}
	}
	for _, identity := range routing.ApprovedFreeModels {
		if _, exists := configuredModels[identity]; !exists {
			return nil, fmt.Errorf("approved free-model entry %q is not configured", identity)
		}
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
		models:        registered,
		providers:     providers,
		routing:       routing,
		observer:      observer,
		limiter:       limiter,
		breakers:      make(map[string]*circuitBreaker),
		now:           time.Now,
		disableLimits: os.Getenv("PADI_DISABLE_ALL_LIMITS") == "true",
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
	request = withPADIInstructions(request)
	if request.MaxOutputTokens == 0 {
		request.MaxOutputTokens = defaultMaxOutputTokens
	}

	candidates := router.candidates(request)
	var lastErr error
	for _, modelID := range candidates {
		result, err := router.generateWithModel(ctx, modelID, request)
		if err == nil {
			return result, nil
		}
		lastErr = err
		if !retryable(err) && !errors.Is(err, ErrCircuitOpen) && !errors.Is(err, ErrUsageLimitReached) {
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
	request = withPADIInstructions(request)
	if request.MaxOutputTokens == 0 {
		request.MaxOutputTokens = defaultMaxOutputTokens
	}
	if _, exists := router.models[modelID]; !exists {
		return Response{}, fmt.Errorf("unknown AI model %q", modelID)
	}
	return router.generateWithModel(ctx, modelID, request)
}

// SupportsGroqVoiceStreaming reports whether the configured fast model is the
// agreed Groq conversation model and has a streaming adapter.
func (router *Router) SupportsGroqVoiceStreaming() bool {
	model, exists := router.models[router.routing.FastModel]
	if !exists || model.Provider != ProviderGroq || model.Model != "openai/gpt-oss-20b" ||
		(model.Endpoint != "" && model.Endpoint != "https://api.groq.com/openai/v1/chat/completions") {
		return false
	}
	_, ok := router.providers[ProviderGroq].(StreamingProvider)
	return ok
}

// StreamVoice always uses the configured Groq fast model; it does not enter
// normal chat routing or fall back to another provider.
func (router *Router) StreamVoice(ctx context.Context, request Request, onDelta func(string) error) (Response, error) {
	if !router.SupportsGroqVoiceStreaming() {
		return Response{}, errors.New("the configured Groq voice model is unavailable")
	}
	if err := validateRequest(request); err != nil {
		return Response{}, err
	}
	request.Voice = true
	if request.Task == "" || request.Complexity == "" {
		inferredTask, inferredComplexity := InferTaskAndComplexity(request.Messages)
		if request.Task == "" {
			request.Task = inferredTask
		}
		if request.Complexity == "" {
			request.Complexity = inferredComplexity
		}
	}
	request = withPADIInstructions(request)
	if request.MaxOutputTokens == 0 {
		request.MaxOutputTokens = defaultMaxOutputTokens
	}

	modelID := router.routing.FastModel
	model := router.models[modelID]
	if router.limiter == nil {
		return Response{}, ErrUsageLimiterUnavailable
	}
	if !router.disableLimits && !router.breaker(modelID).allow(router.now()) {
		return Response{}, ErrCircuitOpen
	}
	reservedAt := router.now()
	if err := router.limiter.Reserve(ctx, model.Provider, estimateTokenUnits(request)+request.MaxOutputTokens, FreeUsageLimits(), reservedAt); err != nil {
		return Response{}, err
	}
	timeout := defaultModelTimeout
	if model.TimeoutMillis > 0 {
		timeout = time.Duration(model.TimeoutMillis) * time.Millisecond
	}
	modelContext, cancel := context.WithTimeout(ctx, timeout)
	started := router.now()
	result, err := router.providers[ProviderGroq].(StreamingProvider).Stream(modelContext, model, request, onDelta)
	cancel()
	duration := router.now().Sub(started)
	if err == nil && (result.Usage.InputTokens < 0 || result.Usage.OutputTokens < 0) {
		err = &ProviderError{Provider: ProviderGroq, Err: ErrInvalidProviderUsage}
	}
	if err == nil && strings.TrimSpace(result.Content) == "" {
		err = &ProviderError{Provider: ProviderGroq, Retryable: true, Err: ErrEmptyProviderResponse}
	}
	if err != nil {
		if !router.disableLimits {
			router.breaker(modelID).recordFailure(router.now(), retryable(err))
		}
		router.observe(model, duration, false, classifyError(err), Usage{})
		return Response{}, err
	}
	if err := router.limiter.RecordUsage(ctx, model.Provider, result.Usage, reservedAt); err != nil {
		router.observe(model, duration, false, "usage_ledger_error", result.Usage)
		return Response{}, fmt.Errorf("record AI provider usage: %w", err)
	}
	router.breaker(modelID).recordSuccess()
	result.Provider, result.Model = model.Provider, model.Model
	router.observe(model, duration, true, "", result.Usage)
	return result, nil
}

func (router *Router) generateWithModel(ctx context.Context, modelID string, request Request) (Response, error) {
	model := router.models[modelID]
	if router.limiter == nil {
		return Response{}, ErrUsageLimiterUnavailable
	}
	reservedTokens := estimateTokenUnits(request) + request.MaxOutputTokens
	breaker := router.breaker(modelID)
	var lastErr error
	for attempt := 0; attempt <= model.Retries; attempt++ {
		if !router.disableLimits && !breaker.allow(router.now()) {
			return Response{}, ErrCircuitOpen
		}
		reservedAt := router.now()
		if err := router.limiter.Reserve(ctx, model.Provider, reservedTokens, FreeUsageLimits(), reservedAt); err != nil {
			return Response{}, err
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
		if err == nil && (result.Usage.InputTokens < 0 || result.Usage.OutputTokens < 0) {
			err = &ProviderError{Provider: model.Provider, Err: ErrInvalidProviderUsage}
		}
		if err == nil && strings.TrimSpace(result.Content) == "" {
			err = &ProviderError{Provider: model.Provider, Retryable: true, Err: ErrEmptyProviderResponse}
		}
		if err == nil && request.StructuredOutput && !json.Valid([]byte(result.Content)) {
			err = &ProviderError{
				Provider:  model.Provider,
				Retryable: true,
				Err:       errors.New("provider returned invalid structured output"),
			}
		}

		if err != nil {
			if !router.disableLimits {
				breaker.recordFailure(router.now(), retryable(err))
			}
			router.observe(model, duration, false, classifyError(err), Usage{})
			lastErr = err
			if retryable(err) && !shouldFallbackImmediately(err) &&
				!(request.Voice && shouldVoiceFallbackImmediately(err)) {
				continue
			}
			return Response{}, err
		}

		breaker.recordSuccess()
		if err := router.limiter.RecordUsage(ctx, model.Provider, result.Usage, reservedAt); err != nil {
			router.observe(model, duration, false, "usage_ledger_error", result.Usage)
			return Response{}, fmt.Errorf("record AI provider usage: %w", err)
		}
		result.Provider = model.Provider
		result.Model = model.Model
		router.observe(model, duration, true, "", result.Usage)
		return result, nil
	}
	return Response{}, lastErr
}

func shouldFallbackImmediately(err error) bool {
	if errors.Is(err, ErrEmptyProviderResponse) {
		return true
	}
	var providerErr *ProviderError
	return errors.As(err, &providerErr) &&
		(providerErr.Status == 404 || providerErr.Status == 429)
}

func shouldVoiceFallbackImmediately(err error) bool {
	var providerErr *ProviderError
	return errors.As(err, &providerErr) &&
		(providerErr.Status == 408 || providerErr.Status == 429 ||
			providerErr.Status == 503 || providerErr.Status == 504)
}

func estimateTokenUnits(request Request) int {
	total := 0
	for _, message := range request.Messages {
		total += len(message.Content)
	}
	return total
}

func isReasoningTask(task Task) bool {
	switch task {
	case TaskReasoning, TaskPlanning, TaskTechnical, TaskDecision, TaskAnalysis, TaskLearning, TaskQualityReview:
		return true
	default:
		return false
	}
}

func isFastTask(task Task) bool {
	switch task {
	case TaskExtraction, TaskClassification, TaskSummarization, TaskTextProcessing:
		return true
	default:
		return false
	}
}

func (router *Router) candidates(request Request) []string {
	if request.Voice {
		candidates := []string{
			router.routing.PrimaryModel,
			router.routing.FastModel,
		}
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

	preferred := router.routing.PrimaryModel
	switch {
	case isReasoningTask(request.Task) && router.routing.ReasoningModel != "":
		preferred = router.routing.ReasoningModel
	case isFastTask(request.Task) && router.routing.FastModel != "":
		preferred = router.routing.FastModel
	case request.Complexity == ComplexityComplex && router.routing.ReasoningModel != "":
		preferred = router.routing.ReasoningModel
	case request.Task == TaskConversation && request.Complexity == ComplexitySimple &&
		router.routing.FastModel != "":
		preferred = router.routing.FastModel
	}

	candidates := []string{
		preferred,
		router.routing.PrimaryModel,
		router.routing.BackupModel,
		router.routing.FastModel,
		router.routing.ReasoningModel,
	}
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
	if errors.Is(err, ErrEmptyProviderResponse) {
		return "empty_provider_response"
	}
	var providerErr *ProviderError
	if errors.As(err, &providerErr) {
		switch {
		case providerErr.Status == 404:
			return "model_unavailable"
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
	if request.Task != "" && request.Task != TaskConversation && request.Task != TaskReasoning &&
		request.Task != TaskExtraction && request.Task != TaskClassification &&
		request.Task != TaskSummarization && request.Task != TaskTextProcessing &&
		request.Task != TaskPlanning && request.Task != TaskTechnical &&
		request.Task != TaskDecision && request.Task != TaskAnalysis &&
		request.Task != TaskLearning && request.Task != TaskQualityReview {
		return fmt.Errorf("unsupported AI task %q", request.Task)
	}
	if request.Complexity != "" && request.Complexity != ComplexitySimple && request.Complexity != ComplexityNormal && request.Complexity != ComplexityComplex {
		return fmt.Errorf("unsupported AI complexity %q", request.Complexity)
	}
	if request.MaxOutputTokens < 0 || request.MaxOutputTokens > maxOutputTokens {
		return fmt.Errorf("max_output_tokens must be between 0 and %d", maxOutputTokens)
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
