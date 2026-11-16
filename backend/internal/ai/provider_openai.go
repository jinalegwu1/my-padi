package ai

import (
	"context"
	"net/http"
)

const ProviderOpenAI = "openai"

type openAIProvider struct {
	client *http.Client
}

func (provider openAIProvider) Generate(ctx context.Context, model ModelConfig, request Request) (Response, error) {
	endpoint := model.Endpoint
	if endpoint == "" {
		endpoint = "https://api.openai.com/v1/chat/completions"
	}
	return generateOpenAICompatible(ctx, provider.client, model, request, endpoint)
}
