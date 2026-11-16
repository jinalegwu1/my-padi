package ai

import (
	"context"
	"net/http"
)

const ProviderOpenAICompatible = "openai-compatible"

type openAICompatibleProvider struct {
	client *http.Client
}

func (provider openAICompatibleProvider) Generate(ctx context.Context, model ModelConfig, request Request) (Response, error) {
	return generateOpenAICompatible(ctx, provider.client, model, request, model.Endpoint)
}
