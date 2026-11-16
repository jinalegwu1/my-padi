package ai

import (
	"context"
	"net/http"
)

const ProviderGroq = "groq"

type groqProvider struct {
	client *http.Client
}

func (provider groqProvider) Generate(ctx context.Context, model ModelConfig, request Request) (Response, error) {
	endpoint := model.Endpoint
	if endpoint == "" {
		endpoint = "https://api.groq.com/openai/v1/chat/completions"
	}
	return generateOpenAICompatible(ctx, provider.client, model, request, endpoint)
}
