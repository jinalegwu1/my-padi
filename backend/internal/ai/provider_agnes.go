package ai

import (
	"context"
	"net/http"
)

const ProviderAgnes = "agnes"
const AgnesFlashModel = "agnes-3.0-flash"
const agnesChatEndpoint = "https://apihub.agnes-ai.com/v1/chat/completions"

type agnesProvider struct{ client *http.Client }

func (provider agnesProvider) Generate(ctx context.Context, model ModelConfig, request Request) (Response, error) {
	endpoint := model.Endpoint
	if endpoint == "" {
		endpoint = agnesChatEndpoint
	}
	return generateOpenAICompatible(ctx, provider.client, model, request, endpoint)
}

func (provider agnesProvider) Stream(ctx context.Context, model ModelConfig, request Request, onDelta func(string) error) (Response, error) {
	endpoint := model.Endpoint
	if endpoint == "" {
		endpoint = agnesChatEndpoint
	}
	return streamOpenAICompatible(ctx, provider.client, model, request, endpoint, false, onDelta)
}
