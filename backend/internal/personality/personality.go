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
	HumourExplicit    bool             `json:"humour_explicit"`
	Tone              TonePreference   `json:"tone"`
	LearnFromFeedback bool             `json:"learn_from_feedback"`
}

type CoreSettings struct {
	Warm             bool `json:"warm"`
	Funny            bool `json:"funny"`
	Witty            bool `json:"witty"`
	Intelligent      bool `json:"intelligent"`
	Playful          bool `json:"playful"`
	EmotionallyAware bool `json:"emotionally_aware"`
}

type PreferencesPatch struct {
	Humour            *HumourPreference `json:"humour,omitempty"`
	Tone              *TonePreference   `json:"tone,omitempty"`
	LearnFromFeedback *bool             `json:"learn_from_feedback,omitempty"`
}

// DefaultCoreSettings returns the defaults loaded from Python. Applications
// should call LoadCoreSettings at startup to handle errors before serving chat.
func DefaultCoreSettings() CoreSettings {
	settings, err := LoadCoreSettings()
	if err != nil {
		panic(err)
	}
	return settings
}

func (settings CoreSettings) Guidance() string {
	traits := make([]string, 0, 6)
	if settings.Warm {
		traits = append(traits, "warm")
	}
	if settings.Funny {
		traits = append(traits, "funny")
	}
	if settings.Witty {
		traits = append(traits, "witty")
	}
	if settings.Intelligent {
		traits = append(traits, "intelligent")
	}
	if settings.Playful {
		traits = append(traits, "playful")
	}
	if settings.EmotionallyAware {
		traits = append(traits, "emotionally aware")
	}
	if len(traits) == 0 {
		return ""
	}
	return "Core PADI personality traits: " + strings.Join(traits, ", ") + "."
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
	// Everyday figurative language must not be mistaken for bereavement.
	literalText := strings.ToLower(text)
	for _, phrase := range []string{"i died laughing", "we died laughing", "phone died", "battery died", "laptop died", "computer died", "router died"} {
		literalText = strings.ReplaceAll(literalText, phrase, "")
	}
	literalDeath := tokenSet(literalText)["died"]
	serious := literalDeath || hasAny(words, "grief", "grieving", "funeral", "death", "bereaved",
		"trauma", "abuse", "cancer", "suicide", "suicidal", "emergency", "unsafe", "danger",
		"miscarriage", "assault", "suffering") ||
		hasAnyPhrase(text, "passed away", "lost someone", "self-harm", "hurt myself", "in pain", "seriously ill")
	distressed := serious || hasAny(words, "sad", "lonely", "worried", "scared", "afraid",
		"frustrated", "angry", "anxious", "depressed", "overwhelmed", "stressed", "stressful", "tired", "vexed") ||
		hasAnyPhrase(text, "rough day", "everything is going wrong", "i dey vex", "i no happy", "i no too dey okay")
	explicitlySerious := hasAnyPhrase(text, "be serious", "stop joking", "no jokes", "just listen",
		"i need you to listen", "i need encouragement", "serious response", "serious answer",
		"answer seriously", "take this seriously", "don't joke", "do not joke", "no humour", "no humor",
		"without humour", "without humor", "wey go listen")
	requestsHumour := preferences.Humour != HumourOff && explicitlyRequestsHumour(text)
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
	case preferences.Tone == ToneSerious || preferences.Tone == ToneDirect:
		return Assessment{Mode: string(preferences.Tone), HumourAllowed: false}
	case celebrating:
		return Assessment{Mode: "celebratory", HumourAllowed: preferences.Humour != HumourOff}
	case bored:
		return Assessment{Mode: "playful", HumourAllowed: preferences.Humour != HumourOff}
	case preferences.Tone == ToneGentle:
		return Assessment{Mode: "gentle", HumourAllowed: preferences.Humour != HumourOff}
	case preferences.Tone == TonePlayful:
		return Assessment{Mode: "playful", HumourAllowed: preferences.Humour != HumourOff}
	case preferences.Humour == HumourOff:
		return Assessment{Mode: "friendly", HumourAllowed: false}
	default:
		return Assessment{Mode: "friendly", HumourAllowed: preferences.Humour != HumourOff}
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
	if assessment.Mode == "friendly" && isReciprocalCheckIn(text) {
		frequency := "A touch of wit may fit if the exchange gives you a natural opening; do not force a joke."
		switch preferences.Humour {
		case HumourOff:
			frequency = "Keep the response warm and entirely non-jokey."
		case HumourSubtle:
			frequency = "Keep any wit understated and only use it if it fits naturally."
		case HumourFrequent:
			frequency = "A quick, fresh playful observation is welcome when it suits the exchange; avoid forced jokes."
		}
		return "This is friendly small talk. Answer as a warm companion, not a service agent: acknowledge their check-in naturally, stay honest without inventing a human day, and keep it brief. Respond to the social connection rather than giving a stock self-status or pivoting to service. " + frequency
	}
	if assessment.Mode == "celebratory" {
		guidance := "Share the user's excitement before adding anything else. Name what they accomplished, match their energy, and avoid a generic congratulations card; a natural question about how it happened can keep the moment theirs."
		if assessment.HumourAllowed {
			switch preferences.Humour {
			case HumourSubtle:
				guidance += " Keep any wit gentle and understated."
			case HumourFrequent:
				guidance += " A fresh playful observation can fit, but do not force a punchline."
			default:
				guidance += " A light touch of wit is optional, not required."
			}
		} else {
			guidance += " Keep it warm and sincere without jokes or teasing."
		}
		return guidance
	}
	if assessment.HumourAllowed && isPlayfulTeasing(text) {
		comeback := "Meet the teasing with a concise, affectionate, self-directed comeback; do not become defensive or apologize."
		switch preferences.Humour {
		case HumourSubtle:
			comeback += " Keep it gentle and understated."
		case HumourFrequent:
			comeback += " Let the reply be more playful, while keeping the wit tied to what they said."
		}
		return comeback
	}
	if assessment.HumourAllowed && isJokeSetup(text) {
		return "The user is setting up or sharing a joke. React like a companion: show amusement when it lands and play along briefly instead of explaining, grading, or troubleshooting it."
	}
	tone := assessment.Mode
	if tone == "friendly" {
		tone = "warm and conversational"
	}
	article := "a"
	if tone == "empathetic" {
		article = "an"
	}
	if !assessment.HumourAllowed {
		guidance := "Use " + article + " " + tone + " tone. Respond to what the user actually said; be warm and specific without jokes or teasing."
		if isSocialSharing(text) {
			guidance += " They are sharing a moment, not asking for fixes; connect with them, and don't pivot to troubleshooting or a service question unless invited."
		}
		if hasAnyPhrase(text, "just listen", "i need you to listen", "just wanted to tell someone") {
			guidance += " Leave space for them instead of offering fixes or asking what you can do."
		}
		return guidance
	}

	frequency := "A small bit of wit is welcome when the moment gives you a real opening; ordinary warmth is enough otherwise."
	switch preferences.Humour {
	case HumourSubtle:
		frequency = "If wit naturally fits, keep it understated."
	case HumourFrequent:
		frequency = "Use light wit more often when there is a natural opening; avoid forced puns or unrelated references."
	default:
		if preferences.Humour != HumourOff && explicitlyRequestsHumour(text) {
			frequency = "The user is inviting play; respond with genuine humour rather than a canned joke."
		}
	}
	guidance := "Use " + article + " " + tone + " tone. " + frequency + " Answer the user's actual point before adding anything extra."
	if isSocialSharing(text) {
		guidance += " They are sharing a moment, not asking for fixes; connect with them, and don't pivot to troubleshooting or a service question unless invited."
	}
	return guidance
}

