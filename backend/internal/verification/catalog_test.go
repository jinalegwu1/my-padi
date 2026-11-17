package verification

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/jinalegwu1/my-padi/backend/internal/ai"
)

type catalogTransport func(*http.Request) (*http.Response, error)

func (transport catalogTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func catalogResponse(body string) *http.Response {
	return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}
}

func TestOpenRouterPricesRequireActualZeroValues(t *testing.T) {
	zero, nonzero := true, false
	cases := []struct {
		name   string
		prices map[string]string
		want   *bool
	}{
		{"zero", map[string]string{"prompt": "0", "completion": "0.000"}, &zero},
		{"paid", map[string]string{"prompt": "0.000001", "completion": "0"}, &nonzero},
		{"tiny_positive", map[string]string{"prompt": "1e-1000", "completion": "0"}, &nonzero},
		{"request_charge", map[string]string{"prompt": "0", "completion": "0", "request": "1"}, &nonzero},
		{"missing_completion", map[string]string{"prompt": "0"}, nil},
		{"invalid_price", map[string]string{"prompt": "unknown", "completion": "0"}, nil},
	}
	for _, current := range cases {
		t.Run(current.name, func(t *testing.T) {
			got := zeroPrices(current.prices)
			if (got == nil) != (current.want == nil) || (got != nil && current.want != nil && *got != *current.want) {
				t.Errorf("zero price = %v; want %v", got, current.want)
			}
		})
	}
}

func TestGeminiCatalogUsesHeadersAndFollowsPagination(t *testing.T) {
	requests := 0
	client := &http.Client{Transport: catalogTransport(func(request *http.Request) (*http.Response, error) {
		requests++
		if request.Header.Get("x-goog-api-key") != "synthetic-key" || strings.Contains(request.URL.String(), "synthetic-key") {
			t.Error("Gemini key was not restricted to the header")
		}
		if requests == 1 {
			return catalogResponse(`{"models":[{"name":"models/first","supportedGenerationMethods":["generateContent"]}],"nextPageToken":"page two"}`), nil
		}
		if request.URL.Query().Get("pageToken") != "page two" {
			t.Error("missing Gemini pagination token")
		}
		return catalogResponse(`{"models":[{"name":"models/embedding","supportedGenerationMethods":["embedContent"]}]}`), nil
	})}
	models, err := FetchCatalog(context.Background(), client, ai.ProviderGemini, "synthetic-key")
	if err != nil {
		t.Fatal(err)
	}
	if requests != 2 || !models["first"].SupportsText || models["embedding"].SupportsText {
		t.Errorf("unexpected paginated catalogue: %+v", models)
	}
	if models["first"].ZeroPrice != nil {
		t.Fatal("inferred Gemini billing eligibility from catalogue availability")
	}
}

func TestOpenRouterCatalogChecksModalitiesAndPricing(t *testing.T) {
	client := &http.Client{Transport: catalogTransport(func(request *http.Request) (*http.Response, error) {
		if request.Header.Get("Authorization") != "Bearer synthetic-key" {
			t.Error("missing account authorization")
		}
		return catalogResponse(`{"data":[{"id":"provider/free","pricing":{"prompt":"0","completion":"0"},"architecture":{"input_modalities":["text"]}},{"id":"provider/paid","pricing":{"prompt":"1","completion":"0"},"architecture":{"input_modalities":["text"]}},{"id":"provider/image","pricing":{"prompt":"0","completion":"0"},"architecture":{"input_modalities":["image"]}}]}`), nil
	})}
	models, err := FetchCatalog(context.Background(), client, ai.ProviderOpenRouter, "synthetic-key")
	if err != nil {
		t.Fatal(err)
	}
	if !models["provider/free"].SupportsText || models["provider/free"].ZeroPrice == nil || !*models["provider/free"].ZeroPrice {
		t.Fatal("free text model not recognized")
	}
	if models["provider/paid"].ZeroPrice == nil || *models["provider/paid"].ZeroPrice {
		t.Fatal("paid model classified as free")
	}
	if models["provider/image"].SupportsText {
		t.Fatal("image-only model classified as a text model")
	}
}

func TestCatalogErrorsDoNotIncludeUpstreamSecrets(t *testing.T) {
	client := &http.Client{Transport: catalogTransport(func(_ *http.Request) (*http.Response, error) {
		response := catalogResponse(`{"error":"synthetic-secret"}`)
		response.StatusCode = http.StatusUnauthorized
		return response, nil
	})}
	_, err := FetchCatalog(context.Background(), client, ai.ProviderGroq, "synthetic-secret")
	if err == nil || strings.Contains(err.Error(), "synthetic-secret") {
		t.Fatalf("unsafe catalogue error: %v", err)
	}
}

