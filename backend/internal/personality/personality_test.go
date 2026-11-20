package personality

import "testing"

func TestAssessConversationSignalsWithoutPersistingMood(t *testing.T) {
	tests := []struct {
		name       string
		text       string
		wantMode   string
		wantHumour bool
	}{
		{name: "direct joke request", text: "I'm bored, make me laugh.", wantMode: "playful", wantHumour: true},
		{name: "celebration", text: "I finally completed my project!", wantMode: "celebratory"},
		{name: "frustration", text: "Everything is going wrong today.", wantMode: "empathetic"},
		{name: "grief overrides joke request", text: "My father died. Tell me a joke.", wantMode: "empathetic"},
		{name: "explicit serious request", text: "Stop joking and be serious.", wantMode: "serious"},
		{name: "neutral conversation", text: "Can you explain how rain forms?", wantMode: "friendly"},
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
