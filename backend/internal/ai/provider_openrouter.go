package ai

import (
	"context"
	"net/http"
)

const ProviderOpenRouter = "openrouter"

const openRouterShortReplyReasoningModel = "nvidia/nemotron-3.5-lightning:free"

type openRouterProvider struct {
	client *http.Client
}

func (provider openRouterProvider) Generate(ctx context.Context, model ModelConfig, request Request) (Response, error) {
	endpoint := model.Endpoint
	if endpoint == "" {
		endpoint = "https://openrouter.ai/api/v1/chat/completions"
	}
	// This free Nemotron endpoint can spend the entire short reply budget on hidden reasoning.
	disableReasoning := model.Model == openRouterShortReplyReasoningModel && configuredMaxOutputTokens(request) <= 256
	return generateOpenAICompatibleWithOptions(ctx, provider.client, model, request, endpoint, disableReasoning)
}