func TestOpenRouterPriceOverridesDoNotInvalidateOtherModels(t *testing.T) {
	client := &http.Client{Transport: catalogTransport(func(_ *http.Request) (*http.Response, error) {
		return catalogResponse(`{"data":[{"id":"provider/free","pricing":{"prompt":"0","completion":"0"},"architecture":{"input_modalities":["text"]}},{"id":"provider/overrides","pricing":{"prompt":"0","completion":"0","overrides":[{"prompt":"1"}]},"architecture":{"input_modalities":["text"]}},{"id":"provider/numeric","pricing":{"prompt":1e-1000,"completion":0},"architecture":{"input_modalities":["text"]}}]}`), nil
	})}
	models, err := FetchCatalog(context.Background(), client, ai.ProviderOpenRouter, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 3 || models["provider/free"].ZeroPrice == nil || !*models["provider/free"].ZeroPrice {
		t.Fatalf("valid free model lost because another model has price overrides: %+v", models)
	}
	if models["provider/overrides"].ZeroPrice != nil {
		t.Fatal("model with structured price overrides classified as confirmed free")
	}
	if models["provider/numeric"].ZeroPrice == nil || *models["provider/numeric"].ZeroPrice {
		t.Fatal("tiny positive JSON number rounded down to a free price")
	}
}

func TestGroqAndMistralCatalogsDistinguishTextCapabilities(t *testing.T) {
	cases := []struct {
		provider string
		body     string
	}{
		{ai.ProviderGroq, `{"data":[{"id":"chat","context_window":8192,"active":true},{"id":"audio","context_window":0,"active":true},{"id":"whisper-large-v3","context_window":448,"active":true},{"id":"canopylabs/orpheus-v1-english","context_window":8192,"active":true},{"id":"inactive","context_window":8192,"active":false}]}`},
		{ai.ProviderMistral, `{"data":[{"id":"chat","capabilities":{"completion_chat":true}},{"id":"audio","capabilities":{"completion_chat":false}}]}`},
	}
	for _, current := range cases {
		t.Run(current.provider, func(t *testing.T) {
			client := &http.Client{Transport: catalogTransport(func(request *http.Request) (*http.Response, error) {
				if request.Header.Get("Authorization") != "Bearer synthetic-key" {
					t.Error("missing account authorization")
				}
				return catalogResponse(current.body), nil
			})}
			models, err := FetchCatalog(context.Background(), client, current.provider, "synthetic-key")
			if err != nil {
				t.Fatal(err)
			}
			if !models["chat"].SupportsText || models["audio"].SupportsText {
				t.Errorf("unexpected text capabilities: %+v", models)
			}
			if models["whisper-large-v3"].SupportsText || models["canopylabs/orpheus-v1-english"].SupportsText {
				t.Error("speech models classified as chat models")
			}
			if _, exists := models["inactive"]; exists {
				t.Error("inactive model listed as available")
			}
			if models["chat"].ZeroPrice != nil {
				t.Error("catalogue capability was treated as account pricing evidence")
			}
		})
	}
}

func TestZAIUsesExactPublishedFreeModelWithoutSendingKeysToDocumentation(t *testing.T) {
	cases := []struct {
		name  string
		body  string
		valid bool
	}{
		{"free", "> | GLM-4.7-Flash | Free | Free | Free | Free |", true},
		{"paid output", "> | GLM-4.7-Flash | Free | Free | Free | $0.4 |", false},
		{"flashx only", "> | GLM-4.7-FlashX | Free | Free | Free | Free |", false},
		{"missing cache", "| GLM-4.7-Flash | Free | Free | Free |", false},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			client := &http.Client{Transport: catalogTransport(func(request *http.Request) (*http.Response, error) {
				if request.URL.String() != "https://docs.z.ai/guides/overview/pricing.md" || request.Header.Get("Authorization") != "" {
					t.Error("account credential was sent to public documentation")
				}
				return catalogResponse(test.body), nil
			})}
			models, err := FetchCatalog(context.Background(), client, ai.ProviderZAI, "synthetic-secret")
			if !test.valid {
				if err == nil {
					t.Fatal("unconfirmed or wrong model pricing was accepted")
				}
				return
			}
			model := models[ai.ZAIFlashModel]
			if err != nil || len(models) != 1 || !model.DocumentationOnly || !model.SupportsText || model.ZeroPrice == nil || !*model.ZeroPrice {
				t.Fatalf("incorrect documented free-model evidence: %+v, %v", model, err)
			}
		})
	}
}
