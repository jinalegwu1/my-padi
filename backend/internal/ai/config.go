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
	rawModels := strings.TrimSpace(os.Getenv("PADI_AI_MODELS"))
	if rawModels == "" {
		return EnvironmentConfig{}, nil
	}

	var models []ModelConfig
	if err := json.Unmarshal([]byte(rawModels), &models); err != nil {
		return EnvironmentConfig{}, fmt.Errorf("parse PADI_AI_MODELS: %w", err)
	}
	for _, model := range models {
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
			PrimaryModel:   os.Getenv("PADI_AI_PRIMARY_MODEL"),
			FastModel:      os.Getenv("PADI_AI_FAST_MODEL"),
			ReasoningModel: os.Getenv("PADI_AI_REASONING_MODEL"),
			BackupModel:    os.Getenv("PADI_AI_BACKUP_MODEL"),
		},
	}, nil
}

// NewConfiguredRouter loads provider settings and credentials from environment.
// It returns a nil router when PADI_AI_MODELS is unset.
func NewConfiguredRouter(observer Observer) (*Router, error) {
	configuration, err := LoadEnvironment()
	if err != nil {
		return nil, err
	}
	if len(configuration.Models) == 0 {
		return nil, nil
	}
	return NewRouter(configuration.Models, NewProviderAdapters(nil), configuration.Routing, observer)
}

func (router *Router) ModelCount() int {
	return len(router.models)
}
