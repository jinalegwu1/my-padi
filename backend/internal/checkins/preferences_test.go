package checkins

import "testing"

func TestNormalizePreferencesPatch(t *testing.T) {
	tests := []struct {
		name  string
		patch PreferencesPatch
		valid bool
	}{
		{name: "empty", valid: false},
		{name: "valid time and timezone", patch: PreferencesPatch{MorningTime: stringPointer("09:15"), Timezone: stringPointer("Africa/Lagos")}, valid: true},
		{name: "invalid clock", patch: PreferencesPatch{EveningTime: stringPointer("24:00")}},
		{name: "invalid timezone", patch: PreferencesPatch{Timezone: stringPointer("../UTC")}},
		{name: "invalid minute format", patch: PreferencesPatch{AfternoonTime: stringPointer("9:05")}},
		{name: "quiet hours require both boundaries", patch: PreferencesPatch{QuietHoursStart: stringPointer("21:00")}},
		{name: "quiet hours cannot cover a full day", patch: PreferencesPatch{QuietHoursEnabled: boolPointer(true), QuietHoursStart: stringPointer("08:00"), QuietHoursEnd: stringPointer("08:00")}},
		{name: "enabled schedule requires a timezone", patch: PreferencesPatch{MorningEnabled: boolPointer(true)}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := NormalizePreferencesPatch(test.patch)
			if (err == nil) != test.valid {
				t.Fatalf("NormalizePreferencesPatch() error = %v, valid = %t", err, test.valid)
			}
		})
	}
}

func stringPointer(value string) *string { return &value }

func boolPointer(value bool) *bool { return &value }
