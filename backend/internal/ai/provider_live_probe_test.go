package ai_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jinalegwu1/my-padi/backend/internal/ai"
	"github.com/jinalegwu1/my-padi/backend/internal/verification"
)

const liveProbePrompt = "This is a synthetic routing check. Reply with a short greeting. Do not include personal information."

type liveProbeLimiter struct{}

func (liveProbeLimiter) Reserve(context.Context, string, int, ai.UsageLimits, time.Time) error {
	return nil
}

func (liveProbeLimiter) RecordUsage(context.Context, string, ai.Usage, time.Time) error {
	return nil
}

type controlledGroqFailure struct{}

func (controlledGroqFailure) Generate(context.Context, ai.ModelConfig, ai.Request) (ai.Response, error) {
	return ai.Response{}, &ai.ProviderError{
		Provider: ai.ProviderGroq, Status: http.StatusServiceUnavailable, Retryable: true,
		Err: errors.New("controlled live-test failure"),
	}
}

type controlledProviderFailure struct {
	provider string
}

func (failure controlledProviderFailure) Generate(context.Context, ai.ModelConfig, ai.Request) (ai.Response, error) {
	return ai.Response{}, &ai.ProviderError{
		Provider: failure.provider, Status: http.StatusServiceUnavailable, Retryable: true,
		Err: errors.New("controlled live-test failure"),
	}
}

