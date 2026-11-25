package ai

import (
	"context"
	"net/http"
	"strings"
)

const ProviderAnthropic = "anthropic"

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
		role := "user"
		if message.Role == RoleAssistant {
			role = "assistant"
		}
		messages = append(messages, Message{Role: MessageRole(role), Content: message.Content})
	}
	payload := struct {
		Model     string    `json:"model"`
		MaxTokens int       `json:"max_tokens"`
		System    string    `json:"system,omitempty"`
		Messages  []Message `json:"messages"`
	}{
		Model:     model.Model,
		MaxTokens: configuredMaxOutputTokens(request),
		System:    system,
		Messages:  messages,
	}
	var result struct {
		StopReason string `json:"stop_reason"`
		Content    []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		Usage struct {
			InputTokens  int `json:"input_tokens"`
			OutputTokens int `json:"output_tokens"`
		} `json:"usage"`
	}
	if err := postJSON(ctx, provider.client, model.Provider, endpoint, apiKey, "x-api-key", "", payload, &result, func(req *http.Request) {
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
	response := Response{
		Content:      content.String(),
		FinishReason: result.StopReason,
		Usage: Usage{
			InputTokens:  result.Usage.InputTokens,
			OutputTokens: result.Usage.OutputTokens,
		},
	}
	if err := completionError(model.Provider, response.FinishReason, true); err != nil {
		return response, err
	}
	return response, validateCompleteText(model.Provider, response.Content)
}
