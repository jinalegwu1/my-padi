package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/jinalegwu1/my-padi/backend/internal/ai"
	"github.com/jinalegwu1/my-padi/backend/internal/config"
	"github.com/jinalegwu1/my-padi/backend/internal/database"
	"github.com/jinalegwu1/my-padi/backend/internal/verification"
)

var accountKeys = map[string]string{
	ai.ProviderGemini: "GEMINI_API_KEY", ai.ProviderGroq: "GROQ_API_KEY",
	ai.ProviderZAI: "ZAI_API_KEY", ai.ProviderOpenRouter: "OPENROUTER_API_KEY",
}

var providersInOrder = []string{ai.ProviderGemini, ai.ProviderGroq, ai.ProviderZAI, ai.ProviderOpenRouter}

type providerResult struct {
	Provider             string   `json:"provider"`
	KeyConfigured        bool     `json:"key_configured"`
	FreeAccountConfirmed bool     `json:"operator_confirmed_free_account"`
	CatalogChecked       bool     `json:"catalog_checked"`
	PricingChecked       bool     `json:"pricing_checked"`
	EvidenceSource       string   `json:"evidence_source,omitempty"`
	TextModels           []string `json:"available_text_models,omitempty"`
	DocumentedTextModels []string `json:"documented_text_models,omitempty"`
	ZeroPriceModels      []string `json:"published_zero_price_models,omitempty"`
	Error                string   `json:"error,omitempty"`
}

type modelResult struct {
	Provider             string   `json:"provider"`
	ConfiguredID         string   `json:"configured_id"`
	Model                string   `json:"model"`
	Available            bool     `json:"available"`
	AvailabilityEvidence string   `json:"availability_evidence,omitempty"`
	PricingEvidence      string   `json:"pricing_evidence"`
	ResponseChecked      bool     `json:"response_checked"`
	Response             string   `json:"response,omitempty"`
	Usage                ai.Usage `json:"usage"`
	DurationMS           int64    `json:"duration_ms"`
	Error                string   `json:"error,omitempty"`
}

type fallbackResult struct {
	Method    string `json:"method"`
	Attempted bool   `json:"attempted"`
	Succeeded bool   `json:"succeeded"`
	Provider  string `json:"provider,omitempty"`
	Model     string `json:"model,omitempty"`
	Response  string `json:"response,omitempty"`
}

type report struct {
	CheckedAt                  time.Time        `json:"checked_at"`
	CatalogOnly                bool             `json:"catalog_only"`
	Providers                  []providerResult `json:"providers"`
	Models                     []modelResult    `json:"models,omitempty"`
	Fallback                   fallbackResult   `json:"fallback"`
	AllFourResponsesChecked    bool             `json:"all_four_responses_checked"`
	PricingNotExposedByCatalog []string         `json:"pricing_not_exposed_by_catalogue"`
	Pending                    []string         `json:"pending,omitempty"`
}

func main() {
	envFile := flag.String("env-file", ".env", "local backend environment file; existing environment values take precedence")
	catalogOnly := flag.Bool("catalog-only", false, "check catalogues without generating responses")
	output := flag.String("output", "", "write the JSON report to this file with owner-only permissions")
	flag.Parse()
	if *envFile != "" {
		if err := verification.LoadEnvFile(*envFile); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	client := &http.Client{
		Timeout:       30 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
	}
	result := verify(ctx, client, *catalogOnly)
	encoded, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		fmt.Fprintln(os.Stderr, "Could not encode verification report.")
		os.Exit(1)
	}
	encoded = append(encoded, '\n')
	if *output == "" {
		if _, err := os.Stdout.Write(encoded); err != nil {
			os.Exit(1)
		}
	} else if err := writePrivateReport(*output, encoded); err != nil {
		fmt.Fprintln(os.Stderr, "Could not write verification report.")
		os.Exit(1)
	} else {
		fmt.Printf("Provider verification report written to %s\n", *output)
	}
	if len(result.Pending) > 0 || (!*catalogOnly && (!result.AllFourResponsesChecked || !result.Fallback.Succeeded)) {
		os.Exit(2)
	}
}

