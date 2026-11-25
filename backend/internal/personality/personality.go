package personality

import (
	"errors"
	"strings"
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
	Warm             bool   `json:"warm"`
	Funny            bool   `json:"funny"`
	Witty            bool   `json:"witty"`
	Intelligent      bool   `json:"intelligent"`
	Playful          bool   `json:"playful"`
	EmotionallyAware bool   `json:"emotionally_aware"`
	WarmthGuidance   string `json:"warmth_guidance"`
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

// Guidance returns the authoritative Python export without deriving instructions
// from trait flags. Trait interpretation and behaviour composition belong to Python.
func (settings CoreSettings) Guidance() string {
	return settings.WarmthGuidance
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

type FeedbackTrend struct {
	LikedHumour    int `json:"liked_humour"`
	UnwantedHumour int `json:"unwanted_humour"`
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