// RecommendedOutputTokens keeps unprompted social turns concise without
// imposing a short budget on advice requests or serious conversations.
func RecommendedOutputTokens(text string, preferences Preferences) int {
	assessment := Assess(text, preferences)
	if assessment.Mode == "empathetic" || assessment.Mode == "serious" {
		return 0
	}
	if assessment.Mode == "friendly" && isReciprocalCheckIn(text) {
		return 96
	}
	if isSocialSharing(text) {
		return 256
	}
	return 0
}

// ContinuityGuidance anchors the request to actual recent assistant phrasing
// so the model can avoid repeating its own openings on a longer thread.
func ContinuityGuidance(recentReplies []string) string {
	if len(recentReplies) == 0 {
		return ""
	}
	if len(recentReplies) > 3 {
		recentReplies = recentReplies[len(recentReplies)-3:]
	}
	openings := make([]string, 0, len(recentReplies))
	seen := make(map[string]bool, len(recentReplies))
	for _, reply := range recentReplies {
		fields := strings.Fields(strings.TrimSpace(reply))
		if len(fields) == 0 {
			continue
		}
		opening := strings.ToLower(strings.Trim(fields[0], "\"'`“”*#.,!?;:"))
		if len(fields) > 1 {
			opening += " " + strings.ToLower(strings.Trim(fields[1], "\"'`“”*#.,!?;:"))
		}
		if opening != "" && !seen[opening] {
			seen[opening] = true
			openings = append(openings, opening)
		}
	}
	if len(openings) == 0 {
		return "Continue the conversation already underway instead of restarting; do not recycle the recent reply's joke or central image."
	}
	quoted := make([]string, len(openings))
	for i, opening := range openings {
		quoted[i] = "\"" + opening + "\""
	}
	return "Continue the conversation already underway instead of restarting. Recent PADI replies already opened with " +
		strings.Join(quoted, ", ") + "; vary your opening and do not recycle their joke or central image."
}

