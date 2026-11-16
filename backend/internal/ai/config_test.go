package ai

import (
	"strings"
	"testing"
)

func TestLoadEnvironmentWithoutModels(t *testing.T) {
	t.Setenv("PADI_AI_MODELS", "")
	configuration, err := LoadEnvironment()
	if err != nil {
		t.Fatalf("LoadEnvironment() error = %v", err)
	}
	if len(configuration.Models) != 0 {
		t.Errorf("models = %d, want none", len(configuration.Models))
	}
}

func TestLoadEnvironmentRequiresAPIKeyAndRouting(t *testing.T) {
	t.Setenv("PADI_AI_MODELS", `[{"id":"main","provider":"openai","model":"configured-model","api_key_env":"PADI_TEST_AI_KEY"}]`)
	t.Setenv("PADI_TEST_AI_KEY", "")
	if _, err := LoadEnvironment(); err == nil || !strings.Contains(err.Error(), "PADI_TEST_AI_KEY") {
		t.Fatalf("LoadEnvironment() error = %v, want missing key environment error", err)
	}

	t.Setenv("PADI_TEST_AI_KEY", "secret-value")
	if _, err := NewConfiguredRouter(nil); err == nil {
		t.Fatal("NewConfiguredRouter() error = nil, want missing primary model error")
	}
}

func TestNewConfiguredRouterBuildsRegistryWithoutExposingSecrets(t *testing.T) {
	t.Setenv("PADI_AI_MODELS", `[
		{"id":"main","provider":"openai","model":"selected-by-config","api_key_env":"PADI_TEST_AI_KEY"},
		{"id":"backup","provider":"openai-compatible","model":"backup-selected-by-config","endpoint":"https://example.test/v1/chat/completions","api_key_env":"PADI_TEST_AI_KEY"}
	]`)
	t.Setenv("PADI_TEST_AI_KEY", "secret-value")
	t.Setenv("PADI_AI_PRIMARY_MODEL", "main")
	t.Setenv("PADI_AI_BACKUP_MODEL", "backup")

	router, err := NewConfiguredRouter(nil)
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

func TestLoadEnvironmentRejectsMalformedConfiguration(t *testing.T) {
	t.Setenv("PADI_AI_MODELS", `[`)
	if _, err := LoadEnvironment(); err == nil {
		t.Fatal("LoadEnvironment() error = nil, want invalid JSON error")
	}

	t.Setenv("PADI_AI_MODELS", `[{"id":"main","provider":"openai","model":"configured-model"}]`)
	if _, err := LoadEnvironment(); err == nil {
		t.Fatal("LoadEnvironment() error = nil, want missing api_key_env error")
	}
}
