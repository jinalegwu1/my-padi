package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
)

const maxProviderResponseBytes = 2 << 20

// NewProviderAdapters returns the provider-specific adapters supported by PADI.
func NewProviderAdapters(client *http.Client) map[string]Provider {
	if client == nil {
		client = &http.Client{Timeout: maxModelTimeout}
	}
	return map[string]Provider{
		ProviderOpenAI:           openAIProvider{client: client},
		ProviderAnthropic:        anthropicProvider{client: client},
		ProviderGemini:           geminiProvider{client: client},
		ProviderOpenAICompatible: openAICompatibleProvider{client: client},
		ProviderOpenRouter:       openRouterProvider{client: client},
		ProviderGroq:             groqProvider{client: client},
		ProviderZAI:              zaiProvider{client: client},
		ProviderMistral:          mistralProvider{client: client},
	}
}

func postJSON(
	ctx context.Context,
	client *http.Client,
	providerName, endpoint, secret, header, prefix string,
	payload, output any,
	extraHeaders ...func(*http.Request),
) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return &ProviderError{Provider: providerName, Err: errors.New("could not encode provider request")}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(encoded))
	if err != nil {
		return &ProviderError{Provider: providerName, Err: errors.New("could not create provider request")}
	}
	req.Header.Set("Content-Type", "application/json")
	if header != "" {
		req.Header.Set(header, prefix+secret)
	}
	for _, setHeader := range extraHeaders {
		setHeader(req)
	}

	response, err := client.Do(req)
	if err != nil {
		retryable := !errors.Is(err, context.Canceled)
		return &ProviderError{Provider: providerName, Retryable: retryable, Err: err}
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return &ProviderError{
			Provider: providerName,
			Status:   response.StatusCode,
			Retryable: response.StatusCode == http.StatusNotFound ||
				response.StatusCode == http.StatusTooManyRequests ||
				response.StatusCode >= http.StatusInternalServerError,
		}
	}
	limited := io.LimitReader(response.Body, maxProviderResponseBytes+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		return &ProviderError{Provider: providerName, Retryable: true, Err: errors.New("could not read provider response")}
	}
	if len(body) > maxProviderResponseBytes {
		return &ProviderError{Provider: providerName, Err: errors.New("provider response exceeded size limit")}
	}
	if err := json.Unmarshal(body, output); err != nil {
		return &ProviderError{Provider: providerName, Err: errors.New("provider returned malformed JSON")}
	}
	return nil
}

func apiKey(model ModelConfig) (string, error) {
	if model.APIKeyEnv == "" {
		return "", &ProviderError{Provider: model.Provider, Err: errors.New("API key environment variable is not configured")}
	}
	secret := strings.TrimSpace(os.Getenv(model.APIKeyEnv))
	if secret == "" {
		return "", &ProviderError{Provider: model.Provider, Err: errors.New("API key is not configured")}
	}
	return secret, nil
}

type openAIChatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
	} `json:"usage"`
}

func configuredMaxOutputTokens(request Request) int {
	if request.MaxOutputTokens > 0 {
		return request.MaxOutputTokens
	}
	return defaultMaxOutputTokens
}

func generateOpenAICompatible(
	ctx context.Context,
	client *http.Client,
	model ModelConfig,
	request Request,
	endpoint string,
	extraHeaders ...func(*http.Request),
) (Response, error) {
	return generateOpenAICompatibleWithOptions(ctx, client, model, request, endpoint, false, extraHeaders...)
}

func generateOpenAICompatibleWithOptions(
	ctx context.Context,
	client *http.Client,
	model ModelConfig,
	request Request,
	endpoint string,
	disableReasoning bool,
	extraHeaders ...func(*http.Request),
) (Response, error) {
	apiKey, err := apiKey(model)
	if err != nil {
		return Response{}, err
	}
	if endpoint == "" {
		return Response{}, &ProviderError{Provider: model.Provider, Err: errors.New("endpoint is required")}
	}

	payload := struct {
		Model          string    `json:"model"`
		Messages       []Message `json:"messages"`
		MaxTokens      int       `json:"max_tokens"`
		ResponseFormat *struct {
			Type string `json:"type"`
		} `json:"response_format,omitempty"`
		Reasoning *struct {
			Enabled bool `json:"enabled"`
		} `json:"reasoning,omitempty"`
	}{
		Model:     model.Model,
		Messages:  request.Messages,
		MaxTokens: configuredMaxOutputTokens(request),
	}
	if disableReasoning {
		payload.Reasoning = &struct {
			Enabled bool `json:"enabled"`
		}{Enabled: false}
	}
	if request.StructuredOutput {
		payload.ResponseFormat = &struct {
			Type string `json:"type"`
		}{Type: "json_object"}
	}
	var result openAIChatResponse
	if err := postJSON(
		ctx, client, model.Provider, endpoint, apiKey, "Authorization", "Bearer ", payload, &result, extraHeaders...,
	); err != nil {
		return Response{}, err
	}
	if len(result.Choices) == 0 {
		return Response{}, &ProviderError{Provider: model.Provider, Retryable: true, Err: ErrEmptyProviderResponse}
	}
	return completedOpenAIResponse(model.Provider, result)
}

func completedOpenAIResponse(provider string, result openAIChatResponse) (Response, error) {
	if len(result.Choices) == 0 {
		return Response{}, &ProviderError{Provider: provider, Retryable: true, Err: ErrEmptyProviderResponse}
	}
	response := Response{
		Content:      result.Choices[0].Message.Content,
		FinishReason: result.Choices[0].FinishReason,
		Usage: Usage{
			InputTokens:  result.Usage.PromptTokens,
			OutputTokens: result.Usage.CompletionTokens,
		},
	}
	if err := completionError(provider, response.FinishReason, true); err != nil {
		return response, err
	}
	return response, validateCompleteText(provider, response.Content)
}
