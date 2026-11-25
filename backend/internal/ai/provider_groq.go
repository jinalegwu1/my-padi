package ai

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

const ProviderGroq = "groq"

type groqProvider struct {
	client *http.Client
}

func (provider groqProvider) Generate(ctx context.Context, model ModelConfig, request Request) (Response, error) {
	endpoint := model.Endpoint
	if endpoint == "" {
		endpoint = "https://api.groq.com/openai/v1/chat/completions"
	}
	return generateOpenAICompatible(ctx, provider.client, model, request, endpoint)
}

func (provider groqProvider) Stream(ctx context.Context, model ModelConfig, request Request, onDelta func(string) error) (Response, error) {
	apiKey, err := apiKey(model)
	if err != nil {
		return Response{}, err
	}
	endpoint := model.Endpoint
	if endpoint == "" {
		endpoint = "https://api.groq.com/openai/v1/chat/completions"
	}
	payload := struct {
		Model         string    `json:"model"`
		Messages      []Message `json:"messages"`
		MaxTokens     int       `json:"max_tokens"`
		Stream        bool      `json:"stream"`
		StreamOptions struct {
			IncludeUsage bool `json:"include_usage"`
		} `json:"stream_options"`
	}{
		Model:     model.Model,
		Messages:  request.Messages,
		MaxTokens: configuredMaxOutputTokens(request),
		Stream:    true,
	}
	payload.StreamOptions.IncludeUsage = true
	encoded, err := json.Marshal(payload)
	if err != nil {
		return Response{}, &ProviderError{Provider: ProviderGroq, Err: errors.New("could not encode provider request")}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(string(encoded)))
	if err != nil {
		return Response{}, &ProviderError{Provider: ProviderGroq, Err: errors.New("could not create provider request")}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	client := provider.client
	if client == nil {
		client = http.DefaultClient
	}
	response, err := client.Do(req)
	if err != nil {
		return Response{}, &ProviderError{Provider: ProviderGroq, Retryable: !errors.Is(err, context.Canceled), Err: err}
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return Response{}, &ProviderError{
			Provider: ProviderGroq, Status: response.StatusCode,
			Retryable: response.StatusCode == http.StatusNotFound ||
				response.StatusCode == http.StatusTooManyRequests || response.StatusCode >= http.StatusInternalServerError,
		}
	}

	type streamChunk struct {
		Choices []struct {
			Delta struct {
				Content string `json:"content"`
			} `json:"delta"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
		Usage *struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
		} `json:"usage"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	var result Response
	streamEnded := false
	scanner := bufio.NewScanner(io.LimitReader(response.Body, maxProviderResponseBytes+1))
	scanner.Buffer(make([]byte, 4096), maxProviderResponseBytes)
	total := 0
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			streamEnded = true
			break
		}
		var chunk streamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			return Response{}, &ProviderError{Provider: ProviderGroq, Err: errors.New("provider returned malformed streaming data")}
		}
		if chunk.Error != nil {
			return Response{}, &ProviderError{Provider: ProviderGroq, Err: errors.New("provider returned a streaming error")}
		}
		if chunk.Usage != nil {
			result.Usage = Usage{InputTokens: chunk.Usage.PromptTokens, OutputTokens: chunk.Usage.CompletionTokens}
		}
		if len(chunk.Choices) == 0 {
			continue
		}
		if reason := chunk.Choices[0].FinishReason; reason != "" {
			result.FinishReason = reason
		}
		if chunk.Choices[0].Delta.Content == "" {
			continue
		}
		delta := chunk.Choices[0].Delta.Content
		total += len(delta)
		if total > maxProviderResponseBytes {
			return Response{}, &ProviderError{Provider: ProviderGroq, Err: errors.New("provider response exceeded size limit")}
		}
		result.Content += delta
		if onDelta != nil {
			if err := onDelta(delta); err != nil {
				return Response{}, fmt.Errorf("deliver streamed response: %w", err)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return Response{}, &ProviderError{Provider: ProviderGroq, Retryable: true, Err: errors.New("could not read provider stream")}
	}
	if err := completionError(ProviderGroq, result.FinishReason, streamEnded); err != nil {
		return result, err
	}
	return result, validateCompleteText(ProviderGroq, result.Content)
}
