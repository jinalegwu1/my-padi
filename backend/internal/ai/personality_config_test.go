package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jinalegwu1/my-padi/backend/internal/personality"
)

func TestPythonPersonalityConfigurationReachesProvider(t *testing.T) {
	if os.Getenv("PADI_PERSONALITY_TEST_PROCESS") == "true" {
		t.Setenv("PADI_TEST_PERSONALITY_KEY", "synthetic-key")
		var captureMu sync.Mutex
		var captured []Message
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var payload struct {
				Messages []Message `json:"messages"`
				Stream   bool      `json:"stream"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Error(err)
			}
			captureMu.Lock()
			captured = payload.Messages
			captureMu.Unlock()
			if payload.Stream {
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"Hello.\"}}]}\n\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"))
				return
			}
			_, _ = w.Write([]byte(`{"choices":[{"finish_reason":"stop","message":{"content":"Hello."}}]}`))
		}))
		defer server.Close()
		expected := os.Getenv("PADI_PERSONALITY_TEST_GUIDANCE")
		var exported struct {
			Traits map[string]bool `json:"traits"`
		}
		if err := json.Unmarshal([]byte(os.Getenv("PADI_PERSONALITY_TEST_EXPORT")), &exported); err != nil {
			t.Fatal(err)
		}
		settings, err := personality.LoadCoreSettings()
		if err != nil {
			t.Fatal(err)
		}
		actualTraits := map[string]bool{"warm": settings.Warm, "funny": settings.Funny, "witty": settings.Witty, "intelligent": settings.Intelligent, "playful": settings.Playful, "emotionally_aware": settings.EmotionallyAware}
		for trait, want := range exported.Traits {
			if actualTraits[trait] != want {
				t.Fatalf("Go changed exported trait %s", trait)
			}
		}
		for _, delivery := range []string{"text", "voice", "StreamVoice"} {
			for _, scenario := range []struct {
				name, text string
				humour     personality.HumourPreference
			}{
				{"casual", "I'm doing laundry and listening to music.", personality.HumourOccasional},
				{"humour off", "I opened the fridge again hoping dinner would appear.", personality.HumourOff},
				{"grief", "My father died yesterday. Please just listen.", personality.HumourFrequent},
			} {
				t.Run(delivery+"/"+scenario.name, func(t *testing.T) {
					// Each delivery check gets a fresh synthetic usage allowance.
					router := testRouter(t,
						[]ModelConfig{{ID: "main", Provider: ProviderGroq, Model: "openai/gpt-oss-20b", Endpoint: server.URL, APIKeyEnv: "PADI_TEST_PERSONALITY_KEY"}},
						NewProviderAdapters(server.Client()),
						RoutingConfig{PrimaryModel: "main", FastModel: "main", VoicePrimaryModel: "main"}, nil)
					p := personality.DefaultPreferences()
					p.Humour = scenario.humour
					request := Request{
						Voice: delivery != "text",
						Messages: []Message{{Role: RoleUser, Content: "I picked an album for Sunday."},
							{Role: RoleAssistant, Content: "Which album?"}, {Role: RoleUser, Content: scenario.text}},
						ConversationContext: &ConversationContext{Preferences: p},
					}
					var response Response
					var err error
					if delivery == "StreamVoice" {
						var spoken strings.Builder
						response, err = router.StreamVoice(context.Background(), request, func(delta string) error {
							spoken.WriteString(delta)
							return nil
						})
						if err == nil && spoken.String() != "Hello." {
							t.Fatalf("StreamVoice changed delivered text: %q", spoken.String())
						}
					} else {
						response, err = router.Generate(context.Background(), request)
					}
					if err != nil || response.Content != "Hello." {
						t.Fatalf("response=%+v error=%v", response, err)
					}
					captureMu.Lock()
					delivered := captured
					captureMu.Unlock()
					if len(delivered) != 4 || delivered[0].Role != RoleSystem ||
						delivered[1] != request.Messages[0] || delivered[3] != request.Messages[2] {
						t.Fatalf("provider lost conversation context: %+v", delivered)
					}
					system := delivered[0].Content
					assertSystemInstructionBoundary(t, system, expected, request)
				})
			}
		}
		return
	}

	// Each case exports the real protected Python package with an immutable
	// configuration override. No Python file, including a copied module, is edited.
	root, err := filepath.Abs(filepath.Join("..", "..", "..", "services"))
	if err != nil {
		t.Fatal(err)
	}
	python, err := exec.LookPath("python3")
	if err != nil {
		python, err = exec.LookPath("python")
	}
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat("/bin/sh"); err != nil {
		t.Skip("isolated configuration launcher requires /bin/sh")
	}
	cases := []struct{ name, overrides string }{{"enabled", "{}"}}
	for _, trait := range []string{"warm", "funny", "witty", "intelligent", "playful", "emotionally_aware"} {
		cases = append(cases, struct{ name, overrides string }{trait + " disabled", "{\"" + trait + "\":false}"})
	}
	cases = append(cases, struct{ name, overrides string }{"all disabled", `{"warm":false,"funny":false,"witty":false,"intelligent":false,"playful":false,"emotionally_aware":false}`})
	const exportScript = "import json, sys; from dataclasses import replace; sys.path.insert(0, sys.argv[1]); from padi_personality.core import export_personality, PADI_PERSONALITY_CONFIG; print(json.dumps(export_personality(replace(PADI_PERSONALITY_CONFIG, **json.loads(sys.argv[2])))))"
	quote := func(value string) string { return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'" }
	for _, current := range cases {
		t.Run(current.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			export := exec.CommandContext(ctx, python, "-I", "-B", "-c", exportScript, root, current.overrides)
			output, err := export.Output()
			if err != nil {
				t.Fatalf("independent Python export failed: %v", err)
			}
			var exported struct {
				Traits   map[string]bool `json:"traits"`
				Guidance string          `json:"warmth_guidance"`
			}
			if err := json.Unmarshal(output, &exported); err != nil {
				t.Fatal(err)
			}
			launcher := filepath.Join(t.TempDir(), "python-config-launcher")
			contents := "#!/bin/sh\nexec " + quote(python) + " -I -B -c " + quote(exportScript) + " " + quote(root) + " " + quote(current.overrides) + "\n"
			if err := os.WriteFile(launcher, []byte(contents), 0o700); err != nil {
				t.Fatal(err)
			}
			command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestPythonPersonalityConfigurationReachesProvider$", "-test.v")
			command.Env = append(os.Environ(), "PADI_PERSONALITY_TEST_PROCESS=true", "PADI_PERSONALITY_ROOT="+root,
				"PADI_PERSONALITY_PYTHON="+launcher, "PADI_PERSONALITY_TEST_GUIDANCE="+exported.Guidance, "PADI_PERSONALITY_TEST_EXPORT="+string(output))
			result, err := command.CombinedOutput()
			if err != nil {
				t.Fatalf("Python-to-provider integration failed: %v\n%s", err, result)
			}
			t.Logf("%s", result)
		})
	}
}
