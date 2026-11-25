package ai

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPythonPersonalityConfigurationReachesProvider(t *testing.T) {
	if os.Getenv("PADI_PERSONALITY_TEST_PROCESS") == "true" {
		provider := &fakeProvider{response: Response{Content: "Hello."}}
		router := testRouter(t,
			[]ModelConfig{{ID: "main", Provider: "test", Model: "test-model"}},
			map[string]Provider{"test": provider},
			RoutingConfig{PrimaryModel: "main"}, nil)
		want := "Core PADI personality traits: warm, witty, intelligent, emotionally aware."
		for _, voice := range []bool{false, true} {
			if _, err := router.Generate(context.Background(), Request{
				Voice: voice, Messages: []Message{{Role: RoleUser, Content: "Hello."}},
			}); err != nil {
				t.Fatalf("Generate(voice=%t) error = %v", voice, err)
			}
			provider.mu.Lock()
			request := provider.lastRequest
			provider.mu.Unlock()
			if len(request.Messages) == 0 || request.Messages[0].Role != RoleSystem ||
				!strings.Contains(request.Messages[0].Content, "\n\n"+want+"\n\n") {
				t.Fatalf("provider did not receive the modified Python configuration: %+v", request.Messages)
			}
			t.Logf("Python configuration reached provider (voice=%t): %s", voice, want)
		}
		return
	}

	// A fresh process avoids the startup cache. Copy only configuration wiring;
	// successful generation must not require any unfinished personality engine.
	root := t.TempDir()
	packageDir := filepath.Join(root, "padi_personality")
	if err := os.Mkdir(packageDir, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"__init__.py", "core.py", "personality_config.py"} {
		source, err := os.ReadFile(filepath.Join("..", "..", "..", "services", "padi_personality", name))
		if err != nil {
			t.Fatal(err)
		}
		if name == "personality_config.py" {
			source = append(source, []byte("\nPADI_PERSONALITY_CONFIG = PersonalityConfig(funny=False, playful=False)\n")...)
		}
		if err := os.WriteFile(filepath.Join(packageDir, name), source, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestPythonPersonalityConfigurationReachesProvider$", "-test.v")
	command.Env = append(os.Environ(), "PADI_PERSONALITY_TEST_PROCESS=true", "PADI_PERSONALITY_ROOT="+root)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("Python-to-provider integration failed: %v\n%s", err, output)
	}
	t.Logf("%s", output)
}
