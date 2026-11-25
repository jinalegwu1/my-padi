package ai

import (
	"context"
	"net/http"
)

const ProviderZAI = "zai"

// ZAIFlashModel is the free GLM-4.7-Flash model, distinct from paid FlashX.
const ZAIFlashModel = "glm-4.7-flash"

type zaiProvider struct {
	client *http.Client
}

func (provider zaiProvider) Generate(ctx context.Context, model ModelConfig, request Request) (Response, error) {
	key, err := apiKey(model)
	if err != nil {
		return Response{}, err
	}
	endpoint := model.Endpoint
	if endpoint == "" {
		endpoint = "https://api.z.ai/api/paas/v4/chat/completions"
	}
	// GLM-4.7 enables thinking by default. Reserve it for the existing reasoning
	// tasks; short conversations and JSON extraction should get visible answers
	// within their output budget. Historical reasoning content is never retained.
	thinking := "disabled"
	if !request.StructuredOutput && (isReasoningTask(request.Task) || request.Complexity == ComplexityComplex) {
		thinking = "enabled"
	}
	payload := struct {
		Model     string    `json:"model"`
		Messages  []Message `json:"messages"`
		MaxTokens int       `json:"max_tokens"`
		Thinking  struct {
			Type          string `json:"type"`
			ClearThinking bool   `json:"clear_thinking"`
		} `json:"thinking"`
		ResponseFormat *struct {
			Type string `json:"type"`
		} `json:"response_format,omitempty"`
	}{Model: model.Model, Messages: request.Messages, MaxTokens: configuredMaxOutputTokens(request)}
	payload.Thinking.Type = thinking
	payload.Thinking.ClearThinking = true
	if request.StructuredOutput {
		payload.ResponseFormat = &struct {
			Type string `json:"type"`
		}{Type: "json_object"}
	}
	var result openAIChatResponse
	if err := postJSON(ctx, provider.client, model.Provider, endpoint, key, "Authorization", "Bearer ", payload, &result); err != nil {
		return Response{}, err
	}
	return completedOpenAIResponse(model.Provider, result)
}
