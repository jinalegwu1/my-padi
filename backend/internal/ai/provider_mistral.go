package ai

import (
	"context"
	"net/http"
)

const ProviderMistral = "mistral"

type mistralProvider struct {
	client *http.Client
}

func (provider mistralProvider) Generate(ctx context.Context, model ModelConfig, request Request) (Response, error) {
	endpoint := model.Endpoint
	if endpoint == "" {
		endpoint = "https://api.mistral.ai/v1/chat/completions"
	}
	return generateOpenAICompatible(ctx, provider.client, model, request, endpoint)
}
