package verification

import (
	"github.com/jinalegwu1/my-padi/backend/internal/ai"
	"strings"
	"testing"
)

func TestAgnesPricingRequiresZeroForEveryTrialBillingItem(t *testing.T) {
	const rows = "| `agnes-3.0-flash` | Cached input | $0.005 / M | $0 / M |\n| | Input tokens | $0.05 / M | $0 / M |\n| | Output tokens | $0.15 / M | $0 / M |\n"
	catalog, err := agnesFreePricing([]byte(rows))
	if err != nil || catalog[ai.AgnesFlashModel].ZeroPrice == nil || !*catalog[ai.AgnesFlashModel].ZeroPrice || !catalog[ai.AgnesFlashModel].DocumentationOnly {
		t.Fatalf("invalid free catalogue: %v", err)
	}
	catalog, err = agnesFreePricing([]byte(strings.Replace(rows, "$0 / M", "$0.01 / M", 1)))
	if err != nil || *catalog[ai.AgnesFlashModel].ZeroPrice {
		t.Fatalf("nonzero trial marked free: %v", err)
	}
	if _, err = agnesFreePricing([]byte(rows[:strings.LastIndex(rows, "| | Output tokens")])); err == nil {
		t.Fatal("accepted incomplete pricing")
	}
}
