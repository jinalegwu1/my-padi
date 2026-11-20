package personality

import (
	"errors"
	"strings"
	"unicode"
)

var (
	ErrInvalidFeedback     = errors.New("response feedback is invalid")
	ErrFeedbackRateLimited = errors.New("response feedback rate limit reached")
	ErrInvalidPreferences  = errors.New("personality preferences are invalid")
)

type HumourPreference string

const (
	HumourOff        HumourPreference = "off"
	HumourSubtle     HumourPreference = "subtle"
	HumourOccasional HumourPreference = "occasional"
	HumourFrequent   HumourPreference = "frequent"
)

type TonePreference string

const (
	ToneAdaptive TonePreference = "adaptive"
	TonePlayful  TonePreference = "playful"
	ToneSerious  TonePreference = "serious"
	ToneGentle   TonePreference = "gentle"
	ToneDirect   TonePreference = "direct"
)

type Preferences struct {
	Humour            HumourPreference `json:"humour"`
	HumourExplicit     bool             `json:"humour_explicit"`
	Tone              TonePreference   `json:"tone"`
	LearnFromFeedback bool             `json:"learn_from_feedback"`
}

type PreferencesPatch struct {
	Humour            *HumourPreference `json:"humour,omitempty"`
	Tone              *TonePreference   `json:"tone,omitempty"`
	LearnFromFeedback *bool             `json:"learn_from_feedback,omitempty"`
}

func DefaultPreferences() Preferences {
	return Preferences{
		Humour: HumourOccasional,
		Tone:   ToneAdaptive,
	}
}

func NormalizePreferencesPatch(patch PreferencesPatch) (PreferencesPatch, error) {
	if patch.Humour == nil && patch.Tone == nil && patch.LearnFromFeedback == nil {
		return PreferencesPatch{}, ErrInvalidPreferences
	}
	if patch.Humour != nil {
		switch *patch.Humour {
		case HumourOff, HumourSubtle, HumourOccasional, HumourFrequent:
		default:
			return PreferencesPatch{}, ErrInvalidPreferences
		}
	}
	if patch.Tone != nil {
		switch *patch.Tone {
		case ToneAdaptive, TonePlayful, ToneSerious, ToneGentle, ToneDirect:
		default:
			return PreferencesPatch{}, ErrInvalidPreferences
		}
	}
	return patch, nil
}

type Assessment struct {
	Mode          string
	HumourAllowed bool
}

type FeedbackTrend struct {
	LikedHumour    int
	UnwantedHumour int
}

type Feedback struct {
	MessageID string `json:"message_id"`
	Rating    string `json:"rating"`
}

func NormalizeFeedback(feedback Feedback) (Feedback, error) {
	feedback.MessageID = strings.TrimSpace(feedback.MessageID)
	if len(feedback.MessageID) == 0 || len(feedback.MessageID) > 128 {
		return Feedback{}, ErrInvalidFeedback
	}
	for _, char := range []byte(feedback.MessageID) {
		if !(char >= 'A' && char <= 'Z') && !(char >= 'a' && char <= 'z') &&
			!(char >= '0' && char <= '9') && char != '_' && char != '-' {
			return Feedback{}, ErrInvalidFeedback
		}
	}
	switch feedback.Rating {
	case "helpful", "not_helpful", "liked_humour", "unwanted_humour":
	default:
		return Feedback{}, ErrInvalidFeedback
	}
	return feedback, nil
}

