package auth

import (
	"testing"
	"time"
)

func TestNormalizeProfile(t *testing.T) {
	now := time.Date(2026, time.November, 16, 0, 0, 0, 0, time.UTC)

	got, err := NormalizeProfile(Profile{
		FullName:    "  Ada Lovelace  ",
		DateOfBirth: "1990-12-10",
		PhoneNumber: "+2348012345678",
	}, now)
	if err != nil {
		t.Fatalf("NormalizeProfile() error = %v", err)
	}
	if got.FullName != "Ada Lovelace" {
		t.Errorf("FullName = %q, want trimmed name", got.FullName)
	}
}

func TestNormalizeProfileRejectsInvalidFields(t *testing.T) {
	now := time.Date(2026, time.November, 16, 0, 0, 0, 0, time.UTC)
	tests := []struct {
		name    string
		profile Profile
	}{
		{
			name:    "blank name",
			profile: Profile{DateOfBirth: "1990-12-10", PhoneNumber: "+2348012345678"},
		},
		{
			name:    "control character in name",
			profile: Profile{FullName: "Ada\nLovelace", DateOfBirth: "1990-12-10", PhoneNumber: "+2348012345678"},
		},
		{
			name:    "invalid date",
			profile: Profile{FullName: "Ada Lovelace", DateOfBirth: "10-12-1990", PhoneNumber: "+2348012345678"},
		},
		{
			name:    "future date",
			profile: Profile{FullName: "Ada Lovelace", DateOfBirth: "2027-01-01", PhoneNumber: "+2348012345678"},
		},
		{
			name:    "non-E.164 phone",
			profile: Profile{FullName: "Ada Lovelace", DateOfBirth: "1990-12-10", PhoneNumber: "08012345678"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := NormalizeProfile(test.profile, now); err == nil {
				t.Fatal("NormalizeProfile() error = nil, want validation error")
			}
		})
	}
}
