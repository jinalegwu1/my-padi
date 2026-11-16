package auth

import (
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const maxFullNameLength = 120

// Profile contains the personal information collected when a user registers.
type Profile struct {
	FullName    string
	DateOfBirth string
	PhoneNumber string
}

// NormalizeProfile validates profile fields and returns their canonical forms.
func NormalizeProfile(profile Profile, now time.Time) (Profile, error) {
	profile.FullName = strings.TrimSpace(profile.FullName)
	if !utf8.ValidString(profile.FullName) || utf8.RuneCountInString(profile.FullName) == 0 || utf8.RuneCountInString(profile.FullName) > maxFullNameLength {
		return Profile{}, fmt.Errorf("full name must contain 1 to %d characters", maxFullNameLength)
	}
	for _, character := range profile.FullName {
		if unicode.IsControl(character) {
			return Profile{}, fmt.Errorf("full name contains an invalid character")
		}
	}

	birthDate, err := time.Parse("2006-01-02", profile.DateOfBirth)
	if err != nil || birthDate.After(now.UTC()) {
		return Profile{}, fmt.Errorf("date of birth must be a valid date in the past")
	}

	if !validE164(profile.PhoneNumber) {
		return Profile{}, fmt.Errorf("phone number must use E.164 format")
	}

	return profile, nil
}

func validE164(phoneNumber string) bool {
	if len(phoneNumber) < 9 || len(phoneNumber) > 16 || phoneNumber[0] != '+' || phoneNumber[1] < '1' || phoneNumber[1] > '9' {
		return false
	}
	for _, digit := range phoneNumber[1:] {
		if digit < '0' || digit > '9' {
			return false
		}
	}
	return true
}
