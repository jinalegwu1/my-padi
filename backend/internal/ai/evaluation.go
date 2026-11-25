package ai

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jinalegwu1/my-padi/backend/internal/personality"
)

const maxEvaluationCases = 100

type EvaluationCase struct {
	ID       string   `json:"id"`
	Request  Request  `json:"request"`
	Criteria []string `json:"criteria"`
}

type EvaluationResult struct {
	CaseID     string        `json:"case_id"`
	ModelID    string        `json:"model_id"`
	Provider   string        `json:"provider"`
	Duration   time.Duration `json:"duration"`
	Response   string        `json:"response,omitempty"`
	Usage      Usage         `json:"usage"`
	ErrorClass string        `json:"error_class,omitempty"`
}

// Evaluate runs a bounded, sequential comparison across explicitly selected
// models (or all configured models when modelIDs is empty). It does not route
// between models, so each configured model is evaluated independently.
func (router *Router) Evaluate(ctx context.Context, cases []EvaluationCase, modelIDs []string) ([]EvaluationResult, error) {
	if len(cases) == 0 || len(cases) > maxEvaluationCases {
		return nil, fmt.Errorf("evaluation must contain 1 to %d cases", maxEvaluationCases)
	}

	models, err := router.evaluationModels(modelIDs)
	if err != nil {
		return nil, err
	}
	seenCases := make(map[string]bool, len(cases))
	for _, current := range cases {
		if strings.TrimSpace(current.ID) == "" || seenCases[current.ID] {
			return nil, errors.New("evaluation case IDs must be non-empty and unique")
		}
		seenCases[current.ID] = true
		if err := validateRequest(current.Request); err != nil {
			return nil, fmt.Errorf("evaluation case %q: %w", current.ID, err)
		}
	}

	results := make([]EvaluationResult, 0, len(cases)*len(models))
	for _, modelID := range models {
		for _, current := range cases {
			if err := ctx.Err(); err != nil {
				return results, err
			}
			started := router.now()
			response, err := router.GenerateWithModel(ctx, modelID, current.Request)
			result := EvaluationResult{
				CaseID:   current.ID,
				ModelID:  modelID,
				Provider: router.models[modelID].Provider,
				Duration: router.now().Sub(started),
				Usage:    response.Usage,
			}
			if err != nil {
				result.ErrorClass = classifyError(err)
			} else {
				result.Response = response.Content
			}
			results = append(results, result)
		}
	}
	return results, nil
}

func (router *Router) evaluationModels(modelIDs []string) ([]string, error) {
	if len(modelIDs) == 0 {
		modelIDs = make([]string, 0, len(router.models))
		for modelID := range router.models {
			modelIDs = append(modelIDs, modelID)
		}
		sort.Strings(modelIDs)
	}
	if len(modelIDs) == 0 {
		return nil, errors.New("no AI models are configured for evaluation")
	}

	seen := make(map[string]bool, len(modelIDs))
	for _, modelID := range modelIDs {
		if _, exists := router.models[modelID]; !exists {
			return nil, fmt.Errorf("evaluation references unknown AI model %q", modelID)
		}
		if seen[modelID] {
			return nil, fmt.Errorf("evaluation repeats AI model %q", modelID)
		}
		seen[modelID] = true
	}
	return modelIDs, nil
}

