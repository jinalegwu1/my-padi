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
	if strings.TrimSpace(settings.WarmthGuidance) == "" {
		t.Fatal("enabled Python warmth did not supply behaviour guidance")
	}
	encoded, err := json.Marshal(settings)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("Loaded from padi_personality.core: %s", encoded)
}

func TestDecodeCoreSettingsRequiresSixExplicitBooleans(t *testing.T) {
	valid := `{"traits":{"warm":true,"funny":false,"witty":true,"intelligent":true,"playful":false,"emotionally_aware":true},"warmth_guidance":"Python warmth."}`
	settings, err := decodeCoreSettings([]byte(valid))
	if err != nil || settings.Funny || settings.Playful || !settings.EmotionallyAware {
		t.Fatalf("explicit false settings lost: settings=%+v error=%v", settings, err)
	}
	for _, test := range []struct {
		name, output string
	}{
		{"missing trait", strings.Replace(valid, `,"emotionally_aware":true`, "", 1)},
		{"unknown trait", strings.Replace(valid, `"emotionally_aware"`, `"unknown"`, 1)},
		{"extra trait", strings.Replace(valid, `"emotionally_aware":true}`, `"emotionally_aware":true,"unknown":true}`, 1)},
		{"null trait", strings.Replace(valid, `"warm":true`, `"warm":null`, 1)},
		{"string trait", strings.Replace(valid, `"warm":true`, `"warm":"true"`, 1)},
		{"number trait", strings.Replace(valid, `"warm":true`, `"warm":1`, 1)},
		{"duplicate trait", strings.Replace(valid, `"warm":true`, `"warm":false,"warm":true`, 1)},
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

func TestDecodeCoreSettingsValidatesWarmthExport(t *testing.T) {
	const traits = `{"warm":true,"funny":true,"witty":true,"intelligent":true,"playful":true,"emotionally_aware":true}`
	const valid = `{"traits":` + traits + `,"warmth_guidance":"  Python guidance.\nKeep exact wording: 🙂  "}`
	const expected = "  Python guidance.\nKeep exact wording: 🙂  "
	settings, err := decodeCoreSettings([]byte(valid))
	if err != nil || settings.WarmthGuidance != expected {
		t.Fatalf("Python wording changed: settings=%+v error=%v", settings, err)
	}
	disabledTraits := strings.Replace(traits, `"warm":true`, `"warm":false`, 1)
	disabled := `{"traits":` + disabledTraits + `,"warmth_guidance":""}`
	settings, err = decodeCoreSettings([]byte(disabled))
	if err != nil || settings.Warm || settings.WarmthGuidance != "" ||
		!settings.Funny || !settings.Witty || !settings.Intelligent || !settings.Playful || !settings.EmotionallyAware {
		t.Fatalf("disabled warmth changed other traits: settings=%+v error=%v", settings, err)
	}
	for _, test := range []struct {
		name, output, wantError string
	}{
		{"empty output", "", "decode Python personality export"},
		{"invalid JSON", `{`, "decode Python personality export"},
		{"non-object export", `[]`, "expected a JSON object"},
		{"missing traits", `{"warmth_guidance":"Python warmth."}`, "exactly traits and warmth_guidance"},
		{"missing enabled guidance", `{"traits":` + traits + `}`, "exactly traits and warmth_guidance"},
		{"missing disabled guidance", `{"traits":` + disabledTraits + `}`, "exactly traits and warmth_guidance"},
		{"null traits", `{"traits":null,"warmth_guidance":"Python warmth."}`, "decode Python personality traits"},
		{"array traits", `{"traits":[],"warmth_guidance":"Python warmth."}`, "decode Python personality traits"},
		{"unknown export field", strings.Replace(valid, `"traits":`, `"unexpected":true,"traits":`, 1), "exactly traits and warmth_guidance"},
		{"duplicate traits field", strings.Replace(valid, `"traits":`, `"traits":{},"traits":`, 1), "duplicate JSON key"},
		{"duplicate guidance field", `{"traits":` + traits + `,"warmth_guidance":"","warmth_guidance":"Python warmth."}`, "duplicate JSON key"},
		{"null guidance", `{"traits":` + traits + `,"warmth_guidance":null}`, "requires string warmth_guidance"},
		{"boolean guidance", `{"traits":` + traits + `,"warmth_guidance":true}`, "requires string warmth_guidance"},
		{"number guidance", `{"traits":` + traits + `,"warmth_guidance":1}`, "requires string warmth_guidance"},
		{"object guidance", `{"traits":` + traits + `,"warmth_guidance":{}}`, "requires string warmth_guidance"},
		{"array guidance", `{"traits":` + traits + `,"warmth_guidance":[]}`, "requires string warmth_guidance"},
		{"empty enabled guidance", `{"traits":` + traits + `,"warmth_guidance":""}`, "warmth enabled requires non-empty"},
		{"whitespace enabled guidance", `{"traits":` + traits + `,"warmth_guidance":" \n\t "}`, "warmth enabled requires non-empty"},
		{"non-empty disabled guidance", strings.Replace(valid, `"warm":true`, `"warm":false`, 1), "warmth disabled requires empty"},
		{"whitespace disabled guidance", `{"traits":` + disabledTraits + `,"warmth_guidance":" "}`, "warmth disabled requires empty"},
		{"trailing output", valid + "\n{}", "unexpected trailing output"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := decodeCoreSettings([]byte(test.output)); err == nil || !strings.Contains(err.Error(), test.wantError) {
				t.Fatalf("error=%v, want clear rejection containing %q", err, test.wantError)
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
