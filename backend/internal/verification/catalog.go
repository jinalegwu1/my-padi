package verification

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strings"

	"github.com/jinalegwu1/my-padi/backend/internal/ai"
)

const maxCatalogBytes = 8 << 20

var catalogEndpoints = map[string]string{
	ai.ProviderGemini:     "https://generativelanguage.googleapis.com/v1beta/models",
	ai.ProviderGroq:       "https://api.groq.com/openai/v1/models",
	ai.ProviderMistral:    "https://api.mistral.ai/v1/models",
	ai.ProviderZAI:        "https://docs.z.ai/guides/overview/pricing.md",
	ai.ProviderOpenRouter: "https://openrouter.ai/api/v1/models",
}

type CatalogModel struct {
	ID           string `json:"id"`
	SupportsText bool   `json:"supports_text"`
	// DocumentationOnly requires a live response to verify account availability.
	DocumentationOnly bool `json:"documentation_only,omitempty"`
	// Nil means the catalogue does not provide enough pricing information.
	ZeroPrice *bool `json:"zero_price,omitempty"`
}

// FetchCatalog uses official catalogues, or Z.ai's published free-model pricing.
// Public documentation never receives keys. Errors exclude upstream bodies/URLs.
func FetchCatalog(ctx context.Context, client *http.Client, provider, key string) (map[string]CatalogModel, error) {
	endpoint, supported := catalogEndpoints[provider]
	if !supported {
		return nil, errors.New("unsupported catalogue provider")
	}
	if key == "" && provider != ai.ProviderOpenRouter && provider != ai.ProviderZAI {
		return nil, fmt.Errorf("%s account key is missing", provider)
	}
	models := make(map[string]CatalogModel)
	for page := 0; page < 10; page++ {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return nil, fmt.Errorf("%s catalogue request could not be created", provider)
		}
		if key != "" && provider != ai.ProviderZAI {
			if provider == ai.ProviderGemini {
				request.Header.Set("x-goog-api-key", key)
			} else {
				request.Header.Set("Authorization", "Bearer "+key)
			}
		}
		response, err := client.Do(request)
		if err != nil {
			return nil, fmt.Errorf("%s catalogue request failed", provider)
		}
		if response.StatusCode != http.StatusOK {
			response.Body.Close()
			return nil, fmt.Errorf("%s catalogue returned HTTP %d", provider, response.StatusCode)
		}
		body, err := io.ReadAll(io.LimitReader(response.Body, maxCatalogBytes+1))
		response.Body.Close()
		if err != nil || len(body) > maxCatalogBytes {
			return nil, fmt.Errorf("%s catalogue could not be read within its size limit", provider)
		}
		if provider == ai.ProviderZAI {
			return zaiFreePricing(body)
		}
		var next string
		if provider == ai.ProviderGemini {
			var catalog struct {
				Models []struct {
					Name    string   `json:"name"`
					Methods []string `json:"supportedGenerationMethods"`
				} `json:"models"`
				NextPageToken string `json:"nextPageToken"`
			}
			if err := json.Unmarshal(body, &catalog); err != nil {
				return nil, errors.New("gemini catalogue returned invalid JSON")
			}
			for _, current := range catalog.Models {
				id := strings.TrimPrefix(current.Name, "models/")
				models[id] = CatalogModel{ID: id, SupportsText: contains(current.Methods, "generateContent")}
			}
			if catalog.NextPageToken != "" {
				parsed, _ := url.Parse(catalogEndpoints[provider])
				query := parsed.Query()
				query.Set("pageToken", catalog.NextPageToken)
				parsed.RawQuery = query.Encode()
				next = parsed.String()
			}
		} else {
			var catalog struct {
				Data []struct {
					ID            string                     `json:"id"`
					Active        *bool                      `json:"active"`
					ContextWindow *int                       `json:"context_window"`
					Pricing       map[string]json.RawMessage `json:"pricing"`
					Architecture  struct {
						Inputs []string `json:"input_modalities"`
					} `json:"architecture"`
					Capabilities struct {
						Chat *bool `json:"completion_chat"`
					} `json:"capabilities"`
				} `json:"data"`
			}
			if err := json.Unmarshal(body, &catalog); err != nil {
				return nil, fmt.Errorf("%s catalogue returned invalid JSON", provider)
			}
			for _, current := range catalog.Data {
				if current.Active != nil && !*current.Active {
					continue
				}
				model := CatalogModel{ID: current.ID, SupportsText: true}
				switch provider {
				case ai.ProviderOpenRouter:
					model.SupportsText = contains(current.Architecture.Inputs, "text")
					model.ZeroPrice = catalogZeroPrices(current.Pricing)
				case ai.ProviderMistral:
					model.SupportsText = current.Capabilities.Chat != nil && *current.Capabilities.Chat
				case ai.ProviderGroq:
					model.SupportsText = current.ContextWindow != nil && *current.ContextWindow > 0 &&
						!strings.HasPrefix(current.ID, "whisper-") && !strings.HasPrefix(current.ID, "canopylabs/orpheus-")
				}
				models[model.ID] = model
			}
		}
		if next == "" {
			return models, nil
		}
		endpoint = next
	}
	return nil, fmt.Errorf("%s catalogue exceeded the pagination limit", provider)
}

func zaiFreePricing(body []byte) (map[string]CatalogModel, error) {
	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), ">"))
		cells := strings.Split(line, "|")
		if len(cells) != 7 || !strings.EqualFold(strings.TrimSpace(cells[1]), ai.ZAIFlashModel) {
			continue
		}
		for _, price := range cells[2:6] {
			if strings.TrimSpace(price) != "Free" {
				return nil, errors.New("zai GLM-4.7-Flash zero pricing could not be confirmed")
			}
		}
		zero := true
		return map[string]CatalogModel{
			ai.ZAIFlashModel: {ID: ai.ZAIFlashModel, SupportsText: true, ZeroPrice: &zero, DocumentationOnly: true},
		}, nil
	}
	return nil, errors.New("zai GLM-4.7-Flash is missing from published free-model pricing")
}

func catalogZeroPrices(prices map[string]json.RawMessage) *bool {
	values := make(map[string]string, len(prices))
	for name, raw := range prices {
		var value string
		if err := json.Unmarshal(raw, &value); err != nil {
			var number json.Number
			if err := json.Unmarshal(raw, &number); err != nil {
				// Price overrides and other structured charges remain unconfirmed.
				return nil
			}
			value = number.String()
		}
		values[name] = value
	}
	return zeroPrices(values)
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

// Decimal arithmetic prevents a tiny positive price being rounded down to zero.
func zeroPrices(prices map[string]string) *bool {
	if prices["prompt"] == "" || prices["completion"] == "" {
		return nil
	}
	zero := true
	for _, raw := range prices {
		price, valid := new(big.Rat).SetString(raw)
		if !valid {
			return nil
		}
		if price.Sign() != 0 {
			zero = false
		}
	}
	return &zero
}
