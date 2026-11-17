package ai

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

type EnvironmentConfig struct {
	Models  []ModelConfig
	Routing RoutingConfig
}

// LoadEnvironment reads non-secret model metadata and routing from environment.
// Credentials are read later from each model's APIKeyEnv and are never logged.
func LoadEnvironment() (EnvironmentConfig, error) {
	approvedFreeModels, err := parseApprovedFreeModels(os.Getenv("PADI_AI_APPROVED_FREE_MODELS"))
	if err != nil {
		return EnvironmentConfig{}, err
	}

	rawModels := strings.TrimSpace(os.Getenv("PADI_AI_MODELS"))
	if rawModels == "" {
		return EnvironmentConfig{}, nil
	}

	var models []ModelConfig
	if err := json.Unmarshal([]byte(rawModels), &models); err != nil {
		return EnvironmentConfig{}, fmt.Errorf("parse PADI_AI_MODELS: %w", err)
	}
	for _, model := range models {
		switch model.Provider {
		case ProviderGemini, ProviderOpenRouter, ProviderGroq, ProviderZAI:
		default:
			return EnvironmentConfig{}, fmt.Errorf("AI model %q uses unsupported provider %q; configure Gemini, OpenRouter, Groq, or Z.ai", model.ID, model.Provider)
		}
		if model.Provider == ProviderZAI && model.Model != ZAIFlashModel {
			return EnvironmentConfig{}, fmt.Errorf("AI model %q must use %s for PADI's current free Z.ai route", model.ID, ZAIFlashModel)
		}
		if model.APIKeyEnv == "" {
			return EnvironmentConfig{}, fmt.Errorf("AI model %q requires api_key_env", model.ID)
		}
		if strings.TrimSpace(os.Getenv(model.APIKeyEnv)) == "" {
			return EnvironmentConfig{}, fmt.Errorf("AI model %q requires environment variable %s", model.ID, model.APIKeyEnv)
		}
	}

	return EnvironmentConfig{
		Models: models,
		Routing: RoutingConfig{
			PrimaryModel:       os.Getenv("PADI_AI_PRIMARY_MODEL"),
			FastModel:          os.Getenv("PADI_AI_FAST_MODEL"),
			ReasoningModel:     os.Getenv("PADI_AI_REASONING_MODEL"),
			BackupModel:        os.Getenv("PADI_AI_BACKUP_MODEL"),
			ApprovedFreeModels: approvedFreeModels,
		},
	}, nil
}

func parseApprovedFreeModels(raw string) ([]string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	models := strings.Split(raw, ",")
	seen := make(map[string]struct{}, len(models))
	for i := range models {
		models[i] = strings.TrimSpace(models[i])
		if models[i] == "" {
			return nil, fmt.Errorf("PADI_AI_APPROVED_FREE_MODELS contains an empty provider/model entry")
		}
		if _, exists := seen[models[i]]; exists {
			return nil, fmt.Errorf("PADI_AI_APPROVED_FREE_MODELS contains duplicate entry %q", models[i])
		}
		provider, model, found := strings.Cut(models[i], ":")
		if !found || strings.TrimSpace(provider) == "" || strings.TrimSpace(model) == "" {
			return nil, fmt.Errorf("PADI_AI_APPROVED_FREE_MODELS entry %q must use provider:model format", models[i])
		}
		seen[models[i]] = struct{}{}
	}
	return models, nil
}

// NewConfiguredRouter loads provider settings and credentials from environment.
// It returns a nil router when PADI_AI_MODELS is unset.
func NewConfiguredRouter(observer Observer) (*Router, error) {
	configuration, err := LoadEnvironment()
	if err != nil {
		return nil, err
	}
	return NewRouterFromEnvironment(configuration, observer, nil)
}

func NewConfiguredRouterWithUsageLimiter(observer Observer, limiter UsageLimiter) (*Router, error) {
	configuration, err := LoadEnvironment()
	if err != nil {
		return nil, err
	}
	return NewRouterFromEnvironment(configuration, observer, limiter)
}

func NewRouterFromEnvironment(configuration EnvironmentConfig, observer Observer, limiter UsageLimiter) (*Router, error) {
	if len(configuration.Models) == 0 {
		return nil, nil
	}
	if limiter == nil {
		return nil, ErrUsageLimiterUnavailable
	}
	return NewRouterWithUsageLimiter(
		configuration.Models,
		NewProviderAdapters(nil),
		configuration.Routing,
		observer,
		limiter,
	)
}

func (router *Router) ModelCount() int {
	return len(router.models)
}
