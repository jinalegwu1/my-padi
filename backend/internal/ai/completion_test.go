package ai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestProviderCompletionMetadataRejectsTruncatedReplies(t *testing.T) {
	t.Setenv("PADI_COMPLETION_KEY", "synthetic-key")
	for _, provider := range []string{ProviderGroq, ProviderOpenAICompatible, ProviderOpenRouter, ProviderMistral, ProviderZAI, ProviderGemini, ProviderAnthropic} {
		for _, scenario := range []string{"complete", "length", "missing finish", "dangling clause"} {
			t.Run(provider+"/"+scenario, func(t *testing.T) {
				content, reason := "Nice! Which phone did you get?", "stop"
				if scenario == "length" || scenario == "dangling clause" {
					content = "That's great news—"
				}
				if scenario == "length" {
					reason = "length"
				}
				if scenario == "missing finish" {
					reason = ""
				}
				var payload any
				switch provider {
				case ProviderGemini:
					if reason == "stop" {
						reason = "STOP"
					}
					if reason == "length" {
						reason = "MAX_TOKENS"
					}
					payload = map[string]any{"candidates": []any{map[string]any{"finishReason": reason, "content": map[string]any{"parts": []any{map[string]string{"text": content}}}}}}
				case ProviderAnthropic:
					if reason == "stop" {
						reason = "end_turn"
					}
					if reason == "length" {
						reason = "max_tokens"
					}
					payload = map[string]any{"stop_reason": reason, "content": []any{map[string]string{"type": "text", "text": content}}}
				default:
					payload = map[string]any{"choices": []any{map[string]any{"finish_reason": reason, "message": map[string]string{"content": content}}}}
				}
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _ = json.NewEncoder(w).Encode(payload) }))
				defer server.Close()
				result, err := NewProviderAdapters(server.Client())[provider].Generate(context.Background(), ModelConfig{Provider: provider, Model: "test-model", Endpoint: server.URL, APIKeyEnv: "PADI_COMPLETION_KEY"}, Request{Messages: []Message{{Role: RoleUser, Content: "PADI, I bought a new phone today."}}})
				if scenario == "complete" {
					if err != nil || result.Content != content {
						t.Fatalf("response=%+v error=%v", result, err)
					}
				} else if !errors.Is(err, ErrIncompleteProviderResponse) {
					t.Fatalf("unfinished response accepted: %+v error=%v", result, err)
				}
				if scenario == "length" && !errors.Is(err, ErrOutputTokenLimit) {
					t.Fatalf("output limit was not identified: %v", err)
				}
			})
		}
	}
}

func TestCompletionAllowsLiteralSymbolsAndBriefCompleteReplies(t *testing.T) {
	for _, text := range []string{"Hey!", "Thanks", "-", "—", "A complete paragraph.\n---", "{\"value\":\"a dash—\"}"} {
		if err := validateCompleteText(ProviderGroq, text); err != nil {
			t.Errorf("valid short or structured output rejected: %q: %v", text, err)
		}
	}
	for _, text := range []string{"That's great news—", "That's great news-", "That's great news–"} {
		if err := validateCompleteText(ProviderGroq, text); !errors.Is(err, ErrIncompleteProviderResponse) {
			t.Errorf("dangling clause accepted: %q", text)
		}
	}
}

func TestCompletedRefusalRemainsACompleteResponse(t *testing.T) {
	if err := completionError(ProviderAnthropic, "refusal", true); err != nil {
		t.Fatalf("completed safety refusal treated as an interrupted answer: %v", err)
	}
	if err := validateCompleteText(ProviderAnthropic, "I can't help with that request."); err != nil {
		t.Fatal(err)
	}
}

func TestVoiceProvidersRequireCompletedStreams(t *testing.T) {
	t.Setenv("PADI_COMPLETION_KEY", "synthetic-key")
	for _, provider := range []string{ProviderGroq, ProviderGemini} {
		for _, scenario := range []string{"complete", "EOF", "length", "missing finish", "dangling clause", "missing DONE"} {
			if provider == ProviderGemini && scenario == "missing DONE" {
				continue
			}
			t.Run(provider+"/"+scenario, func(t *testing.T) {
				content, reason := "Nice! Which phone did you get?", "stop"
				if scenario == "dangling clause" || scenario == "length" || scenario == "EOF" {
					content = "That's great news—"
				}
				if scenario == "length" {
					reason = "length"
				}
				if scenario == "EOF" || scenario == "missing finish" {
					reason = ""
				}
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
					w.Header().Set("Content-Type", "text/event-stream")
					var chunk any
					if provider == ProviderGemini {
						if reason == "stop" {
							reason = "STOP"
						}
						if reason == "length" {
							reason = "MAX_TOKENS"
						}
						chunk = map[string]any{"candidates": []any{map[string]any{"finishReason": reason, "content": map[string]any{"parts": []any{map[string]string{"text": content}}}}}}
					} else {
						chunk = map[string]any{"choices": []any{map[string]any{"finish_reason": reason, "delta": map[string]string{"content": content}}}}
					}
					encoded, _ := json.Marshal(chunk)
					_, _ = w.Write(append(append([]byte("data: "), encoded...), []byte("\n\n")...))
					if provider == ProviderGroq && scenario != "EOF" && scenario != "missing DONE" {
						_, _ = w.Write([]byte("data: [DONE]\n\n"))
					}
				}))
				defer server.Close()
				var deltas strings.Builder
				result, err := NewProviderAdapters(server.Client())[provider].(StreamingProvider).Stream(context.Background(), ModelConfig{Provider: provider, Model: "test-model", Endpoint: server.URL, APIKeyEnv: "PADI_COMPLETION_KEY"}, Request{}, func(delta string) error { deltas.WriteString(delta); return nil })
				if scenario == "complete" {
					if err != nil || result.Content != content || deltas.String() != content {
						t.Fatalf("response=%+v error=%v deltas=%q", result, err, deltas.String())
					}
				} else if !errors.Is(err, ErrIncompleteProviderResponse) {
					t.Fatalf("unfinished stream accepted: %+v error=%v", result, err)
				}
			})
		}
	}
}

