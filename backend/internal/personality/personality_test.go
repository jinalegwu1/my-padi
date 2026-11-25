package personality

import "testing"

func TestDefaultCoreSettingsAreAvailableAsGuidance(t *testing.T) {
	settings := DefaultCoreSettings()
	if !settings.Warm || !settings.Funny || !settings.Witty ||
		!settings.Intelligent || !settings.Playful || !settings.EmotionallyAware {
		t.Fatalf("default core settings = %+v, want all PADI core traits enabled", settings)
	}
	want := settings.WarmthGuidance
	if settings.WarmthGuidance == "" {
		t.Fatal("Python warmth guidance missing")
	}
	if got := settings.Guidance(); got != want {
		t.Fatalf("Guidance() = %q, want %q", got, want)
	}
	if got := (CoreSettings{}).Guidance(); got != "" {
		t.Fatalf("empty settings Guidance() = %q, want empty", got)
	}
}

func TestCoreGuidanceDoesNotDeliverDisabledWarmth(t *testing.T) {
	settings := DefaultCoreSettings()
	settings.Warm = false
	settings.WarmthGuidance = ""
	if got := settings.Guidance(); got != "" {
		t.Fatalf("disabled warmth changed other trait guidance: %q", got)
	}
}
