package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
)

const (
	ProviderOpenAI           = "openai"
	ProviderAnthropic        = "anthropic"
	ProviderGemini           = "gemini"
	ProviderOpenAICompatible = "openai-compatible"
	maxProviderResponseBytes = 2 << 20
)

// NewProviderAdapters returns adapters keyed by provider name. Groq and other
// OpenAI-compatible inference APIs can use ProviderOpenAICompatible.
func NewProviderAdapters(client *http.Client) map[string]Provider {
	if client == nil {
		client = &http.Client{Timeout: maxModelTimeout}
	}
	return map[string]Provider{
		ProviderOpenAI:           openAIProvider{client: client},
		ProviderOpenAICompatible: openAIProvider{client: client},
		ProviderAnthropic:        anthropicProvider{client: client},
		ProviderGemini:           geminiProvider{client: client},
	}
}

type openAIProvider struct {
	client *http.Client
}

func (provider openAIProvider) Generate(ctx context.Context, model ModelConfig, request Request) (Response, error) {
	apiKey, err := apiKey(model)
	if err != nil {
		return Response{}, err
	}
	endpoint := model.Endpoint
	if endpoint == "" {
		if model.Provider == ProviderOpenAI {
			endpoint = "https://api.openai.com/v1/chat/completions"
		} else {
			return Response{}, &ProviderError{Provider: model.Provider, Err: errors.New("endpoint is required")}
		}
	}
	payload := struct {
		Model    string    `json:"model"`
		Messages []Message `json:"messages"`
	}{
		Model:    model.Model,
		Messages: request.Messages,
	}
	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
		} `json:"usage"`
	}
	if err := provider.postJSON(ctx, model.Provider, endpoint, apiKey, "Authorization", "Bearer ", payload, &result); err != nil {
		return Response{}, err
	}
	if len(result.Choices) == 0 || strings.TrimSpace(result.Choices[0].Message.Content) == "" {
		return Response{}, &ProviderError{Provider: model.Provider, Err: errors.New("response contained no message")}
	}
	return Response{
		Content: result.Choices[0].Message.Content,
		Usage: Usage{
			InputTokens:  result.Usage.PromptTokens,
			OutputTokens: result.Usage.CompletionTokens,
		},
	}, nil
}

type anthropicProvider struct {
	client *http.Client
}

func (provider anthropicProvider) Generate(ctx context.Context, model ModelConfig, request Request) (Response, error) {
	apiKey, err := apiKey(model)
	if err != nil {
		return Response{}, err
	}
	endpoint := model.Endpoint
	if endpoint == "" {
		endpoint = "https://api.anthropic.com/v1/messages"
	}
	var system string
	messages := make([]Message, 0, len(request.Messages))
	for _, message := range request.Messages {
		if message.Role == RoleSystem {
			system = message.Content
			continue
		}
		messages = append(messages, Message{
			Role:    MessageRole(map[MessageRole]string{RoleUser: "user", RoleAssistant: "assistant"}[message.Role]),
			Content: message.Content,
		})
	}
	payload := struct {
		Model     string    `json:"model"`
		MaxTokens int       `json:"max_tokens"`
		System    string    `json:"system,omitempty"`
		Messages  []Message `json:"messages"`
	}{
		Model:     model.Model,
		MaxTokens: 1024,
		System:    system,
		Messages:  messages,
	}
	var result struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		Usage struct {
			InputTokens  int `json:"input_tokens"`
			OutputTokens int `json:"output_tokens"`
		} `json:"usage"`
	}
	if err := provider.postJSON(ctx, model.Provider, endpoint, apiKey, "x-api-key", "", payload, &result, func(req *http.Request) {
		req.Header.Set("anthropic-version", "2023-06-01")
	}); err != nil {
		return Response{}, err
	}
	var content strings.Builder
	for _, block := range result.Content {
		if block.Type == "text" {
			content.WriteString(block.Text)
		}
	}
	if strings.TrimSpace(content.String()) == "" {
		return Response{}, &ProviderError{Provider: model.Provider, Err: errors.New("response contained no text")}
	}
	return Response{
		Content: content.String(),
		Usage: Usage{
			InputTokens:  result.Usage.InputTokens,
			OutputTokens: result.Usage.OutputTokens,
		},
	}, nil
}

