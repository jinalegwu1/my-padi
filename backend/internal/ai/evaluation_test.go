package ai

import "testing"

func TestDefaultEvaluationCasesCoverPersonalityAndHumourSafety(t *testing.T) {
	required := map[string]bool{
		"natural-first-greeting":                   false,
		"neutral-everyday-humour":                  false,
		"appreciate-user-joke":                     false,
		"affectionate-comeback":                    false,
		"playful-sarcasm":                          false,
		"independent-funny-observation":            false,
		"light-humour":                             false,
		"bored-user-invites-humour":                false,
		"grief-no-humour":                          false,
		"user-rejects-humour":                      false,
		"celebrate-user-achievement":               false,
		"explicit-serious-tone":                    false,
		"pidgin-distress":                          false,
		"feedback-never-overrides-explicit-choice": false,
		"spoken-reply-keeps-empathy":               false,
	}
	for _, current := range DefaultEvaluationCases() {
		if _, ok := required[current.ID]; ok {
			required[current.ID] = len(current.Criteria) >= 3 && current.Request.StyleGuidance != ""
		}
	}
	for id, present := range required {
		if !present {
			t.Errorf("default evaluation case %q is missing criteria or response guidance", id)
		}
	}
}
