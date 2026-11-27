package httpapi

import (
	"log/slog"
	"net/http"
	"regexp"
	"strings"

	"golang.org/x/text/language"
	"golang.org/x/text/language/display"
)

func countryName(code string) string {
	if len(code) != 2 {
		return ""
	}
	region, err := language.ParseRegion(code)
	if err != nil || !region.IsCountry() || region.String() != code {
		return ""
	}
	return display.English.Regions().Name(region)
}

// A narrowly scoped self-lookup keeps verified contact details out of provider requests.
var ownPhone = regexp.MustCompile(`^(?:(?:what(?: is|'s)|tell me|show me|do you (?:know|remember)|remind me of) my (?:registered |saved |account )?(?:(?:phone|contact|mobile)(?: number)?|number)|what number (?:did i (?:use|register with)|is on my account))(?: please)?$`)

func ownPhoneQuestion(text string) bool {
	words := strings.ToLower(strings.Join(strings.Fields(text), " "))
	words = strings.ReplaceAll(words, "’", "'")
	return ownPhone.MatchString(strings.TrimRight(words, ".!?"))
}

func accountCountryHandler(service AuthAPI, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodPatch {
			w.Header().Set("Allow", "GET, PATCH")
			writeAPIError(w, 405, "method_not_allowed", "Use GET or PATCH.")
			return
		}
		if service == nil {
			writeAPIError(w, 503, "auth_unavailable", "Sign-in is unavailable.")
			return
		}
		token, ok := bearerToken(r)
		if !ok {
			writeAPIError(w, 401, "unauthenticated", "Sign in to save your country.")
			return
		}
		user, err := service.Authenticate(r.Context(), token)
		if err != nil {
			writeAuthError(w, err, logger)
			return
		}
		code := user.CountryCode
		if r.Method == http.MethodPatch {
			var body struct {
				CountryCode   string `json:"country_code"`
				OnlyIfMissing bool   `json:"only_if_missing"`
			}
			if decodeRequest(w, r, 1024, &body) != nil || countryName(body.CountryCode) == "" {
				writeAPIError(w, 400, "invalid_country", "Choose a supported country.")
				return
			}
			code, err = service.SetCountry(r.Context(), user.ID, body.CountryCode, body.OnlyIfMissing)
			if err != nil {
				writeAPIError(w, 503, "profile_unavailable", "Your country could not be saved.")
				return
			}
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, 200, map[string]string{"country_code": code})
	}
}
