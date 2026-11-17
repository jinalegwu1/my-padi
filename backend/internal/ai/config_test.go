package ai

import (
	"strings"
	"testing"
)

func TestLoadEnvironmentWithoutModels(t *testing.T) {
	t.Setenv("PADI_AI_MODELS", "")
	t.Setenv("PADI_AI_APPROVED_FREE_MODELS", "")
	configuration, err := LoadEnvironment()
	if err != nil {
		t.Fatalf("LoadEnvironment() error = %v", err)
	}
	if len(configuration.Models) != 0 {
		t.Errorf("models = %d, want none", len(configuration.Models))
	}
}

func TestLoadEnvironmentRequiresAPIKeyAndRouting(t *testing.T) {
	t.Setenv("PADI_AI_APPROVED_FREE_MODELS", "gemini:configured-model")
	t.Setenv("PADI_AI_MODELS", `[{"id":"main","provider":"gemini","model":"configured-model","api_key_env":"PADI_TEST_AI_KEY"}]`)
	t.Setenv("PADI_TEST_AI_KEY", "")
	if _, err := LoadEnvironment(); err == nil || !strings.Contains(err.Error(), "PADI_TEST_AI_KEY") {
		t.Fatalf("LoadEnvironment() error = %v, want missing key environment error", err)
	}

	t.Setenv("PADI_TEST_AI_KEY", "secret-value")
	if _, err := NewConfiguredRouterWithUsageLimiter(nil, newMemoryUsageLimiter()); err == nil {
		t.Fatal("NewConfiguredRouter() error = nil, want missing primary model error")
	}
}

func TestNewConfiguredRouterBuildsRegistryWithoutExposingSecrets(t *testing.T) {
	t.Setenv("PADI_AI_MODELS", `[
		{"id":"main","provider":"gemini","model":"selected-by-config","api_key_env":"PADI_TEST_AI_KEY"},
		{"id":"backup","provider":"groq","model":"backup-selected-by-config","api_key_env":"PADI_TEST_AI_KEY"}
	]`)
	t.Setenv("PADI_TEST_AI_KEY", "secret-value")
	t.Setenv("PADI_AI_PRIMARY_MODEL", "main")
	t.Setenv("PADI_AI_BACKUP_MODEL", "backup")
	t.Setenv("PADI_AI_APPROVED_FREE_MODELS", "gemini:selected-by-config,groq:backup-selected-by-config")

	router, err := NewConfiguredRouterWithUsageLimiter(nil, newMemoryUsageLimiter())
	if err != nil {
		t.Fatalf("NewConfiguredRouter() error = %v", err)
	}
	if router == nil {
		t.Fatal("NewConfiguredRouter() returned nil router with configured models")
	}
	if router.ModelCount() != 2 {
		t.Fatalf("ModelCount() = %d, want 2", router.ModelCount())
	}
}

func TestNewConfiguredRouterRequiresApprovedFreeModels(t *testing.T) {
	t.Setenv("PADI_AI_MODELS", `[{"id":"backup","provider":"openrouter","model":"vendor/model-free","api_key_env":"PADI_TEST_AI_KEY"}]`)
	t.Setenv("PADI_TEST_AI_KEY", "secret-value")
	t.Setenv("PADI_AI_PRIMARY_MODEL", "backup")
	t.Setenv("PADI_AI_APPROVED_FREE_MODELS", "")
	if _, err := NewConfiguredRouterWithUsageLimiter(nil, newMemoryUsageLimiter()); err == nil || !strings.Contains(err.Error(), "PADI_AI_APPROVED_FREE_MODELS") {
		t.Fatalf("NewConfiguredRouter() error = %v, want explicit approved free-model allowlist error", err)
	}

	t.Setenv("PADI_AI_APPROVED_FREE_MODELS", "openrouter:vendor/model-free")
	router, err := NewConfiguredRouterWithUsageLimiter(nil, newMemoryUsageLimiter())
	if err != nil {
		t.Fatalf("NewConfiguredRouter() with allowlist error = %v", err)
	}
	if router.ModelCount() != 1 {
		t.Errorf("ModelCount() = %d, want 1", router.ModelCount())
	}
}

func TestLoadEnvironmentRejectsMalformedConfiguration(t *testing.T) {
	t.Setenv("PADI_AI_MODELS", `[`)
	if _, err := LoadEnvironment(); err == nil {
		t.Fatal("LoadEnvironment() error = nil, want invalid JSON error")
	}

	t.Setenv("PADI_AI_MODELS", `[{"id":"main","provider":"openai","model":"configured-model","api_key_env":"PADI_TEST_AI_KEY"}]`)
	if _, err := LoadEnvironment(); err == nil || !strings.Contains(err.Error(), "unsupported provider") {
		t.Fatalf("LoadEnvironment() error = %v, want unsupported-provider error", err)
	}

	t.Setenv("PADI_AI_MODELS", `[{"id":"main","provider":"gemini","model":"configured-model"}]`)
	t.Setenv("PADI_AI_APPROVED_FREE_MODELS", "")
	if _, err := LoadEnvironment(); err == nil {
		t.Fatal("LoadEnvironment() error = nil, want missing api_key_env error")
	}

	t.Setenv("PADI_AI_MODELS", "")
	t.Setenv("PADI_AI_APPROVED_FREE_MODELS", "gemini:model-a,,gemini:model-b")
	if _, err := LoadEnvironment(); err == nil || !strings.Contains(err.Error(), "empty provider/model") {
		t.Fatalf("LoadEnvironment() error = %v, want invalid allowlist error", err)
	}
	t.Setenv("PADI_AI_APPROVED_FREE_MODELS", "gemini:model-a, gemini:model-a")
	if _, err := LoadEnvironment(); err == nil || !strings.Contains(err.Error(), "duplicate entry") {
		t.Fatalf("LoadEnvironment() error = %v, want duplicate allowlist error", err)
	}
}

func TestLoadEnvironmentSelectsFreeZAIInsteadOfMistral(t *testing.T) {
	t.Setenv("PADI_TEST_AI_KEY", "synthetic-key")
	t.Setenv("PADI_AI_MODELS", `[{"id":"reasoning","provider":"zai","model":"glm-4.7-flash","api_key_env":"PADI_TEST_AI_KEY"}]`)
	t.Setenv("PADI_AI_APPROVED_FREE_MODELS", "zai:glm-4.7-flash")
	configuration, err := LoadEnvironment()
	if err != nil || len(configuration.Models) != 1 || configuration.Models[0].Provider != ProviderZAI {
		t.Fatalf("free Z.ai model configuration failed: %v", err)
	}
	for _, model := range []string{"glm-4.7-flashx", "glm-4.7", "glm-5"} {
		t.Setenv("PADI_AI_MODELS", `[{"id":"reasoning","provider":"zai","model":"`+model+`","api_key_env":"PADI_TEST_AI_KEY"}]`)
		if _, err := LoadEnvironment(); err == nil {
			t.Fatalf("paid/unselected Z.ai model %s was accepted", model)
		}
	}
	t.Setenv("PADI_AI_MODELS", `[{"id":"reasoning","provider":"mistral","model":"old-model","api_key_env":"PADI_TEST_AI_KEY"}]`)
	if _, err := LoadEnvironment(); err == nil || !strings.Contains(err.Error(), "unsupported provider") {
		t.Fatalf("replaced Mistral configuration was accepted: %v", err)
	}
}
