package ai

import (
	"strings"
	"testing"

	"github.com/jinalegwu1/my-padi/backend/internal/personality"
)

func TestPersonalityFoundationIsSharedByTextAndVoice(t *testing.T) {
	for _, voice := range []bool{false, true} {
		request := Request{Voice: voice, Messages: []Message{{Role: RoleUser, Content: "My fridge has food but nothing I want to eat."}},
			StyleGuidance: personality.ResponseGuidance("My fridge has food but nothing I want to eat.", personality.DefaultPreferences())}
		got := withPADIInstructions(request)
		for _, rule := range []string{
			"funny best friend", "including neutral conversations", "unexpected comparisons",
			"genuinely funny comments", "never attach laughter automatically", "affectionate comebacks",
			"social intent", "sarcasm", "not a complaint requiring an apology", "one to three short sentences",
			"Vary the wording", "age- or gender-based titles", "do not assume",
			"Grief, trauma, danger, and painful experiences always take priority",
			"Humour is welcome", "Use occasional, light wit", "speech system supports it",
		} {
			if !strings.Contains(got.Messages[0].Content, rule) {
				t.Errorf("voice=%t missing personality rule %q", voice, rule)
			}
		}
		if got.Voice != voice {
			t.Fatal("personality injection changed delivery")
		}
		if voice && !strings.HasSuffix(got.Messages[0].Content, "convey amusement with words instead.") {
			t.Fatal("spoken delivery must retain explicit speech capability limits after shared style guidance")
		}
	}
}
