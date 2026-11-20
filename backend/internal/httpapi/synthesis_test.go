package httpapi

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPersonalSpeechKeepsLanguageAndRejectsUnapprovedDelivery(t *testing.T) {
	speech := &sampleSpeech{}
	router := NewRouter(nil, Dependencies{Auth: testAuthAPI{}, Synthesis: speech})
	for _, request := range []struct {
		body, token string
		status      int
	}{
		{`{"text":"Private greeting","style":"ada","rate":1,"language":"en-NG"}`, "", 401},
		{`{"text":"Hi","style":"ada","rate":1,"language":"impersonate someone"}`, "test", 400},
		{`{"text":"Hi","style":"unknown","rate":1,"language":"en-NG"}`, "test", 400},
		{`{"text":"Hi","style":"baby","rate":1}`, "test", 200},
		{`{"text":"How you dey?","style":"tunde","rate":1,"language":"pcm-NG"}`, "test", 200},
	} {
		r := httptest.NewRequest("POST", "/v1/voice/speak", strings.NewReader(request.body))
		if request.token != "" {
			r.Header.Set("Authorization", "Bearer "+request.token)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, r)
		if response.Code != request.status {
			t.Fatalf("speech returned %d, expected %d", response.Code, request.status)
		}
	}
	if speech.calls != 2 || speech.texts[0] != "Hi" || speech.styles[0] != "baby" || speech.languages[0] != "en-NG" || speech.texts[1] != "How you dey?" || speech.styles[1] != "tunde" || speech.languages[1] != "pcm-NG" {
		t.Fatal("unapproved speech reached generation or selected language was lost")
	}
}

func TestPersonalSpeechPassesTheGeneratedReplyToVoiceWithoutRegeneratingIt(t *testing.T) {
	reply := "I'm sorry you are carrying so much right now. I can listen, or we can work through one next step together."
	speech := &sampleSpeech{}
	router := NewRouter(nil, Dependencies{Auth: testAuthAPI{}, Synthesis: speech})
	request := httptest.NewRequest("POST", "/v1/voice/speak",
		strings.NewReader(`{"text":"`+reply+`","style":"ada","rate":1,"language":"en-NG"}`))
	request.Header.Set("Authorization", "Bearer test")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != 200 || speech.calls != 1 || speech.texts[0] != reply {
		t.Fatalf("voice did not synthesize the exact generated reply: status = %d, text = %q", response.Code, speech.texts)
	}
}
