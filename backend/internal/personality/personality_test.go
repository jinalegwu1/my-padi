package personality

import (
	"strings"
	"testing"
)

func TestDefaultCoreSettingsAreAvailableAsGuidance(t *testing.T) {
	settings := DefaultCoreSettings()
	if !settings.Warm || !settings.Funny || !settings.Witty ||
		!settings.Intelligent || !settings.Playful || !settings.EmotionallyAware {
		t.Fatalf("default core settings = %+v, want all PADI core traits enabled", settings)
	}
	want := "Core PADI personality traits: warm, funny, witty, intelligent, playful, emotionally aware."
	if got := settings.Guidance(); got != want {
		t.Fatalf("Guidance() = %q, want %q", got, want)
	}
	if got := (CoreSettings{}).Guidance(); got != "" {
		t.Fatalf("empty settings Guidance() = %q, want empty", got)
	}
}

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
			{HumourOff, "without jokes or teasing", false},
			{HumourSubtle, "keep it understated", true},
			{HumourOccasional, "A small bit of wit is welcome", true},
			{HumourFrequent, "Use light wit more often", true},
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

func TestExplicitHumourRequestsGetPlayfulGuidanceUnlessHumourIsOff(t *testing.T) {
	for _, text := range []string{"Make me laugh.", "Tell me a funny little story.", "I could use a laugh."} {
		got := ResponseGuidance(text, Preferences{Humour: HumourOccasional})
		if !strings.Contains(got, "The user is inviting play") {
			t.Errorf("%q did not receive playful guidance: %s", text, got)
		}
	}

	subtle := ResponseGuidance("Tell me a funny little story.", Preferences{Humour: HumourSubtle})
	if !strings.Contains(subtle, "keep it understated") {
		t.Errorf("subtle preference was overridden by explicit request: %s", subtle)
	}
	off := ResponseGuidance("Tell me a funny little story.", Preferences{Humour: HumourOff})
	if !strings.Contains(off, "without jokes or teasing") || strings.Contains(off, "inviting play") {
		t.Errorf("humour-off preference was overridden by explicit request: %s", off)
	}
}

func TestJokesAndAffectionateTeasingReceiveIntentSpecificGuidance(t *testing.T) {
	for _, text := range []string{
		"Why did the computer go to the doctor?",
		"What do you call a bear with no teeth?",
		"Knock knock.",
	} {
		if got := ResponseGuidance(text, DefaultPreferences()); !strings.Contains(got, "play along briefly") {
			t.Errorf("%q did not receive joke guidance: %s", text, got)
		}
	}

	for _, test := range []struct {
		text     string
		humour   HumourPreference
		expected string
	}{
		{"PADI, you're not even intelligent.", HumourOccasional, "concise, affectionate, self-directed comeback"},
		{"You talk too much.", HumourSubtle, "gentle and understated"},
		{"You use so many words I could knit a scarf before your answer ends.", HumourFrequent, "more playful"},
	} {
		if got := ResponseGuidance(test.text, Preferences{Humour: test.humour}); !strings.Contains(got, test.expected) {
			t.Errorf("%q did not receive teasing guidance: %s", test.text, got)
		}
	}

	off := ResponseGuidance("You talk too much.", Preferences{Humour: HumourOff})
	if !strings.Contains(off, "without jokes or teasing") || strings.Contains(off, "comeback") {
		t.Errorf("humour-off preference allowed a teasing comeback: %s", off)
	}
}

func TestCelebrationsGetSpecificWarmGuidanceAcrossHumourPreferences(t *testing.T) {
	for _, level := range []HumourPreference{HumourOff, HumourSubtle, HumourOccasional, HumourFrequent} {
		got := ResponseGuidance("I got the job!", Preferences{Humour: level})
		if !strings.Contains(got, "Share the user's excitement") ||
			!strings.Contains(got, "avoid a generic congratulations card") {
			t.Errorf("humour %s lost celebration-specific response guidance: %s", level, got)
		}
		if level == HumourOff && !strings.Contains(got, "without jokes or teasing") {
			t.Errorf("humour off did not preserve a sincere celebration: %s", got)
		}
	}
}

func TestPainAndSeriousRequestsOverrideEveryHumourLevel(t *testing.T) {
	for _, level := range []HumourPreference{HumourOff, HumourSubtle, HumourOccasional, HumourFrequent} {
		for _, text := range []string{
			"My father died. Make me laugh.", "I'm suffering after a miscarriage. Tell me a joke.",
			"My phone died just as I learned my father died.",
			"My friend is seriously ill.", "I am in pain.", "I feel overwhelmed.",
			"Please answer seriously.", "No humor, please.", "Don't joke about this.",
		} {
			if got := Assess(text, Preferences{Humour: level, Tone: TonePlayful}); got.HumourAllowed {
				t.Errorf("%q with %s permitted humour: %+v", text, level, got)
			}
		}
	}
}

func TestCurrentTurnInvitationDoesNotOverrideExplicitHumourOff(t *testing.T) {
	p := Preferences{Humour: HumourOff, HumourExplicit: true, Tone: ToneAdaptive}
	if Assess("Tell me a joke.", p).HumourAllowed || !strings.Contains(ResponseGuidance("Tell me a joke.", p), "without jokes or teasing") {
		t.Fatal("direct invitation overrode the user's disabled humour setting")
	}
	if Assess("What should I cook?", p).HumourAllowed {
		t.Fatal("invitation changed saved humour-off preference")
	}
}