func writePrivateReport(path string, body []byte) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	defer file.Close()
	if err := file.Chmod(0600); err != nil {
		return err
	}
	if _, err := file.Write(body); err != nil {
		return err
	}
	return file.Close()
}

func verify(ctx context.Context, client *http.Client, catalogOnly bool) report {
	result := report{
		CheckedAt: time.Now().UTC(), CatalogOnly: catalogOnly,
		Fallback:                   fallbackResult{Method: "controlled primary-provider failure followed by a real configured backup request"},
		PricingNotExposedByCatalog: []string{ai.ProviderGemini, ai.ProviderGroq},
	}
	freeAccounts := confirmedFreeAccounts(os.Getenv("PADI_AI_FREE_ACCOUNT_CONFIRMED"))
	catalogs := make(map[string]map[string]verification.CatalogModel)
	for _, provider := range providersInOrder {
		key := strings.TrimSpace(os.Getenv(accountKeys[provider]))
		current := providerResult{Provider: provider, KeyConfigured: key != "", FreeAccountConfirmed: freeAccounts[provider]}
		if key == "" {
			result.Pending = append(result.Pending, "configure "+accountKeys[provider])
			if provider != ai.ProviderOpenRouter && provider != ai.ProviderZAI {
				result.Providers = append(result.Providers, current)
				continue
			}
		}
		catalog, err := verification.FetchCatalog(ctx, client, provider, key)
		if err != nil {
			current.Error = err.Error() // FetchCatalog returns only sanitized errors.
			result.Pending = append(result.Pending, "resolve "+provider+" catalogue access")
		} else {
			current.CatalogChecked = provider != ai.ProviderZAI
			if provider == ai.ProviderZAI {
				current.PricingChecked = true
				current.EvidenceSource = "https://docs.z.ai/guides/overview/pricing"
			}
			catalogs[provider] = catalog
			for _, model := range catalog {
				if model.SupportsText {
					if model.DocumentationOnly {
						current.DocumentedTextModels = append(current.DocumentedTextModels, model.ID)
					} else {
						current.TextModels = append(current.TextModels, model.ID)
					}
				}
				if model.ZeroPrice != nil && *model.ZeroPrice {
					current.ZeroPriceModels = append(current.ZeroPriceModels, model.ID)
				}
			}
			sort.Strings(current.TextModels)
			sort.Strings(current.DocumentedTextModels)
			sort.Strings(current.ZeroPriceModels)
		}
		result.Providers = append(result.Providers, current)
	}
	if catalogOnly {
		return result
	}
	configuration, err := ai.LoadEnvironment()
	if err != nil {
		result.Pending = append(result.Pending, "correct model configuration, account keys, and approved free-model list")
		return result
	}
	if len(configuration.Models) == 0 || len(configuration.Models) > 8 {
		result.Pending = append(result.Pending, "configure one approved model per provider (at most eight models per run)")
		return result
	}
	for _, provider := range providersInOrder {
		if strings.TrimSpace(os.Getenv(accountKeys[provider])) != "" && !freeAccounts[provider] {
			result.Pending = append(result.Pending, "confirm free account eligibility for "+provider+" in PADI_AI_FREE_ACCOUNT_CONFIRMED")
		}
	}
	configured := make(map[string]bool)
	for _, model := range configuration.Models {
		configured[model.Provider] = true
		if model.APIKeyEnv != accountKeys[model.Provider] {
			result.Pending = append(result.Pending, "use "+accountKeys[model.Provider]+" for the configured "+model.Provider+" account")
		}
	}
	for _, provider := range providersInOrder {
		if !configured[provider] {
			result.Pending = append(result.Pending, "configure an approved "+provider+" model")
		}
	}
	databaseURL := config.Load().DatabaseURL
	if databaseURL == "" {
		databaseURL = os.Getenv("PADI_TEST_DATABASE_URL")
	}
	if databaseURL == "" {
		result.Pending = append(result.Pending, "configure DATABASE_URL or PADI_TEST_DATABASE_URL for the persistent usage ledger")
		return result
	}
	db, err := database.Open(ctx, databaseURL)
	if err != nil {
		result.Pending = append(result.Pending, "make the configured PostgreSQL database reachable")
		return result
	}
	defer db.Close()
	limiter, err := database.NewAIUsageLimiter(ctx, db)
	if err != nil {
		result.Pending = append(result.Pending, "apply migrations and make the persistent usage ledger available")
		return result
	}
	eligible := freeVerificationModels(configuration, catalogs, freeAccounts)
	adapters := guardedAdapters(client, eligible)
	router, err := ai.NewRouterWithUsageLimiter(configuration.Models, adapters, configuration.Routing, nil, limiter)
	if err != nil {
		result.Pending = append(result.Pending, "correct approved model identities and routing configuration")
		return result
	}
	request := ai.Request{
		Task: ai.TaskConversation, Complexity: ai.ComplexityNormal, MaxOutputTokens: 1024,
		Messages: []ai.Message{{Role: ai.RoleUser, Content: "Please reply with a short greeting and identify yourself as PADI."}},
	}
	successful := make(map[string]bool)
	successfulModels := make(map[string]bool)
	var primary, backup ai.ModelConfig
	for _, model := range configuration.Models {
		if model.ID == configuration.Routing.PrimaryModel {
			primary = model
		}
		if model.ID == configuration.Routing.BackupModel {
			backup = model
		}
		current := modelResult{Provider: model.Provider, ConfiguredID: model.ID, Model: model.Model}
		catalogModel, exists := catalogs[model.Provider][catalogModelID(model)]
		current.Available = exists && catalogModel.SupportsText && !catalogModel.DocumentationOnly
		current.PricingEvidence = "operator approval in PADI_AI_APPROVED_FREE_MODELS; account pricing needs manual review"
		if !exists || !catalogModel.SupportsText {
			current.Error = "configured text model is unavailable in the account catalogue"
		} else if (model.Provider == ai.ProviderOpenRouter || model.Provider == ai.ProviderZAI) && (catalogModel.ZeroPrice == nil || !*catalogModel.ZeroPrice) {
			current.Error = "published zero pricing could not be confirmed; no generation request sent"
		} else if !eligible[model.ID] {
			current.Error = "free model/account is unapproved; no generation request sent"
		} else {
			if model.Provider == ai.ProviderOpenRouter {
				current.PricingEvidence = "live provider catalogue: all published price fields are zero"
			} else if model.Provider == ai.ProviderZAI {
				current.PricingEvidence = "official Z.ai pricing page: GLM-4.7-Flash input, cache, storage, and output are Free"
			}
			started := time.Now()
			response, err := router.GenerateWithModel(ctx, model.ID, request)
			current.DurationMS = time.Since(started).Milliseconds()
			if err != nil {
				current.Error = "generation failed; check account access, provider availability, or remaining quota"
				var providerErr *ai.ProviderError
				if errors.As(err, &providerErr) && providerErr.Status != 0 {
					current.Error = fmt.Sprintf("generation returned HTTP %d; check account access, model availability, and remaining quota", providerErr.Status)
					if providerErr.Status == http.StatusNotFound {
						current.Available = false
					}
				} else if providerErr != nil && providerErr.Err != nil {
					// Match only our own adapter diagnostics. Never copy arbitrary
					// upstream/network errors or hidden reasoning into the report.
					switch providerErr.Err.Error() {
					case "response contained no message", "response contained no text", "response contained no candidate":
						current.Error = "provider returned no visible reply within the configured output allowance"
					case "provider returned malformed JSON":
						current.Error = "provider returned an unsupported response format"
					}
				}
			} else {
				current.Available = true
				current.AvailabilityEvidence = "authenticated generation returned a visible response from the configured model"
				current.ResponseChecked = true
				current.Response, current.Usage = response.Content, response.Usage
				successful[model.Provider] = true
				successfulModels[model.ID] = true
			}
		}
		if !current.ResponseChecked {
			result.Pending = append(result.Pending, "verify live response for "+model.ID)
		}
		result.Models = append(result.Models, current)
	}
	result.AllFourResponsesChecked = len(successful) == len(providersInOrder)
	if primary.ID == "" || backup.ID == "" || !successfulModels[backup.ID] {
		result.Pending = append(result.Pending, "configure and verify primary and backup models before the fallback test")
		return result
	}
	adapters = guardedAdapters(client, eligible)
	adapters[primary.Provider] = failingPrimary{modelID: primary.ID, delegate: adapters[primary.Provider]}
	fallbackRouter, err := ai.NewRouterWithUsageLimiter(configuration.Models, adapters, configuration.Routing, nil, limiter)
	if err != nil {
		result.Pending = append(result.Pending, "correct fallback routing configuration")
		return result
	}
	result.Fallback.Attempted = true
	response, err := fallbackRouter.Generate(ctx, request)
	if err == nil {
		result.Fallback.Provider, result.Fallback.Model, result.Fallback.Response = response.Provider, response.Model, response.Content
		result.Fallback.Succeeded = response.Provider == backup.Provider && response.Model == backup.Model
	}
	if !result.Fallback.Succeeded {
		result.Pending = append(result.Pending, "verify a real response from the configured backup after primary failure")
	}
	return result
}

