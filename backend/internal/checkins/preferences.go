package checkins

import (
	"errors"
	"strings"
	"time"

	_ "time/tzdata"
)

var ErrInvalidPreferences = errors.New("check-in preferences are invalid")

type Preferences struct {
	MorningEnabled    bool   `json:"morning_enabled"`
	MorningTime       string `json:"morning_time"`
	AfternoonEnabled  bool   `json:"afternoon_enabled"`
	AfternoonTime     string `json:"afternoon_time"`
	EveningEnabled    bool   `json:"evening_enabled"`
	EveningTime       string `json:"evening_time"`
	Timezone          string `json:"timezone"`
	QuietHoursEnabled bool   `json:"quiet_hours_enabled"`
	QuietHoursStart   string `json:"quiet_hours_start"`
	QuietHoursEnd     string `json:"quiet_hours_end"`
}

type PreferencesPatch struct {
	MorningEnabled    *bool   `json:"morning_enabled,omitempty"`
	MorningTime       *string `json:"morning_time,omitempty"`
	AfternoonEnabled  *bool   `json:"afternoon_enabled,omitempty"`
	AfternoonTime     *string `json:"afternoon_time,omitempty"`
	EveningEnabled    *bool   `json:"evening_enabled,omitempty"`
	EveningTime       *string `json:"evening_time,omitempty"`
	Timezone          *string `json:"timezone,omitempty"`
	QuietHoursEnabled *bool   `json:"quiet_hours_enabled,omitempty"`
	QuietHoursStart   *string `json:"quiet_hours_start,omitempty"`
	QuietHoursEnd     *string `json:"quiet_hours_end,omitempty"`
}

func DefaultPreferences() Preferences {
	return Preferences{
		MorningTime:       "09:00",
		AfternoonTime:     "13:00",
		EveningTime:       "19:00",
		QuietHoursEnabled: true,
		QuietHoursStart:   "22:00",
		QuietHoursEnd:     "08:00",
	}
}

func NormalizePreferencesPatch(patch PreferencesPatch) (PreferencesPatch, error) {
	if patch.MorningEnabled == nil && patch.MorningTime == nil &&
		patch.AfternoonEnabled == nil && patch.AfternoonTime == nil &&
		patch.EveningEnabled == nil && patch.EveningTime == nil &&
		patch.Timezone == nil && patch.QuietHoursEnabled == nil &&
		patch.QuietHoursStart == nil && patch.QuietHoursEnd == nil {
		return PreferencesPatch{}, ErrInvalidPreferences
	}
	for _, clock := range []*string{
		patch.MorningTime, patch.AfternoonTime, patch.EveningTime,
		patch.QuietHoursStart, patch.QuietHoursEnd,
	} {
		if clock != nil && !validTime(*clock) {
			return PreferencesPatch{}, ErrInvalidPreferences
		}
	}
	if (patch.QuietHoursStart != nil || patch.QuietHoursEnd != nil) &&
		(patch.QuietHoursStart == nil || patch.QuietHoursEnd == nil) {
		return PreferencesPatch{}, ErrInvalidPreferences
	}
	if patch.QuietHoursEnabled != nil && *patch.QuietHoursEnabled &&
		(patch.QuietHoursStart == nil || patch.QuietHoursEnd == nil) {
		return PreferencesPatch{}, ErrInvalidPreferences
	}
	if patch.QuietHoursStart != nil && patch.QuietHoursEnd != nil &&
		*patch.QuietHoursStart == *patch.QuietHoursEnd {
		return PreferencesPatch{}, ErrInvalidPreferences
	}
	if patch.MorningEnabled != nil && *patch.MorningEnabled ||
		patch.AfternoonEnabled != nil && *patch.AfternoonEnabled ||
		patch.EveningEnabled != nil && *patch.EveningEnabled {
		if patch.Timezone == nil || strings.TrimSpace(*patch.Timezone) == "" {
			return PreferencesPatch{}, ErrInvalidPreferences
		}
	}
	if patch.Timezone != nil {
		*patch.Timezone = strings.TrimSpace(*patch.Timezone)
		if len(*patch.Timezone) > 128 {
			return PreferencesPatch{}, ErrInvalidPreferences
		}
		if *patch.Timezone != "" {
			if _, err := time.LoadLocation(*patch.Timezone); err != nil {
				return PreferencesPatch{}, ErrInvalidPreferences
			}
		}
	}
	return patch, nil
}

func validTime(value string) bool {
	parsed, err := time.Parse("15:04", value)
	return err == nil && parsed.Format("15:04") == value
}
