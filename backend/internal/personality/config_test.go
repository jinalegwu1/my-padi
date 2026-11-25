package personality

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func TestPythonPersonalityConfigurationIsLoaded(t *testing.T) {
	settings, err := LoadCoreSettings()
	if err != nil {
		t.Fatalf("LoadCoreSettings() error = %v", err)
	}
	if !settings.Warm || !settings.Funny || !settings.Witty ||
		!settings.Intelligent || !settings.Playful || !settings.EmotionallyAware {
		t.Fatalf("Python core settings = %+v, want all six traits enabled", settings)
	}
	encoded, err := json.Marshal(settings)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("Loaded from padi_personality.core: %s", encoded)
}

func TestDecodeCoreSettingsRequiresSixExplicitBooleans(t *testing.T) {
	valid := `{"warm":true,"funny":false,"witty":true,"intelligent":true,"playful":false,"emotionally_aware":true}`
	settings, err := decodeCoreSettings([]byte(valid))
	if err != nil || settings.Funny || settings.Playful || !settings.EmotionallyAware {
		t.Fatalf("explicit false settings lost: settings=%+v error=%v", settings, err)
	}
	for _, test := range []struct {
		name, output string
	}{
		{"missing trait", strings.Replace(valid, `,"emotionally_aware":true`, "", 1)},
		{"unknown trait", strings.Replace(valid, `"emotionally_aware"`, `"unknown"`, 1)},
		{"extra trait", strings.Replace(valid, "}", `,"unknown":true}`, 1)},
		{"null trait", strings.Replace(valid, `"warm":true`, `"warm":null`, 1)},
		{"string trait", strings.Replace(valid, `"warm":true`, `"warm":"true"`, 1)},
		{"number trait", strings.Replace(valid, `"warm":true`, `"warm":1`, 1)},
		{"null configuration", "null"},
		{"trailing output", valid + "\n{}"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := decodeCoreSettings([]byte(test.output)); err == nil {
				t.Fatalf("accepted invalid Python output: %s", test.output)
			}
		})
	}
}

func TestPythonConfigurationExecutionErrorsAreReturned(t *testing.T) {
	python, err := personalityPython()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := loadPythonCoreSettings(context.Background(), python, t.TempDir()); err == nil {
		t.Fatal("missing Python configuration was silently replaced with defaults")
	}
	if _, err := loadPythonCoreSettings(context.Background(), filepath.Join(t.TempDir(), "missing-python"), t.TempDir()); err == nil {
		t.Fatal("missing interpreter was silently replaced with defaults")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := loadPythonCoreSettings(ctx, python, t.TempDir()); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled configuration load error = %v, want context.Canceled", err)
	}
}
