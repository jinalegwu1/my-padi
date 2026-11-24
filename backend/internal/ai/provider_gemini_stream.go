package ai

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// Stream requests conversational TEXT only. Speech generation is never sent
// to this adapter; the frontend's existing TTS queue consumes these deltas.
func (provider geminiProvider) Stream(ctx context.Context, model ModelConfig, request Request, onDelta func(string) error) (Response, error) {
	key, err := apiKey(model)
	if err != nil {
		return Response{}, err
	}
	endpoint := model.Endpoint
	if endpoint == "" {
		endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + url.PathEscape(model.Model) + ":streamGenerateContent?alt=sse"
	}
	payload := struct {
		System   *geminiParts    `json:"systemInstruction,omitempty"`
		Contents []geminiContent `json:"contents"`
		Config   struct {
			Modalities []string `json:"responseModalities"`
			MaxTokens  int      `json:"maxOutputTokens"`
		} `json:"generationConfig"`
	}{}
	payload.Config.Modalities = []string{"TEXT"}
	payload.Config.MaxTokens = configuredMaxOutputTokens(request)
	for _, message := range request.Messages {
		if message.Role == RoleSystem {
			payload.System = &geminiParts{Parts: []geminiPart{{Text: message.Content}}}
			continue
		}
		role := "user"
		if message.Role == RoleAssistant {
			role = "model"
		}
		payload.Contents = append(payload.Contents, geminiContent{Role: role, Parts: []geminiPart{{Text: message.Content}}})
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return Response{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(string(body)))
	if err != nil {
		return Response{}, &ProviderError{Provider: ProviderGemini, Err: errors.New("could not create text stream request")}
	}
	req.Header.Set("x-goog-api-key", key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	client := provider.client
	if client == nil {
		client = http.DefaultClient
	}
	response, err := client.Do(req)
	if err != nil {
		return Response{}, &ProviderError{Provider: ProviderGemini, Retryable: !errors.Is(err, context.Canceled), Err: err}
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return Response{}, &ProviderError{Provider: ProviderGemini, Status: response.StatusCode, Retryable: response.StatusCode == 404 || response.StatusCode == 429 || response.StatusCode >= 500}
	}
	var result Response
	scanner := bufio.NewScanner(io.LimitReader(response.Body, maxProviderResponseBytes+1))
	scanner.Buffer(make([]byte, 4096), maxProviderResponseBytes)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		var chunk struct {
			Candidates []struct {
				Content struct {
					Parts []struct {
						Text       string          `json:"text"`
						Thought    bool            `json:"thought"`
						InlineData json.RawMessage `json:"inlineData"`
					} `json:"parts"`
				} `json:"content"`
			} `json:"candidates"`
			Usage struct {
				Input  int `json:"promptTokenCount"`
				Output int `json:"candidatesTokenCount"`
			} `json:"usageMetadata"`
			Error json.RawMessage `json:"error"`
		}
		if err := json.Unmarshal([]byte(strings.TrimSpace(strings.TrimPrefix(line, "data:"))), &chunk); err != nil {
			return Response{}, &ProviderError{Provider: ProviderGemini, Err: errors.New("invalid text stream response")}
		}
		if len(chunk.Error) > 0 {
			return Response{}, &ProviderError{Provider: ProviderGemini, Retryable: true, Err: errors.New("text stream provider error")}
		}
		if chunk.Usage.Input > 0 || chunk.Usage.Output > 0 {
			result.Usage = Usage{InputTokens: chunk.Usage.Input, OutputTokens: chunk.Usage.Output}
		}
		if len(chunk.Candidates) == 0 {
			continue
		}
		for _, part := range chunk.Candidates[0].Content.Parts {
			if len(part.InlineData) > 0 {
				return Response{}, &ProviderError{Provider: ProviderGemini, Err: errors.New("unexpected non-text response")}
			}
			if part.Thought || part.Text == "" {
				continue
			}
			result.Content += part.Text
			if len(result.Content) > maxProviderResponseBytes {
				return Response{}, &ProviderError{Provider: ProviderGemini, Err: errors.New("text response exceeded size limit")}
			}
			if onDelta != nil {
				if err := onDelta(part.Text); err != nil {
					return Response{}, fmt.Errorf("deliver text stream: %w", err)
				}
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return Response{}, &ProviderError{Provider: ProviderGemini, Retryable: true, Err: errors.New("could not read text stream")}
	}
	if strings.TrimSpace(result.Content) == "" {
		return Response{}, &ProviderError{Provider: ProviderGemini, Retryable: true, Err: ErrEmptyProviderResponse}
	}
	return result, nil
}