type geminiProvider struct {
	client *http.Client
}

func (provider geminiProvider) Generate(ctx context.Context, model ModelConfig, request Request) (Response, error) {
	apiKey, err := apiKey(model)
	if err != nil {
		return Response{}, err
	}
	endpoint := model.Endpoint
	if endpoint == "" {
		endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" +
			url.PathEscape(model.Model) + ":generateContent"
	}
	var system string
	contents := make([]struct {
		Role  string `json:"role"`
		Parts []struct {
			Text string `json:"text"`
		} `json:"parts"`
	}, 0, len(request.Messages))
	for _, message := range request.Messages {
		if message.Role == RoleSystem {
			system = message.Content
			continue
		}
		role := "user"
		if message.Role == RoleAssistant {
			role = "model"
		}
		contents = append(contents, struct {
			Role  string `json:"role"`
			Parts []struct {
				Text string `json:"text"`
			} `json:"parts"`
		}{
			Role: role,
			Parts: []struct {
				Text string `json:"text"`
			}{{Text: message.Content}},
		})
	}
	payload := struct {
		SystemInstruction *struct {
			Parts []struct {
				Text string `json:"text"`
			} `json:"parts"`
		} `json:"systemInstruction,omitempty"`
		Contents []struct {
			Role  string `json:"role"`
			Parts []struct {
				Text string `json:"text"`
			} `json:"parts"`
		} `json:"contents"`
	}{
		Contents: contents,
	}
	if system != "" {
		payload.SystemInstruction = &struct {
			Parts []struct {
				Text string `json:"text"`
			} `json:"parts"`
		}{Parts: []struct {
			Text string `json:"text"`
		}{{Text: system}}}
	}
	var result struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
		UsageMetadata struct {
			PromptTokenCount     int `json:"promptTokenCount"`
			CandidatesTokenCount int `json:"candidatesTokenCount"`
		} `json:"usageMetadata"`
	}
	if err := provider.postJSON(ctx, model.Provider, endpoint, apiKey, "x-goog-api-key", "", payload, &result); err != nil {
		return Response{}, err
	}
	if len(result.Candidates) == 0 {
		return Response{}, &ProviderError{Provider: model.Provider, Err: errors.New("response contained no candidate")}
	}
	var content strings.Builder
	for _, part := range result.Candidates[0].Content.Parts {
		content.WriteString(part.Text)
	}
	if strings.TrimSpace(content.String()) == "" {
		return Response{}, &ProviderError{Provider: model.Provider, Err: errors.New("response contained no text")}
	}
	return Response{
		Content: content.String(),
		Usage: Usage{
			InputTokens:  result.UsageMetadata.PromptTokenCount,
			OutputTokens: result.UsageMetadata.CandidatesTokenCount,
		},
	}, nil
}

func (provider openAIProvider) postJSON(ctx context.Context, providerName, endpoint, secret, header, prefix string, payload, output any, extraHeaders ...func(*http.Request)) error {
	return postJSON(ctx, provider.client, providerName, endpoint, secret, header, prefix, payload, output, extraHeaders...)
}

func (provider anthropicProvider) postJSON(ctx context.Context, providerName, endpoint, secret, header, prefix string, payload, output any, extraHeaders ...func(*http.Request)) error {
	return postJSON(ctx, provider.client, providerName, endpoint, secret, header, prefix, payload, output, extraHeaders...)
}

func (provider geminiProvider) postJSON(ctx context.Context, providerName, endpoint, secret, header, prefix string, payload, output any, extraHeaders ...func(*http.Request)) error {
	return postJSON(ctx, provider.client, providerName, endpoint, secret, header, prefix, payload, output, extraHeaders...)
}

func postJSON(ctx context.Context, client *http.Client, providerName, endpoint, secret, header, prefix string, payload, output any, extraHeaders ...func(*http.Request)) error {
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
			Provider:  providerName,
			Status:    response.StatusCode,
			Retryable: response.StatusCode == http.StatusTooManyRequests || response.StatusCode >= http.StatusInternalServerError,
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
