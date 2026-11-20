package checkins

import (
	"testing"
	"time"
)

func TestDueSlotsUseLocalTimezoneQuietHoursAndGraceWindow(t *testing.T) {
	location, err := time.LoadLocation("Africa/Lagos")
	if err != nil {
		t.Fatal(err)
	}
	preferences := DefaultPreferences()
	preferences.Timezone = "Africa/Lagos"
	preferences.MorningEnabled = true
	preferences.MorningTime = "09:00"
	preferences.AfternoonEnabled = true
	preferences.AfternoonTime = "13:00"
	preferences.EveningEnabled = true
	preferences.EveningTime = "22:00"

	now := time.Date(2026, time.November, 20, 9, 3, 0, 0, location)
	due, err := DueSlots(preferences, now, 5*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if len(due) != 1 || due[0].Slot != "morning" || due[0].LocalDate != "2026-11-20" ||
		!due[0].Scheduled.Equal(time.Date(2026, time.November, 20, 9, 0, 0, 0, location)) {
		t.Fatalf("DueSlots() = %+v, want the local morning slot within grace", due)
	}

	due, err = DueSlots(preferences, now.Add(3*time.Minute), 5*time.Minute)
	if err != nil || len(due) != 0 {
		t.Fatalf("DueSlots() after grace = %+v, %v; want no slots", due, err)
	}
}

func TestDueSlotsSkipQuietHoursAndAllowTheirEndBoundary(t *testing.T) {
	location, err := time.LoadLocation("Africa/Lagos")
	if err != nil {
		t.Fatal(err)
	}
	preferences := DefaultPreferences()
	preferences.Timezone = "Africa/Lagos"
	preferences.MorningEnabled = true
	preferences.MorningTime = "07:30"
	preferences.AfternoonEnabled = true
	preferences.AfternoonTime = "08:00"

	due, err := DueSlots(preferences, time.Date(2026, time.November, 20, 8, 1, 0, 0, location), 2*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if len(due) != 1 || due[0].Slot != "afternoon" {
		t.Fatalf("DueSlots() = %+v, want only the quiet-hours end boundary", due)
	}
}

func TestDueSlotsRejectInvalidTimezoneAndClocks(t *testing.T) {
	preferences := DefaultPreferences()
	preferences.MorningEnabled = true
	preferences.Timezone = "not/a_timezone"
	if _, err := DueSlots(preferences, time.Now(), time.Minute); err != ErrInvalidPreferences {
		t.Fatalf("invalid timezone error = %v, want %v", err, ErrInvalidPreferences)
	}

	preferences.Timezone = "Africa/Lagos"
	preferences.MorningTime = "9:00"
	if _, err := DueSlots(preferences, time.Now(), time.Minute); err != ErrInvalidPreferences {
		t.Fatalf("invalid clock error = %v, want %v", err, ErrInvalidPreferences)
	}
}