type completionLimiter struct {
	reserved []int
	charged  []Usage
}

func (l *completionLimiter) Reserve(_ context.Context, _ string, units int, _ UsageLimits, _ time.Time) error {
	l.reserved = append(l.reserved, units)
	return nil
}
func (l *completionLimiter) RecordUsage(_ context.Context, _ string, usage Usage, _ time.Time) error {
	l.charged = append(l.charged, usage)
	return nil
}

type completionProvider struct {
	calls                      int
	budgets                    []int
	alwaysLimited, emitPartial bool
}

func (p *completionProvider) Generate(_ context.Context, _ ModelConfig, request Request) (Response, error) {
	p.calls++
	p.budgets = append(p.budgets, request.MaxOutputTokens)
	if p.calls == 1 || p.alwaysLimited {
		return Response{Content: "That's great news—", Usage: Usage{InputTokens: 100, OutputTokens: request.MaxOutputTokens}}, &ProviderError{Provider: ProviderGroq, Err: errors.Join(ErrIncompleteProviderResponse, ErrOutputTokenLimit)}
	}
	return Response{Content: "Nice! Which phone did you get?", Usage: Usage{InputTokens: 100, OutputTokens: 20}}, nil
}
func (p *completionProvider) Stream(ctx context.Context, model ModelConfig, request Request, onDelta func(string) error) (Response, error) {
	result, err := p.Generate(ctx, model, request)
	if err == nil || p.emitPartial {
		if onDelta != nil {
			if deliveryErr := onDelta(result.Content); deliveryErr != nil {
				return Response{}, deliveryErr
			}
		}
	}
	return result, err
}

func TestCompletionRetryIsBoundedAndNeverMixesSpokenFragments(t *testing.T) {
	for _, scenario := range []struct {
		name                          string
		voice, partial, alwaysLimited bool
		calls                         int
	}{
		{"text recovers", false, false, false, 2}, {"text remains capped", false, false, true, 2},
		{"voice recovers before text", true, false, false, 2}, {"voice partial is interrupted", true, true, false, 1},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			provider := &completionProvider{alwaysLimited: scenario.alwaysLimited, emitPartial: scenario.partial}
			limiter := &completionLimiter{}
			router, err := NewRouterWithUsageLimiter([]ModelConfig{{ID: "main", Provider: ProviderGroq, Model: "openai/gpt-oss-20b"}}, map[string]Provider{ProviderGroq: provider}, RoutingConfig{PrimaryModel: "main", FastModel: "main", VoicePrimaryModel: "main", ApprovedFreeModels: []string{"groq:openai/gpt-oss-20b"}}, nil, limiter)
			if err != nil {
				t.Fatal(err)
			}
			request := Request{MaxOutputTokens: 128, Messages: []Message{{Role: RoleUser, Content: "PADI, I bought a new phone today."}}}
			var result Response
			var spoken strings.Builder
			if scenario.voice {
				result, err = router.StreamVoice(context.Background(), request, func(delta string) error { spoken.WriteString(delta); return nil })
			} else {
				result, err = router.Generate(context.Background(), request)
			}
			if provider.calls != scenario.calls {
				t.Fatalf("calls=%d, want %d", provider.calls, scenario.calls)
			}
			if scenario.partial || scenario.alwaysLimited {
				if !errors.Is(err, ErrIncompleteProviderResponse) || result.Content != "" {
					t.Fatalf("fragment was delivered as complete: %+v error=%v", result, err)
				}
			} else if err != nil || result.Content != "Nice! Which phone did you get?" {
				t.Fatalf("response=%+v error=%v", result, err)
			}
			if scenario.calls == 2 && (provider.budgets[1] <= provider.budgets[0] || len(limiter.charged) != 2 || limiter.charged[0].OutputTokens != 128) {
				t.Fatalf("retry budget or consumed usage lost: budgets=%v charged=%v", provider.budgets, limiter.charged)
			}
			if scenario.voice && !scenario.partial && spoken.String() != result.Content {
				t.Fatalf("voice regenerated after visible text or mixed fragments: %q", spoken.String())
			}
		})
	}
}
