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
		want := "Core PADI personality traits: warm, witty, intelligent, emotionally aware."
		expected := os.Getenv("PADI_PERSONALITY_TEST_GUIDANCE")
		enabled := os.Getenv("PADI_PERSONALITY_TEST_WARMTH") == "enabled"
		if enabled && expected == "" {
			t.Fatal("independent Python export did not supply warmth guidance")
		}
		if !enabled {
			want = "Core PADI personality traits: witty, intelligent, emotionally aware."
		}
		for _, delivery := range []string{"text", "voice", "StreamVoice"} {
			for _, scenario := range []struct {
				name, text string
				humour     personality.HumourPreference
				suppress   bool
			}{
				{"casual", "I'm doing laundry and listening to music.", personality.HumourOccasional, false},
				{"humour off", "I opened the fridge again hoping dinner would appear.", personality.HumourOff, true},
				{"grief", "My father died yesterday. Please just listen.", personality.HumourFrequent, true},
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
						StyleGuidance:  personality.ResponseGuidance(scenario.text, p),
						SuppressHumour: !personality.Assess(scenario.text, p).HumourAllowed,
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
					if !strings.Contains(system, want) {
						t.Fatal("provider lost the other configured trait values")
					}
					if enabled && strings.Count(system, expected) != 1 {
						t.Fatal("provider changed, duplicated, or dropped the exact independently exported Python guidance")
					}
					if !enabled && (strings.Contains(system, "Warmth:") || strings.Contains(system, "Python bridge boundary")) {
						t.Fatal("provider received disabled warmth behaviour")
					}
					if strings.Contains(system, padiHumourInstructions) == scenario.suppress ||
						strings.Contains(system, "This turn calls for a straightforward response") != scenario.suppress {
						t.Fatal("warmth integration changed humour suppression")
					}
					if scenario.name == "grief" && (!strings.Contains(system, "Conversation signal: empathetic.") ||
						!strings.Contains(system, "The user requested listening or company.") ||
						!strings.Contains(system, "Grief, trauma, danger, and painful experiences always take priority")) {
						t.Fatal("provider lost serious-context signals or safety rules")
					}
				})
			}
		}
		return
	}

	// Fresh processes exercise the startup cache with each actual Python configuration.
	for _, mode := range []string{"enabled", "disabled"} {
		t.Run(mode, func(t *testing.T) {
			root := t.TempDir()
			packageDir := filepath.Join(root, "padi_personality")
			for _, name := range []string{"__init__.py", "core.py", "personality_config.py",
				"personalities/__init__.py", "personalities/best_friend.py", "personalities/emotional_intelligence.py",
				"personalities/comedian.py", "personalities/intellectual.py",
				"conversation/__init__.py", "conversation/response_style.py", "conversation/understanding.py",
				"emotions/__init__.py", "emotions/emotion_recognition.py", "emotions/emotional_responses.py",
				"humour/__init__.py", "humour/jokes.py", "humour/playful_teasing.py", "humour/storytelling.py"} {
				source, err := os.ReadFile(filepath.Join("..", "..", "..", "services", "padi_personality", name))
				if err != nil {
					t.Fatal(err)
				}
				if name == "personality_config.py" {
					warm := "True"
					if mode == "disabled" {
						warm = "False"
					}
					source = append(source, []byte("\nPADI_PERSONALITY_CONFIG = PersonalityConfig(warm="+warm+", funny=False, playful=False)\n")...)
				}
				if name == "personalities/best_friend.py" {
					source = append(source, []byte("\nWARMTH_GUIDANCE += '\\n  Python bridge boundary: exact wording 🙂  \\n'\n")...)
				}
				target := filepath.Join(packageDir, name)
				if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(target, source, 0o600); err != nil {
					t.Fatal(err)
				}
			}
			python, err := exec.LookPath("python3")
			if err != nil {
				python, err = exec.LookPath("python")
			}
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			// Independently export Python's exact text before asking Go to load it.
			export := exec.CommandContext(ctx, python, "-I", "-B", "-c",
				"import sys; sys.path.insert(0, sys.argv[1]); from padi_personality.core import export_personality; sys.stdout.write(export_personality()['warmth_guidance'])", root)
			expected, err := export.Output()
			if err != nil {
				t.Fatal(err)
			}
			command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestPythonPersonalityConfigurationReachesProvider$", "-test.v")
			command.Env = append(os.Environ(), "PADI_PERSONALITY_TEST_PROCESS=true", "PADI_PERSONALITY_ROOT="+root,
				"PADI_PERSONALITY_TEST_WARMTH="+mode, "PADI_PERSONALITY_TEST_GUIDANCE="+string(expected))
			output, err := command.CombinedOutput()
			if err != nil {
				t.Fatalf("Python-to-provider integration failed: %v\n%s", err, output)
			}
			t.Logf("%s", output)
		})
	}
}