func TestGreetingReflectsDefaultWitAndRespectsSeriousContextAndPreferences(t *testing.T) {
	p := DefaultPreferences()
	if got := GreetingGuidance("Hi", p); !strings.Contains(got, "Greet the user warmly in ordinary language") ||
		strings.Contains(got, "fresh, light observation") || strings.Contains(got, "mischief") {
		t.Fatalf("default opening should be warm without manufacturing a joke: %s", got)
	}
	for _, text := range []string{"My father died. Just listen.", "Please be serious."} {
		p.Humour = HumourFrequent
		if got := GreetingGuidance(text, p); strings.Contains(got, "PADI wit in the first line") ||
			!strings.Contains(got, "without jokes or teasing") {
			t.Fatalf("greeting ignored serious context: %s", got)
		}
	}
	p.Humour = HumourOff
	if got := GreetingGuidance("Hi", p); !strings.Contains(got, "warm and conversational") ||
		!strings.Contains(got, "without jokes or teasing") || strings.Contains(got, "PADI wit in the first line") {
		t.Fatalf("humour off erased warmth or permitted jokes: %s", got)
	}
}

func TestCasualSharingIsNotTreatedAsTroubleshootingEvenWithHumourOff(t *testing.T) {
	for _, humour := range []HumourPreference{HumourOff, HumourOccasional} {
		p := DefaultPreferences()
		p.Humour = humour
		for _, userText := range []string{
			"I opened the fridge three times and dinner hasn't appeared.",
			"I have 37 browser tabs open and can't find the one I need.",
			"The bus is late again. I've been waiting here for ages.",
		} {
			if got := ResponseGuidance(userText, p); !strings.Contains(got, "sharing a moment, not asking for fixes") ||
				!strings.Contains(got, "don't pivot to troubleshooting") {
				t.Fatalf("casual statement invited invented technical advice: %s", got)
			}
		}
		if got := ResponseGuidance("Please help me fix my fridge.", p); strings.Contains(got, "sharing a moment, not asking for fixes") {
			t.Fatalf("practical request was treated as banter: %s", got)
		}
	}
	guidance := ResponseGuidance("I left my coffee on the counter again. No joke, please; I just wanted to tell someone.", Preferences{Humour: HumourOff})
	if !strings.Contains(guidance, "sharing a moment, not asking for fixes") ||
		!strings.Contains(guidance, "Leave space for them instead of offering fixes") {
		t.Fatalf("politeness marker misclassified a casual share as a request: %s", guidance)
	}
}

func TestReciprocalSmallTalkGetsARealConversationResponse(t *testing.T) {
	for _, test := range []struct {
		text     string
		humour   HumourPreference
		expected string
	}{
		{"Fine and you?", HumourOccasional, "A touch of wit may fit"},
		{"I'm good, how about you?", HumourSubtle, "Keep any wit understated"},
		{"How are you?", HumourFrequent, "A quick, fresh playful observation"},
		{"What about yourself?", HumourOff, "entirely non-jokey"},
	} {
		guidance := ResponseGuidance(test.text, Preferences{Humour: test.humour})
		if !strings.Contains(guidance, "warm companion, not a service agent") ||
			!strings.Contains(guidance, "Respond to the social connection") ||
			!strings.Contains(guidance, test.expected) {
			t.Errorf("%q did not receive preference-aware social guidance: %s", test.text, guidance)
		}
	}
}

func TestConversationBudgetsKeepSocialTurnsBriefWithoutLimitingSeriousOrRequestedHelp(t *testing.T) {
	preferences := DefaultPreferences()
	for _, test := range []struct {
		text string
		want int
	}{
		{"Fine and you?", 96},
		{"I can't find the tab.", 256},
		{"I finally finished my work.", 256},
		{"My father died yesterday.", 0},
		{"Today was stressful.", 0},
		{"Can you help me find the missing tab?", 0},
	} {
		if got := RecommendedOutputTokens(test.text, preferences); got != test.want {
			t.Errorf("%q output budget = %d, want %d", test.text, got, test.want)
		}
	}
}

func TestContinuityGuidanceUsesActualRecentOpenings(t *testing.T) {
	if got := ContinuityGuidance(nil); got != "" {
		t.Fatalf("empty history got guidance: %q", got)
	}
	got := ContinuityGuidance([]string{"Sounds like a long day.", "Ah, the tabs have multiplied."})
	if !strings.Contains(got, `"sounds like"`) || !strings.Contains(got, `"ah the"`) ||
		!strings.Contains(got, "do not recycle their joke or central image") {
		t.Fatalf("continuity guidance did not reflect recent replies: %s", got)
	}
}

func TestSeriousReciprocalQuestionDoesNotOverrideEmpathy(t *testing.T) {
	preferences := DefaultPreferences()
	guidance := ResponseGuidance("My father died yesterday. How are you?", preferences)
	if !strings.Contains(guidance, "empathetic tone") || strings.Contains(guidance, "friendly small talk") {
		t.Fatalf("serious context was replaced by small-talk guidance: %s", guidance)
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