func TestLiveGroqOpenRouterZAIChainAndStreaming(t *testing.T) {
	if os.Getenv("PADI_RUN_LIVE_PROVIDER_TESTS") != "true" {
		t.Skip("set PADI_RUN_LIVE_PROVIDER_TESTS=true to make real provider requests")
	}
	if err := verification.LoadEnvFile("../../.env"); err != nil {
		t.Fatalf("load local provider configuration: %v", err)
	}
	configuration, err := ai.LoadEnvironment()
	if err != nil {
		t.Fatalf("load configured AI models: %v", err)
	}

	models := make(map[string]ai.ModelConfig, len(configuration.Models))
	for _, model := range configuration.Models {
		models[model.ID] = model
	}
	groq, groqOK := models["groq-fast"]
	openrouter, openRouterOK := models["openrouter-backup"]
	zai, zaiOK := models["zai-reasoning"]
	if !groqOK || groq.Provider != ai.ProviderGroq || groq.Model != "openai/gpt-oss-20b" {
		t.Fatalf("configured Groq model must be openai/gpt-oss-20b")
	}
	if !openRouterOK || openrouter.Provider != ai.ProviderOpenRouter ||
		openrouter.Model != "nvidia/nemotron-3.5-lightning:free" {
		t.Fatalf("configured OpenRouter model must be nvidia/nemotron-3.5-lightning:free")
	}
	if !zaiOK || zai.Provider != ai.ProviderZAI || zai.Model != ai.ZAIFlashModel {
		t.Fatalf("configured Z.ai model must be %s", ai.ZAIFlashModel)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	client := &http.Client{Timeout: 90 * time.Second}
	adapters := ai.NewProviderAdapters(client)
	request := ai.Request{
		Messages:        []ai.Message{{Role: ai.RoleUser, Content: liveProbePrompt}},
		Task:            ai.TaskConversation,
		Complexity:      ai.ComplexitySimple,
		MaxOutputTokens: 96,
	}

	for _, item := range []struct {
		provider string
		model    ai.ModelConfig
	}{
		{provider: ai.ProviderGroq, model: groq},
		{provider: ai.ProviderOpenRouter, model: openrouter},
		{provider: ai.ProviderZAI, model: zai},
	} {
		started := time.Now()
		response, callErr := adapters[item.provider].Generate(ctx, item.model, request)
		result := map[string]any{
			"kind": "generation", "provider": item.provider, "model": item.model.Model,
			"latency_ms": time.Since(started).Milliseconds(), "usage": response.Usage,
			"response": response.Content,
		}
		if callErr != nil {
			result["error"] = liveProbeError(callErr)
			t.Errorf("%s live generation failed: %v", item.provider, callErr)
		}
		logLiveProbe(t, result)
	}

	fallbackProviders := ai.NewProviderAdapters(client)
	fallbackProviders[ai.ProviderGroq] = controlledGroqFailure{}
	var attempts []ai.Event
	router, err := ai.NewRouterWithUsageLimiter(
		configuration.Models, fallbackProviders, configuration.Routing,
		ai.ObserverFunc(func(event ai.Event) { attempts = append(attempts, event) }),
		liveProbeLimiter{},
	)
	if err != nil {
		t.Fatalf("create router with a controlled Groq failure: %v", err)
	}
	started := time.Now()
	fallback, fallbackErr := router.Generate(ctx, request)
	fallbackResult := map[string]any{
		"kind": "controlled_fallback", "injected_failure": "groq HTTP 503 retryable",
		"provider": fallback.Provider, "model": fallback.Model,
		"latency_ms": time.Since(started).Milliseconds(), "usage": fallback.Usage,
		"response": fallback.Content,
	}
	if fallbackErr != nil {
		fallbackResult["error"] = liveProbeError(fallbackErr)
		t.Errorf("OpenRouter fallback generation failed: %v", fallbackErr)
	}
	fallbackResult["attempts"] = summarizeAttempts(attempts)
	if fallbackErr == nil && (fallback.Provider != ai.ProviderOpenRouter || fallback.Model != openrouter.Model) {
		t.Errorf("fallback used %s:%s, want openrouter:%s", fallback.Provider, fallback.Model, openrouter.Model)
	}
	logLiveProbe(t, fallbackResult)

	zaiFallbackProviders := ai.NewProviderAdapters(client)
	zaiFallbackProviders[ai.ProviderGroq] = controlledProviderFailure{provider: ai.ProviderGroq}
	zaiFallbackProviders[ai.ProviderOpenRouter] = controlledProviderFailure{provider: ai.ProviderOpenRouter}
	zaiFallbackConfiguration := configuration
	zaiFallbackConfiguration.Models = append([]ai.ModelConfig(nil), configuration.Models...)
	for index := range zaiFallbackConfiguration.Models {
		if zaiFallbackConfiguration.Models[index].Provider == ai.ProviderGroq ||
			zaiFallbackConfiguration.Models[index].Provider == ai.ProviderOpenRouter {
			zaiFallbackConfiguration.Models[index].Retries = 0
		}
	}
	attempts = nil
	zaiRouter, err := ai.NewRouterWithUsageLimiter(
		zaiFallbackConfiguration.Models, zaiFallbackProviders, zaiFallbackConfiguration.Routing,
		ai.ObserverFunc(func(event ai.Event) { attempts = append(attempts, event) }),
		liveProbeLimiter{},
	)
	if err != nil {
		t.Fatalf("create router with controlled Groq and OpenRouter failures: %v", err)
	}
	started = time.Now()
	zaiFallback, zaiFallbackErr := zaiRouter.Generate(ctx, request)
	zaiFallbackResult := map[string]any{
		"kind":              "controlled_third_provider_fallback",
		"injected_failures": []string{"groq HTTP 503 retryable", "openrouter HTTP 503 retryable"},
		"provider":          zaiFallback.Provider, "model": zaiFallback.Model,
		"latency_ms": time.Since(started).Milliseconds(), "usage": zaiFallback.Usage,
		"response": zaiFallback.Content,
	}
	if zaiFallbackErr != nil {
		zaiFallbackResult["error"] = liveProbeError(zaiFallbackErr)
		t.Errorf("Z.ai third-provider fallback failed: %v", zaiFallbackErr)
	}
	zaiFallbackResult["attempts"] = summarizeAttempts(attempts)
	if zaiFallbackErr == nil && (zaiFallback.Provider != ai.ProviderZAI || zaiFallback.Model != zai.Model) {
		t.Errorf("third fallback used %s:%s, want zai:%s", zaiFallback.Provider, zaiFallback.Model, zai.Model)
	}
	logLiveProbe(t, zaiFallbackResult)

	groqStream, ok := adapters[ai.ProviderGroq].(ai.StreamingProvider)
	if !ok {
		t.Fatal("configured Groq adapter does not implement streaming")
	}
	streamRequest := request
	streamRequest.MaxOutputTokens = 1024
	started = time.Now()
	var firstGroqDelta time.Duration
	groqResponse, groqStreamErr := groqStream.Stream(ctx, groq, streamRequest, func(delta string) error {
		if firstGroqDelta == 0 && delta != "" {
			firstGroqDelta = time.Since(started)
		}
		return nil
	})
	groqStreamResult := map[string]any{
		"kind": "provider_api_stream", "provider": ai.ProviderGroq, "model": groq.Model,
		"latency_ms": time.Since(started).Milliseconds(), "first_delta_ms": firstGroqDelta.Milliseconds(),
		"usage": groqResponse.Usage, "response": groqResponse.Content,
	}
	if groqStreamErr != nil {
		groqStreamResult["error"] = liveProbeError(groqStreamErr)
		t.Errorf("Groq streaming failed: %v", groqStreamErr)
	}
	logLiveProbe(t, groqStreamResult)

	openRouterStream, streamLatency, streamErr := streamOpenRouter(ctx, client, openrouter, streamRequest)
	openRouterStreamResult := map[string]any{
		"kind": "provider_api_stream", "provider": ai.ProviderOpenRouter, "model": openrouter.Model,
		"latency_ms": streamLatency.Milliseconds(), "response": openRouterStream,
	}
	if streamErr != nil {
		openRouterStreamResult["error"] = liveProbeError(streamErr)
		t.Errorf("OpenRouter streaming failed: %v", streamErr)
	}
	logLiveProbe(t, openRouterStreamResult)
}

func streamOpenRouter(
	ctx context.Context,
	client *http.Client,
	model ai.ModelConfig,
	request ai.Request,
) (string, time.Duration, error) {
	key := strings.TrimSpace(os.Getenv(model.APIKeyEnv))
	if key == "" {
		return "", 0, errors.New("OpenRouter API key is not configured")
	}
	payload := struct {
		Model    string       `json:"model"`
		Messages []ai.Message `json:"messages"`
		MaxToken int          `json:"max_tokens"`
		Stream   bool         `json:"stream"`
	}{
		Model: model.Model, Messages: request.Messages, MaxToken: request.MaxOutputTokens, Stream: true,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", 0, errors.New("could not encode OpenRouter stream request")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://openrouter.ai/api/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", 0, errors.New("could not create OpenRouter stream request")
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	started := time.Now()
	response, err := client.Do(req)
	if err != nil {
		return "", time.Since(started), err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return "", time.Since(started), fmt.Errorf("OpenRouter streaming returned HTTP %d", response.StatusCode)
	}
	type chunk struct {
		Choices []struct {
			Delta struct {
				Content string `json:"content"`
			} `json:"delta"`
		} `json:"choices"`
	}
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 4096), 1<<20)
	var content strings.Builder
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			break
		}
		var current chunk
		if err := json.Unmarshal([]byte(data), &current); err != nil {
			return content.String(), time.Since(started), errors.New("OpenRouter returned malformed stream data")
		}
		for _, choice := range current.Choices {
			content.WriteString(choice.Delta.Content)
		}
	}
	if err := scanner.Err(); err != nil {
		return content.String(), time.Since(started), errors.New("could not read OpenRouter stream")
	}
	if strings.TrimSpace(content.String()) == "" {
		return "", time.Since(started), errors.New("OpenRouter stream returned no text")
	}
	return content.String(), time.Since(started), nil
}

func liveProbeError(err error) string {
	var providerErr *ai.ProviderError
	if errors.As(err, &providerErr) {
		return fmt.Sprintf("provider=%s status=%d retryable=%t error=%v",
			providerErr.Provider, providerErr.Status, providerErr.Retryable, providerErr.Err)
	}
	return err.Error()
}

func summarizeAttempts(events []ai.Event) []map[string]any {
	result := make([]map[string]any, 0, len(events))
	for _, event := range events {
		result = append(result, map[string]any{
			"provider": event.Provider, "model_id": event.ModelID,
			"success": event.Success, "latency_ms": event.Duration.Milliseconds(),
			"error_class": event.ErrorClass,
		})
	}
	return result
}

func logLiveProbe(t *testing.T, result map[string]any) {
	t.Helper()
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("encode live probe evidence: %v", err)
	}
	t.Log(string(encoded))
}