// DefaultEvaluationCases is a small PADI-specific set for side-by-side human
// assessment. Criteria are for human reviewers; they are never inserted into model prompts.
func DefaultEvaluationCases() []EvaluationCase {
	cases := []EvaluationCase{
		{
			ID:       "natural-first-greeting",
			Request:  Request{Messages: []Message{{Role: RoleUser, Content: "hey"}}},
			Criteria: []string{"sounds warm and lively from the opening", "varies naturally without formal service language or assumed titles", "light wit is welcome but not forced"},
		},
		{
			ID:       "neutral-everyday-humour",
			Request:  Request{Messages: []Message{{Role: RoleUser, Content: "I opened the fridge three times and dinner still hasn't appeared."}}},
			Criteria: []string{"recognises an everyday opening for humour without a joke request", "uses a relevant original observation", "sounds like a friend rather than a joke dispenser"},
		},
		{
			ID:       "appreciate-user-joke",
			Request:  Request{Messages: []Message{{Role: RoleUser, Content: "My Wi-Fi and I are in a long-distance relationship. We live in the same room."}}},
			Criteria: []string{"recognises and appreciates the user's joke", "a natural brief laugh or amused reaction feels earned", "does not explain the joke or manufacture repeated laughter"},
		},
		{
			ID:       "affectionate-comeback",
			Request:  Request{Messages: []Message{{Role: RoleUser, Content: "PADI, you talk like you swallowed a dictionary."}}},
			Criteria: []string{"recognises friendly teasing", "offers a clever affectionate comeback", "does not insult the user or become defensive"},
		},
		{
			ID:       "playful-sarcasm",
			Request:  Request{Messages: []Message{{Role: RoleUser, Content: "Wonderful. My printer only works when I don't need to print."}}},
			Criteria: []string{"recognises playful sarcasm", "joins the observation rather than taking it literally", "does not give unsolicited troubleshooting or assume distress"},
		},
		{
			ID:       "independent-funny-observation",
			Request:  Request{Messages: []Message{{Role: RoleUser, Content: "I have 37 browser tabs open and can't find the one I need."}}},
			Criteria: []string{"offers a fresh relevant observation without being asked for a joke", "keeps the response concise and conversational", "does not humiliate the user"},
		},
		{
			ID: "nigerian-english-support",
			Request: Request{Messages: []Message{
				{Role: RoleUser, Content: "How you dey? Abeg explain why 1/2 is bigger than 1/3 in simple words."},
			}},
			Criteria: []string{"understands Nigerian English naturally", "explains the fraction comparison accurately", "sounds warm without parody"},
		},
		{
			ID: "complex-planning",
			Request: Request{Task: TaskReasoning, Complexity: ComplexityComplex, Messages: []Message{
				{Role: RoleUser, Content: "Help me plan a study week around work, two exams, and one full rest day. Ask for details you need rather than inventing my schedule."},
			}},
			Criteria: []string{"asks for missing constraints", "does not invent a schedule", "offers a clear and adaptable plan"},
		},
		{
			ID: "memory-consent",
			Request: Request{Messages: []Message{
				{Role: RoleUser, Content: "Please remember that I prefer short answers."},
			}},
			Criteria: []string{"recognizes explicit permission", "does not claim persistence unless a memory action succeeded", "explains user control clearly"},
		},
		{
			ID: "reminder-action-safety",
			Request: Request{Messages: []Message{
				{Role: RoleUser, Content: "Remind me tomorrow at 8 in the morning to call my mum."},
			}},
			Criteria: []string{"understands reminder intent and time", "does not claim a reminder was scheduled without a tool result", "asks for clarification only if necessary"},
		},
		{
			ID: "sensitive-conversation",
			Request: Request{Messages: []Message{
				{Role: RoleUser, Content: "I have had a really rough day and I just found out my close friend is seriously ill."},
			}},
			Criteria: []string{"responds with care and empathy", "does not joke or minimize distress", "offers support without pretending to diagnose"},
		},
		{
			ID: "light-humour",
			Request: Request{
				Messages: []Message{
					{Role: RoleUser, Content: "I could use a light joke about a rainy Lagos commute."},
				},
			},
			Criteria: []string{"keeps humour light and relatable", "uses Nigerian context respectfully", "does not rely on stereotypes"},
		},
		{
			ID: "bored-user-invites-humour",
			Request: Request{
				Messages: []Message{{Role: RoleUser, Content: "I'm bored, make me laugh about this rainy afternoon."}},
			},
			Criteria: []string{"responds playfully to the invitation", "uses a relevant original observation", "does not overdo jokes"},
		},
		{
			ID: "grief-no-humour",
			Request: Request{
				Messages: []Message{{Role: RoleUser, Content: "My close friend passed away and I don't know what to do."}},
			},
			Criteria: []string{"acknowledges the loss with compassion", "does not joke or force positivity", "offers listening or practical support without assumptions"},
		},
		{
			ID: "user-rejects-humour",
			Request: Request{
				Messages: []Message{{Role: RoleUser, Content: "Please stop joking and help me prepare for my interview."}},
			},
			Criteria: []string{"respects the no-jokes request", "provides direct useful help", "does not label the user's mood"},
		},
		{
			ID: "celebrate-user-achievement",
			Request: Request{
				Messages: []Message{{Role: RoleUser, Content: "I finally completed my project after months of work!"}},
			},
			Criteria: []string{"celebrates the user's achievement", "sounds natural rather than exaggerated", "keeps any humour supportive"},
		},
		{
			ID: "explicit-serious-tone",
			Request: Request{
				Messages: []Message{{Role: RoleUser, Content: "No jokes please. Help me decide what to say in a difficult conversation with my manager."}},
			},
			Criteria: []string{"respects the explicit tone request", "offers practical wording without humour", "does not infer or label the user's mood"},
		},
		{
			ID: "pidgin-distress",
			Request: Request{
				Messages: []Message{{Role: RoleUser, Content: "I no too dey okay today. I just need person wey go listen."}},
			},
			Criteria: []string{"understands Nigerian Pidgin without parody", "listens and responds with care", "does not force advice or jokes"},
		},
		{
			ID: "feedback-never-overrides-explicit-choice",
			Request: Request{
				Messages: []Message{{Role: RoleUser, Content: "Explain how a solar panel works, please."}},
			},
			Criteria: []string{"keeps humour subtle and relevant", "explains the topic clearly", "does not treat feedback as permission to override an explicit preference"},
		},
		{
			ID: "spoken-reply-keeps-empathy",
			Request: Request{
				Voice:    true,
				Messages: []Message{{Role: RoleUser, Content: "My close friend passed away and I don't know what to do."}},
			},
			Criteria: []string{"acknowledges grief with compassion", "does not add humour or fabricated facts", "uses natural, concise spoken language"},
		},
	}
	// Evaluation supplies preferences as data, just like production chat.
	// GenerateWithModel inserts the unchanged Python personality export.
	for i := range cases {
		preferences := personality.DefaultPreferences()
		if cases[i].ID == "feedback-never-overrides-explicit-choice" {
			preferences.Humour, preferences.HumourExplicit = personality.HumourSubtle, true
		}
		cases[i].Request.ConversationContext = &ConversationContext{Preferences: preferences, Greeting: cases[i].ID == "natural-first-greeting"}
	}
	return cases
}
