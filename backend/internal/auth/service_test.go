package auth

import (
	"bytes"
	"context"
	"crypto/subtle"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

type memoryAuthStore struct {
	mu         sync.Mutex
	challenges map[string]Challenge
	session    SessionRecord
	user       User
}

func newMemoryAuthStore() *memoryAuthStore {
	return &memoryAuthStore{challenges: make(map[string]Challenge)}
}

func (store *memoryAuthStore) CreateChallenge(_ context.Context, challenge Challenge) (bool, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.challenges[challenge.ID] = challenge
	return true, nil
}

func (store *memoryAuthStore) CancelChallenge(_ context.Context, id string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	delete(store.challenges, id)
	return nil
}

func (store *memoryAuthStore) VerifyChallenge(_ context.Context, id string, codeHash []byte, session SessionRecord, now time.Time) (User, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	challenge, exists := store.challenges[id]
	if !exists || !challenge.ExpiresAt.After(now) || !hmacEqual(challenge.CodeHash, codeHash) {
		return User{}, ErrInvalidChallenge
	}
	delete(store.challenges, id)
	store.session = session
	store.user = User{ID: session.UserID, FullName: challenge.FullName}
	return store.user, nil
}

func (store *memoryAuthStore) ResolveSession(context.Context, []byte, time.Time) (User, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.session.UserID == "" {
		return User{}, ErrUnauthenticated
	}
	return store.user, nil
}

func (store *memoryAuthStore) RevokeSession(context.Context, []byte, time.Time) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.session = SessionRecord{}
	return nil
}

type captureCodeSender struct {
	phone string
	code  string
	err   error
}

func (sender *captureCodeSender) SendCode(_ context.Context, phone, code string) error {
	sender.phone = phone
	sender.code = code
	return sender.err
}

func TestRegistrationAndSessionVerification(t *testing.T) {
	store := newMemoryAuthStore()
	sender := &captureCodeSender{}
	service, err := NewService(store, sender, []byte("0123456789abcdef0123456789abcdef"))
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	service.now = func() time.Time { return time.Date(2026, 11, 16, 12, 0, 0, 0, time.UTC) }

	challenge, err := service.RequestRegistration(context.Background(), Profile{
		FullName: "Ada Lovelace", DateOfBirth: "1815-12-10", PhoneNumber: "+2348012345678",
	}, "127.0.0.1")
	if err != nil {
		t.Fatalf("RequestRegistration() error = %v", err)
	}
	if challenge.ID == "" || sender.phone != "+2348012345678" || !ValidVerificationCode(sender.code) {
		t.Fatalf("challenge = %+v, sender phone/code = %q/%q", challenge, sender.phone, sender.code)
	}
	if challenge.Message == sender.code {
		t.Fatal("verification code was returned to the caller")
	}

	wrongCode := "000000"
	if sender.code == wrongCode {
		wrongCode = "000001"
	}
	if _, err := service.Verify(context.Background(), challenge.ID, wrongCode); !errors.Is(err, ErrInvalidChallenge) {
		t.Fatalf("Verify() with wrong code error = %v, want invalid challenge", err)
	}
	session, err := service.Verify(context.Background(), challenge.ID, sender.code)
	if err != nil {
		t.Fatalf("Verify() error = %v", err)
	}
	if session.Token == "" || session.User.FullName != "Ada Lovelace" ||
		!session.ExpiresAt.Equal(service.now().Add(sessionLifetime)) {
		t.Fatalf("session = %+v", session)
	}
	if _, err := service.Verify(context.Background(), challenge.ID, sender.code); !errors.Is(err, ErrInvalidChallenge) {
		t.Fatalf("replayed Verify() error = %v, want invalid challenge", err)
	}
}

func TestAuthenticationRequiresStrongPepperAndValidPhone(t *testing.T) {
	if _, err := NewService(newMemoryAuthStore(), &captureCodeSender{}, []byte("too short")); err == nil {
		t.Fatal("NewService() accepted a weak pepper")
	}
	if _, err := NewService(newMemoryAuthStore(), &captureCodeSender{}, make([]byte, 32)); err != nil {
		t.Fatalf("NewService() rejected a 32-byte pepper: %v", err)
	}
	if ValidPhoneNumber("2348012345678") || !ValidPhoneNumber("+2348012345678") {
		t.Fatal("ValidPhoneNumber() did not enforce E.164 format")
	}
}

func TestFailedSMSDeliveryInvalidatesChallenge(t *testing.T) {
	store := newMemoryAuthStore()
	sender := &captureCodeSender{err: errors.New("Termii unavailable")}
	service, err := NewService(store, sender, []byte("0123456789abcdef0123456789abcdef"))
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	_, err = service.RequestRegistration(context.Background(), Profile{
		FullName: "Ada Lovelace", DateOfBirth: "1815-12-10", PhoneNumber: "+2348012345678",
	}, "127.0.0.1")
	if err == nil {
		t.Fatal("RequestRegistration() error = nil, want SMS delivery failure")
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if len(store.challenges) != 0 {
		t.Fatalf("stored challenges = %d, want failed-delivery challenge invalidated", len(store.challenges))
	}
}

func TestTermiiSenderUsesConfiguredSMSRequest(t *testing.T) {
	var requestBody []byte
	sender, err := NewTermiiSender("test-api-key", "PADI", "https://api.ng.termii.com")
	if err != nil {
		t.Fatalf("NewTermiiSender() error = %v", err)
	}
	sender.endpoint = "https://termii.test/send"
	sender.client = testHTTPClient(func(requestBodyValue []byte) {
		requestBody = append([]byte(nil), requestBodyValue...)
	})
	if err := sender.SendCode(context.Background(), "+2348012345678", "012345"); err != nil {
		t.Fatalf("SendCode() error = %v", err)
	}
	for _, expected := range [][]byte{
		[]byte(`"to":"2348012345678"`),
		[]byte(`"from":"PADI"`),
		[]byte(`"api_key":"test-api-key"`),
		[]byte(`"sms":"Your My PADI verification code is 012345.`),
	} {
		if !bytes.Contains(requestBody, expected) {
			t.Errorf("Termii request body %s does not contain %s", requestBody, expected)
		}
	}
}

func TestTermiiSenderRequiresSecureAccountBaseURL(t *testing.T) {
	for _, baseURL := range []string{
		"http://api.ng.termii.com",
		"https://api.ng.termii.com/path",
		"https://user:password@api.ng.termii.com",
	} {
		if _, err := NewTermiiSender("key", "PADI", baseURL); err == nil {
			t.Errorf("NewTermiiSender(%q) error = nil, want invalid HTTPS origin error", baseURL)
		}
	}
}

func hmacEqual(first, second []byte) bool {
	return subtle.ConstantTimeCompare(first, second) == 1
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (roundTripper roundTripperFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return roundTripper(request)
}

func testHTTPClient(capture func([]byte)) *http.Client {
	return &http.Client{Transport: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		body, err := io.ReadAll(request.Body)
		if err != nil {
			return nil, err
		}
		capture(body)
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(`{"message":"ok"}`)),
			Header:     make(http.Header),
		}, nil
	})}
}
