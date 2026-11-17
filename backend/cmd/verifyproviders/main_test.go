package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jinalegwu1/my-padi/backend/internal/ai"
	"github.com/jinalegwu1/my-padi/backend/internal/verification"
)

type countingProvider struct{ calls int }

func (provider *countingProvider) Generate(context.Context, ai.ModelConfig, ai.Request) (ai.Response, error) {
	provider.calls++
	return ai.Response{Content: "Synthetic verification reply"}, nil
}

func TestVerificationReportRestrictsExistingFilePermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "report.json")
	if err := os.WriteFile(path, []byte("old report"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := writePrivateReport(path, []byte("{}\n")); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Errorf("report permissions = %o; want 600", info.Mode().Perm())
	}
}

type verificationTestLimiter struct{}

func (verificationTestLimiter) Reserve(context.Context, string, int, ai.UsageLimits, time.Time) error {
	return nil
}
func (verificationTestLimiter) RecordUsage(context.Context, string, ai.Usage, time.Time) error {
	return nil
}

func TestFreeEligibilityRequiresAccountApprovalCatalogAndZeroPricing(t *testing.T) {
	zero, paid := true, false
	models := []ai.ModelConfig{
		{ID: "free", Provider: ai.ProviderOpenRouter, Model: "provider/free", APIKeyEnv: "OPENROUTER_API_KEY"},
		{ID: "paid", Provider: ai.ProviderOpenRouter, Model: "provider/paid", APIKeyEnv: "OPENROUTER_API_KEY"},
		{ID: "unknown", Provider: ai.ProviderOpenRouter, Model: "provider/unknown", APIKeyEnv: "OPENROUTER_API_KEY"},
		{ID: "unapproved", Provider: ai.ProviderOpenRouter, Model: "provider/unapproved", APIKeyEnv: "OPENROUTER_API_KEY"},
		{ID: "image", Provider: ai.ProviderOpenRouter, Model: "provider/image", APIKeyEnv: "OPENROUTER_API_KEY"},
		{ID: "gemini", Provider: ai.ProviderGemini, Model: "gemini-model", APIKeyEnv: "GEMINI_API_KEY"},
	}
	configuration := ai.EnvironmentConfig{Models: models, Routing: ai.RoutingConfig{ApprovedFreeModels: []string{
		"openrouter:provider/free", "openrouter:provider/paid", "openrouter:provider/unknown", "openrouter:provider/image", "gemini:gemini-model",
	}}}
	catalogs := map[string]map[string]verification.CatalogModel{
		ai.ProviderOpenRouter: {
			"provider/free":       {SupportsText: true, ZeroPrice: &zero},
			"provider/paid":       {SupportsText: true, ZeroPrice: &paid},
			"provider/unknown":    {SupportsText: true},
			"provider/unapproved": {SupportsText: true, ZeroPrice: &zero},
			"provider/image":      {SupportsText: false, ZeroPrice: &zero},
		},
		ai.ProviderGemini: {"gemini-model": {SupportsText: true}},
	}
	eligible := freeVerificationModels(configuration, catalogs, map[string]bool{ai.ProviderOpenRouter: true})
	if len(eligible) != 1 || !eligible["free"] {
		t.Errorf("unsafe free-model eligibility: %+v", eligible)
	}
}

func TestFallbackNeverCallsPaidAdapterEvenWhenAllowlisted(t *testing.T) {
	delegate := &countingProvider{}
	models := []ai.ModelConfig{
		{ID: "primary", Provider: ai.ProviderGemini, Model: "primary-model"},
		{ID: "backup", Provider: ai.ProviderOpenRouter, Model: "provider/paid"},
	}
	adapters := map[string]ai.Provider{
		ai.ProviderGemini:     failingPrimary{modelID: "primary", delegate: delegate},
		ai.ProviderOpenRouter: freeVerificationProvider{eligible: map[string]bool{}, delegate: delegate},
	}
	router, err := ai.NewRouterWithUsageLimiter(models, adapters, ai.RoutingConfig{
		PrimaryModel: "primary", BackupModel: "backup", ApprovedFreeModels: []string{"gemini:primary-model", "openrouter:provider/paid"},
	}, nil, verificationTestLimiter{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = router.Generate(context.Background(), ai.Request{
		Task: ai.TaskConversation, Complexity: ai.ComplexityNormal,
		Messages: []ai.Message{{Role: ai.RoleUser, Content: "Say hello"}},
	})
	if err == nil || delegate.calls != 0 {
		t.Fatalf("paid fallback reached adapter: calls=%d error=%v", delegate.calls, err)
	}
}

func TestFreeGuardAllowsOnlyItsConfirmedModel(t *testing.T) {
	delegate := &countingProvider{}
	provider := freeVerificationProvider{eligible: map[string]bool{"approved": true}, delegate: delegate}
	if _, err := provider.Generate(context.Background(), ai.ModelConfig{ID: "rejected"}, ai.Request{}); err == nil {
		t.Fatal("unconfirmed model was delegated")
	}
	if delegate.calls != 0 {
		t.Fatal("rejected model reached adapter")
	}
	if _, err := provider.Generate(context.Background(), ai.ModelConfig{ID: "approved"}, ai.Request{}); err != nil {
		t.Fatal(err)
	}
	if delegate.calls != 1 {
		t.Fatalf("approved adapter calls=%d; want 1", delegate.calls)
	}
}