// Assess chooses brief, current-turn response guidance without storing mood
// labels or treating conversational signals as diagnoses.
func Assess(text string, preferences Preferences) Assessment {
	words := tokenSet(text)
	serious := hasAny(words, "grief", "grieving", "funeral", "died", "death", "bereaved",
		"trauma", "abuse", "cancer", "suicide", "suicidal", "emergency", "unsafe", "danger") ||
		hasAnyPhrase(text, "passed away", "lost someone", "self-harm", "hurt myself")
	distressed := serious || hasAny(words, "sad", "lonely", "worried", "scared", "afraid",
		"frustrated", "angry", "anxious", "depressed", "overwhelmed", "stressed", "tired", "vexed") ||
		hasAnyPhrase(text, "rough day", "everything is going wrong", "i dey vex", "i no happy")
	explicitlySerious := hasAnyPhrase(text, "be serious", "stop joking", "no jokes", "just listen",
		"i need you to listen", "i need encouragement")
	requestsHumour := hasAnyPhrase(text, "make me laugh", "tell me a joke", "i need a joke", "make we laugh")
	celebrating := hasAny(words, "excited", "celebrating", "celebrate", "achieved", "completed",
		"passed", "won", "promoted", "graduated") || hasAnyPhrase(text, "finally finished", "got the job")
	bored := hasAny(words, "bored", "boring") || hasAnyPhrase(text, "nothing to do")

	switch {
	case serious:
		return Assessment{Mode: "empathetic", HumourAllowed: false}
	case explicitlySerious:
		return Assessment{Mode: "serious", HumourAllowed: false}
	case distressed && !requestsHumour:
		return Assessment{Mode: "empathetic", HumourAllowed: false}
	case requestsHumour:
		return Assessment{Mode: "playful", HumourAllowed: true}
	case celebrating:
		return Assessment{Mode: "celebratory", HumourAllowed: preferences.Humour == HumourFrequent}
	case preferences.Tone == ToneSerious || preferences.Tone == ToneDirect:
		return Assessment{Mode: string(preferences.Tone), HumourAllowed: false}
	case bored:
		return Assessment{Mode: "playful", HumourAllowed: preferences.Humour != HumourOff}
	case preferences.Tone == ToneGentle:
		return Assessment{Mode: "gentle", HumourAllowed: preferences.Humour == HumourFrequent}
	case preferences.Tone == TonePlayful:
		return Assessment{Mode: "playful", HumourAllowed: preferences.Humour != HumourOff}
	case preferences.Humour == HumourOff:
		return Assessment{Mode: "friendly", HumourAllowed: false}
	default:
		return Assessment{Mode: "friendly", HumourAllowed: preferences.Humour == HumourFrequent}
	}
}

// ApplyFeedbackTrend uses only a clear pattern of recent, voluntarily submitted
// humour reactions when the user opted in and did not set a humour level directly.
func ApplyFeedbackTrend(preferences Preferences, trend FeedbackTrend) Preferences {
	if !preferences.LearnFromFeedback || preferences.HumourExplicit {
		return preferences
	}
	if trend.LikedHumour >= 3 && trend.UnwantedHumour == 0 {
		preferences.Humour = HumourFrequent
	} else if trend.UnwantedHumour >= 3 && trend.LikedHumour == 0 {
		preferences.Humour = HumourOff
	}
	return preferences
}

func ResponseGuidance(text string, preferences Preferences) string {
	assessment := Assess(text, preferences)
	article := "a"
	if assessment.Mode == "empathetic" {
		article = "an"
	}
	if assessment.HumourAllowed {
		return "Current-turn response guidance: use " + article + " " + assessment.Mode +
			" tone. Humour is welcome only when it is relevant and respectful; keep the answer natural."
	}
	guidance := "Current-turn response guidance: use " + article + " " + assessment.Mode +
		" tone. Humour is not appropriate for this turn; prioritize the user's request, care, and clear help."
	return guidance
}

func tokenSet(text string) map[string]bool {
	words := strings.FieldsFunc(strings.ToLower(text), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsNumber(r)
	})
	result := make(map[string]bool, len(words))
	for _, word := range words {
		result[word] = true
	}
	return result
}

func hasAny(words map[string]bool, candidates ...string) bool {
	for _, candidate := range candidates {
		if words[candidate] {
			return true
		}
	}
	return false
}

func hasAnyPhrase(text string, phrases ...string) bool {
	text = " " + strings.ToLower(text) + " "
	for _, phrase := range phrases {
		if strings.Contains(text, phrase) {
			return true
		}
	}
	return false
}
