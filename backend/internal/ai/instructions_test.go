package ai

import (
	"strings"
	"testing"

	"github.com/jinalegwu1/my-padi/backend/internal/personality"
)

func TestProviderInstructionsLoadConfiguredCorePersonalityTraits(t *testing.T) {
	request := withPADIInstructions(Request{
		Messages: []Message{{Role: RoleUser, Content: "Hello."}},
	})
	if len(request.Messages) == 0 || request.Messages[0].Role != RoleSystem {
		t.Fatalf("provider request messages = %+v, want configured system message", request.Messages)
	}
	for _, trait := range []string{"warm", "funny", "witty", "intelligent", "playful", "emotionally aware"} {
		if !strings.Contains(request.Messages[0].Content, trait) {
			t.Errorf("provider system instructions are missing configured trait %q", trait)
		}
	}
}

func TestPersonalityFoundationIsSharedByTextAndVoice(t *testing.T) {
	for _, voice := range []bool{false, true} {
		request := Request{Voice: voice, Messages: []Message{{Role: RoleUser, Content: "My fridge has food but nothing I want to eat."}},
			StyleGuidance: personality.ResponseGuidance("My fridge has food but nothing I want to eat.", personality.DefaultPreferences())}
		got := withPADIInstructions(request)
		for _, rule := range []string{
			"one consistent AI companion",
			"Core PADI personality traits: warm, funny, witty, intelligent, playful, emotionally aware.",
			"Humour preferences change how often humour appears", "friendly \"how are you?\" small talk",
			"one to three short sentences", "real opening in what the user said",
			"Enjoy a good joke without explaining it", "light, self-directed comeback",
			"Do not reuse a joke or opening already in the conversation",
			"age- or gender-based titles", "do not assume",
			"Grief, trauma, danger, and painful experiences always take priority",
			"A small bit of wit is welcome",
		} {
			if !strings.Contains(got.Messages[0].Content, rule) {
				t.Errorf("voice=%t missing personality rule %q", voice, rule)
			}
		}
		if got.Voice != voice {
			t.Fatal("personality injection changed delivery")
		}
		if voice && (!strings.Contains(got.Messages[0].Content, "Speak naturally with everyday words and contractions") ||
			!strings.HasSuffix(got.Messages[0].Content, "express amusement in words rather than laughter cues.")) {
			t.Fatal("spoken delivery must keep the shared persona and ordinary speech constraints")
		}
		if !voice && !strings.Contains(got.Messages[0].Content, "A small bit of wit is welcome") {
			t.Fatal("text delivery lost the shared humour guidance")
		}
	}
}

func TestDisabledHumourReceivesNoCompetingJokeInstruction(t *testing.T) {
	for _, voice := range []bool{false, true} {
		got := withPADIInstructions(Request{Voice: voice, SuppressHumour: true, Messages: []Message{{Role: RoleUser, Content: "Dinner hasn't appeared in my fridge."}}, StyleGuidance: personality.ResponseGuidance("Dinner hasn't appeared in my fridge.", personality.Preferences{Humour: personality.HumourOff})})
		system := got.Messages[0].Content
		if strings.Contains(system, padiHumourInstructions) ||
			strings.Contains(system, "real opening in what the user said") ||
			!strings.Contains(system, "This turn calls for a straightforward response") ||
			!strings.Contains(system, "Keep PADI warm and personable without jokes or teasing") {
			t.Fatalf("conflicting humour instruction in voice=%t", voice)
		}
	}
}