func confirmedFreeAccounts(raw string) map[string]bool {
	confirmed := make(map[string]bool)
	for _, provider := range strings.Split(raw, ",") {
		provider = strings.TrimSpace(provider)
		if _, supported := accountKeys[provider]; supported {
			confirmed[provider] = true
		}
	}
	return confirmed
}

func catalogModelID(model ai.ModelConfig) string {
	if model.Provider == ai.ProviderGemini {
		return strings.TrimPrefix(model.Model, "models/")
	}
	return model.Model
}

func freeVerificationModels(configuration ai.EnvironmentConfig, catalogs map[string]map[string]verification.CatalogModel, accounts map[string]bool) map[string]bool {
	eligible := make(map[string]bool)
	approved := make(map[string]bool)
	for _, identity := range configuration.Routing.ApprovedFreeModels {
		approved[identity] = true
	}
	for _, model := range configuration.Models {
		if model.APIKeyEnv != accountKeys[model.Provider] {
			continue
		}
		catalogModel, exists := catalogs[model.Provider][catalogModelID(model)]
		if !accounts[model.Provider] || !approved[model.Provider+":"+model.Model] || !exists || !catalogModel.SupportsText {
			continue
		}
		if (model.Provider == ai.ProviderOpenRouter || model.Provider == ai.ProviderZAI) && (catalogModel.ZeroPrice == nil || !*catalogModel.ZeroPrice) {
			continue
		}
		eligible[model.ID] = true
	}
	return eligible
}

func guardedAdapters(client *http.Client, eligible map[string]bool) map[string]ai.Provider {
	adapters := ai.NewProviderAdapters(client)
	for name, delegate := range adapters {
		adapters[name] = freeVerificationProvider{eligible: eligible, delegate: delegate}
	}
	return adapters
}

type freeVerificationProvider struct {
	eligible map[string]bool
	delegate ai.Provider
}

func (provider freeVerificationProvider) Generate(ctx context.Context, model ai.ModelConfig, request ai.Request) (ai.Response, error) {
	if !provider.eligible[model.ID] {
		return ai.Response{}, &ai.ProviderError{Provider: model.Provider, Err: errors.New("model is not verified for free account access")}
	}
	return provider.delegate.Generate(ctx, model, request)
}

type failingPrimary struct {
	modelID  string
	delegate ai.Provider
}

func (provider failingPrimary) Generate(ctx context.Context, model ai.ModelConfig, request ai.Request) (ai.Response, error) {
	if model.ID == provider.modelID {
		return ai.Response{}, &ai.ProviderError{Provider: model.Provider, Status: http.StatusServiceUnavailable, Retryable: true}
	}
	return provider.delegate.Generate(ctx, model, request)
}
