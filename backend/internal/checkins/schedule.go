package checkins

import (
	"errors"
	"time"
)

type DueSlot struct {
	Slot      string
	LocalDate string
	Scheduled time.Time
}

func DueSlots(preferences Preferences, now time.Time, grace time.Duration) ([]DueSlot, error) {
	if grace < 0 {
		return nil, errors.New("check-in scheduling grace period is invalid")
	}
	if !preferences.MorningEnabled && !preferences.AfternoonEnabled && !preferences.EveningEnabled {
		return nil, nil
	}
	location, err := time.LoadLocation(preferences.Timezone)
	if err != nil {
		return nil, ErrInvalidPreferences
	}
	localNow := now.In(location)
	candidates := []struct {
		slot    string
		enabled bool
		clock   string
	}{
		{slot: "morning", enabled: preferences.MorningEnabled, clock: preferences.MorningTime},
		{slot: "afternoon", enabled: preferences.AfternoonEnabled, clock: preferences.AfternoonTime},
		{slot: "evening", enabled: preferences.EveningEnabled, clock: preferences.EveningTime},
	}
	due := make([]DueSlot, 0, len(candidates))
	for _, candidate := range candidates {
		if !candidate.enabled {
			continue
		}
		hour, minute, err := timeParts(candidate.clock)
		if err != nil {
			return nil, ErrInvalidPreferences
		}
		if preferences.QuietHoursEnabled {
			quiet, err := inQuietHours(candidate.clock, preferences.QuietHoursStart, preferences.QuietHoursEnd)
			if err != nil {
				return nil, ErrInvalidPreferences
			}
			if quiet {
				continue
			}
		}
		scheduled := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), hour, minute, 0, 0, location)
		lateBy := localNow.Sub(scheduled)
		if lateBy < 0 || lateBy > grace {
			continue
		}
		due = append(due, DueSlot{
			Slot:      candidate.slot,
			LocalDate: localNow.Format("2006-01-02"),
			Scheduled: scheduled,
		})
	}
	return due, nil
}

func timeParts(value string) (int, int, error) {
	parsed, err := time.Parse("15:04", value)
	if err != nil || parsed.Format("15:04") != value {
		return 0, 0, ErrInvalidPreferences
	}
	return parsed.Hour(), parsed.Minute(), nil
}

func inQuietHours(clock, start, end string) (bool, error) {
	candidateHour, candidateMinute, err := timeParts(clock)
	if err != nil {
		return false, err
	}
	startHour, startMinute, err := timeParts(start)
	if err != nil {
		return false, err
	}
	endHour, endMinute, err := timeParts(end)
	if err != nil {
		return false, err
	}
	candidate := candidateHour*60 + candidateMinute
	startAt := startHour*60 + startMinute
	endAt := endHour*60 + endMinute
	if startAt == endAt {
		return true, nil
	}
	if startAt < endAt {
		return candidate >= startAt && candidate < endAt, nil
	}
	return candidate >= startAt || candidate < endAt, nil
}
