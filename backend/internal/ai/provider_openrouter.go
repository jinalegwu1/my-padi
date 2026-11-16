package ai

import (
	"context"
	"net/http"
)

const ProviderOpenRouter = "openrouter"

type openRouterProvider struct {
	client *http.Client
}

func (provider openRouterProvider) Generate(ctx context.Context, model ModelConfig, request Request) (Response, error) {
	endpoint := model.Endpoint
	if endpoint == "" {
		endpoint = "https://openrouter.ai/api/v1/chat/completions"
	}
	return generateOpenAICompatible(ctx, provider.client, model, request, endpoint)
}
