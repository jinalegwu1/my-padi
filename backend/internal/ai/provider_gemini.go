package ai

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
)

const ProviderGemini = "gemini"

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
	contents := make([]geminiContent, 0, len(request.Messages))
	for _, message := range request.Messages {
		if message.Role == RoleSystem {
			system = message.Content
			continue
		}
		role := "user"
		if message.Role == RoleAssistant {
			role = "model"
		}
		contents = append(contents, geminiContent{
			Role:  role,
			Parts: []geminiPart{{Text: message.Content}},
		})
	}
	payload := struct {
		SystemInstruction *geminiParts    `json:"systemInstruction,omitempty"`
		Contents          []geminiContent `json:"contents"`
		GenerationConfig  *struct {
			MaxOutputTokens int    `json:"maxOutputTokens"`
			ResponseMIMEType string `json:"responseMimeType"`
		} `json:"generationConfig,omitempty"`
	}{Contents: contents}
	if system != "" {
		payload.SystemInstruction = &geminiParts{Parts: []geminiPart{{Text: system}}}
	}
	payload.GenerationConfig = &struct {
		MaxOutputTokens int    `json:"maxOutputTokens"`
		ResponseMIMEType string `json:"responseMimeType"`
	}{MaxOutputTokens: configuredMaxOutputTokens(request)}
	if request.StructuredOutput {
		payload.GenerationConfig = &struct {
			MaxOutputTokens int    `json:"maxOutputTokens"`
			ResponseMIMEType string `json:"responseMimeType"`
		}{MaxOutputTokens: configuredMaxOutputTokens(request), ResponseMIMEType: "application/json"}
	}
	var result struct {
		Candidates []struct {
			Content geminiContent `json:"content"`
		} `json:"candidates"`
		UsageMetadata struct {
			PromptTokenCount     int `json:"promptTokenCount"`
			CandidatesTokenCount int `json:"candidatesTokenCount"`
		} `json:"usageMetadata"`
	}
	if err := postJSON(ctx, provider.client, model.Provider, endpoint, apiKey, "x-goog-api-key", "", payload, &result); err != nil {
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

type geminiPart struct {
	Text string `json:"text"`
}

type geminiParts struct {
	Parts []geminiPart `json:"parts"`
}

type geminiContent struct {
	Role  string       `json:"role"`
	Parts []geminiPart `json:"parts"`
}
