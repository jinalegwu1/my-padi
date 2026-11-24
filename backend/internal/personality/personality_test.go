package personality

import (
	"strings"
	"testing"
)

func TestAssessConversationSignalsWithoutPersistingMood(t *testing.T) {
	tests := []struct {
		name       string
		text       string
		wantMode   string
		wantHumour bool
	}{
		{name: "direct joke request", text: "I'm bored, make me laugh.", wantMode: "playful", wantHumour: true},
		{name: "celebration", text: "I finally completed my project!", wantMode: "celebratory", wantHumour: true},
		{name: "frustration", text: "Everything is going wrong today.", wantMode: "empathetic"},
		{name: "grief overrides joke request", text: "My father died. Tell me a joke.", wantMode: "empathetic"},
		{name: "explicit serious request", text: "Stop joking and be serious.", wantMode: "serious"},
		{name: "neutral conversation", text: "Can you explain how rain forms?", wantMode: "friendly", wantHumour: true},
		{name: "first greeting", text: "Hello PADI!", wantMode: "friendly", wantHumour: true},
		{name: "everyday situation", text: "I opened the fridge three times and dinner still hasn't appeared.", wantMode: "friendly", wantHumour: true},
		{name: "user joke", text: "My Wi-Fi and I are in a long-distance relationship. We live in the same room.", wantMode: "friendly", wantHumour: true},
		{name: "figurative laughter", text: "I died laughing at my own mistake.", wantMode: "friendly", wantHumour: true},
		{name: "dead phone", text: "My phone died just as I needed the map.", wantMode: "friendly", wantHumour: true},
		{name: "friendly teasing", text: "PADI, you talk like you swallowed a dictionary.", wantMode: "friendly", wantHumour: true},
		{name: "serious wording", text: "Please give me a serious response about my interview.", wantMode: "serious"},
		{name: "pidgin distress", text: "I no too dey okay today. I need person wey go listen.", wantMode: "serious"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			result := Assess(test.text, DefaultPreferences())
			if result.Mode != test.wantMode || result.HumourAllowed != test.wantHumour {
				t.Fatalf("Assess() = %+v, want mode %q humour %t", result, test.wantMode, test.wantHumour)
			}
		})
	}
}

func TestHumourLevelsGuideFrequencyWithoutDisablingEverydayWarmth(t *testing.T) {
	for _, tone := range []TonePreference{ToneAdaptive, ToneGentle, TonePlayful} {
		for _, test := range []struct {
			level   HumourPreference
			want    string
			allowed bool
		}{
			{HumourOff, "Humour is not appropriate", false},
			{HumourSubtle, "Keep humour subtle", true},
			{HumourOccasional, "Use occasional, light wit", true},
			{HumourFrequent, "Use wit more often", true},
		} {
			t.Run(string(tone)+"/"+string(test.level), func(t *testing.T) {
				p := Preferences{Humour: test.level, Tone: tone, HumourExplicit: true}
				if Assess("I'm making dinner.", p).HumourAllowed != test.allowed ||
					!strings.Contains(ResponseGuidance("I'm making dinner.", p), test.want) {
					t.Fatalf("level %s not respected: %s", test.level, ResponseGuidance("I'm making dinner.", p))
				}
			})
		}
	}
}

func TestPainAndSeriousRequestsOverrideEveryHumourLevel(t *testing.T) {
	for _, level := range []HumourPreference{HumourOff, HumourSubtle, HumourOccasional, HumourFrequent} {
		for _, text := range []string{
			"My father died. Make me laugh.", "I'm suffering after a miscarriage. Tell me a joke.",
			"My friend is seriously ill.", "I am in pain.", "I feel overwhelmed.",
			"Please answer seriously.", "No humor, please.", "Don't joke about this.",
		} {
			if got := Assess(text, Preferences{Humour: level, Tone: TonePlayful}); got.HumourAllowed {
				t.Errorf("%q with %s permitted humour: %+v", text, level, got)
			}
		}
	}
}

func TestCurrentTurnInvitationDoesNotChangeSavedHumourOff(t *testing.T) {
	p := Preferences{Humour: HumourOff, HumourExplicit: true, Tone: ToneAdaptive}
	if !Assess("Tell me a joke.", p).HumourAllowed || !strings.Contains(ResponseGuidance("Tell me a joke.", p), "for this turn only") {
		t.Fatal("direct invitation was not treated as a current-turn exception")
	}
	if Assess("What should I cook?", p).HumourAllowed {
		t.Fatal("invitation changed saved humour-off preference")
	}
}