func isReciprocalCheckIn(text string) bool {
	return hasAnyPhrase(text, "and you", "and yourself", "how about you", "how about yourself",
		"what about you", "what about yourself", "how are you", "how are things", "how you doing")
}

func isPlayfulTeasing(text string) bool {
	return hasAnyPhrase(text, "you talk too much", "you use so many words", "you use too many words",
		"not even intelligent", "not intelligent", "swallowed a dictionary", "knit a scarf before your answer")
}

func isJokeSetup(text string) bool {
	return hasAnyPhrase(text, "why did the ", "what do you call a ", "knock knock") ||
		hasAny(tokenSet(text), "haha", "hahaha", "lol")
}

func explicitlyRequestsHumour(text string) bool {
	return hasAnyPhrase(text, "make me laugh", "tell me a joke", "i need a joke", "make we laugh",
		"i could use a laugh", "tell me a funny", "tell me something funny", "say something funny")
}

func isSocialSharing(text string) bool {
	return !strings.ContainsAny(text, "?？") &&
		!hasAny(tokenSet(text), "help", "explain", "show", "fix", "teach", "write", "plan",
			"recommend", "calculate", "schedule", "remind", "call", "send", "repeat",
			"translate", "summarize", "summarise", "check", "compare", "analyze",
			"analyse", "solve", "list", "answer") &&
		!hasAnyPhrase(text, "can you", "could you", "would you", "will you", "please help",
			"please tell", "please give", "please explain", "please show", "please be",
			"tell me", "help me", "i need help", "i need advice", "how do i", "what should",
			"what can", "need you to", "find me")
}

// GreetingGuidance applies the same preferences and emotional assessment to
// the opening, using only conversation context validated by the chat handler.
func GreetingGuidance(context string, preferences Preferences) string {
	guidance := ResponseGuidance(context, preferences)
	if Assess(context, preferences).HumourAllowed {
		return guidance + " Greet the user warmly in ordinary language, with a touch of personality; avoid stock greeting formulas and let context set the tone."
	}
	return guidance + " Give a brief, warm welcome suited to what the user shared; do not restart with a joke or a generic service question."
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