func TestGreetingReflectsDefaultWitAndRespectsSeriousContextAndPreferences(t *testing.T) {
	p := DefaultPreferences()
	if got := GreetingGuidance("Greet me briefly.", p); !strings.Contains(got, "PADI wit in the first line") || !strings.Contains(got, "fresh, light observation") {
		t.Fatalf("default opening lacks personality: %s", got)
	}
	for _, text := range []string{"My father died. Just listen.", "Please be serious."} {
		p.Humour = HumourFrequent
		if got := GreetingGuidance(text, p); strings.Contains(got, "PADI wit in the first line") || !strings.Contains(got, "Humour is not appropriate") {
			t.Fatalf("greeting ignored serious context: %s", got)
		}
	}
	p.Humour = HumourOff
	if got := GreetingGuidance("Greet me briefly.", p); !strings.Contains(got, "warm, attentive, and personable") || strings.Contains(got, "PADI wit in the first line") {
		t.Fatalf("humour off erased warmth or permitted jokes: %s", got)
	}
}

func TestCasualSharingIsNotTreatedAsTroubleshootingEvenWithHumourOff(t *testing.T) {
	for _, humour := range []HumourPreference{HumourOff, HumourOccasional} {
		p := DefaultPreferences()
		p.Humour = humour
		if got := ResponseGuidance("I opened the fridge three times and dinner hasn't appeared.", p); !strings.Contains(got, "Respond for connection") {
			t.Fatalf("casual statement invited invented technical advice: %s", got)
		}
		if got := ResponseGuidance("Please help me fix my fridge.", p); strings.Contains(got, "Respond for connection") {
			t.Fatalf("practical request was treated as banter: %s", got)
		}
	}
}

func TestExplicitHumourPreferenceDoesNotOverrideSeriousSignals(t *testing.T) {
	preferences := DefaultPreferences()
	preferences.Humour = HumourFrequent
	preferences.Tone = TonePlayful
	result := Assess("I am grieving after my sister passed away.", preferences)
	if result.Mode != "empathetic" || result.HumourAllowed {
		t.Fatalf("serious signal should override humour preference: %+v", result)
	}
}

func TestFeedbackLearningRequiresOptInRepeatedSignalAndRespectsExplicitChoice(t *testing.T) {
	preferences := DefaultPreferences()
	trend := FeedbackTrend{UnwantedHumour: 1}
	if ApplyFeedbackTrend(preferences, trend).Humour != HumourOccasional {
		t.Fatal("one negative reaction changed the humour preference")
	}
	preferences.LearnFromFeedback = true
	if ApplyFeedbackTrend(preferences, FeedbackTrend{LikedHumour: 2}).Humour != HumourOccasional {
		t.Fatal("two positive reactions changed the humour preference")
	}
	if ApplyFeedbackTrend(preferences, FeedbackTrend{LikedHumour: 3}).Humour != HumourFrequent {
		t.Fatal("repeated positive feedback did not adjust an opted-in default")
	}
	if ApplyFeedbackTrend(preferences, FeedbackTrend{LikedHumour: 1, UnwantedHumour: 3}).Humour != HumourOccasional {
		t.Fatal("mixed feedback was treated as a clear preference")
	}
	if ApplyFeedbackTrend(preferences, FeedbackTrend{UnwantedHumour: 3}).Humour != HumourOff {
		t.Fatal("repeated unwanted-humour feedback did not reduce default humour")
	}
	preferences.Humour = HumourSubtle
	preferences.HumourExplicit = true
	if ApplyFeedbackTrend(preferences, FeedbackTrend{LikedHumour: 5}).Humour != HumourSubtle {
		t.Fatal("feedback overrode the user's explicit humour preference")
	}
}

func TestExplicitPreferencesNeverOverrideSeriousTurnSignals(t *testing.T) {
	tests := []struct {
		name        string
		text        string
		preferences Preferences
		wantMode    string
	}{
		{name: "humour disabled", text: "Can you explain this?", preferences: Preferences{Humour: HumourOff, Tone: ToneAdaptive}, wantMode: "friendly"},
		{name: "gentle preference", text: "Can you explain this?", preferences: Preferences{Humour: HumourFrequent, Tone: ToneGentle}, wantMode: "gentle"},
		{name: "distress overrides playful preference", text: "I feel overwhelmed and lonely.", preferences: Preferences{Humour: HumourFrequent, Tone: TonePlayful}, wantMode: "empathetic"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			result := Assess(test.text, test.preferences)
			if result.Mode != test.wantMode {
				t.Fatalf("Assess() = %+v, want mode %q", result, test.wantMode)
			}
			if result.Mode == "empathetic" && result.HumourAllowed {
				t.Fatal("serious turn signal permitted humour")
			}
		})
	}
}
