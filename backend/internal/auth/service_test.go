package auth

import (
	"bytes"
	"context"
	"crypto/sha256"
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

func (store *memoryAuthStore) SetCountry(_ context.Context, owner, code string, onlyIfMissing bool) (string, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if owner != store.user.ID {
		return "", ErrUnauthenticated
	}
	if !onlyIfMissing || store.user.CountryCode == "" {
		store.user.CountryCode = code
	}
	return store.user.CountryCode, nil
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
	if challenge.Session != nil {
		t.Fatal("OTP-enabled registration issued a session before code verification")
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

func TestDevelopmentRegistrationCreatesRevocableSessionWithoutSMS(t *testing.T) {
	store := newMemoryAuthStore()
	service, err := NewDevelopmentService(store)
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.RequestRegistration(context.Background(), Profile{
		FullName: "Development Test", DateOfBirth: "1990-01-01", PhoneNumber: "+2348012345678",
	}, "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	if result.Session == nil || result.ID != "" || result.Session.User.FullName != "Development Test" {
		t.Fatal("development registration did not return a session without a public challenge")
	}
	if len(store.challenges) != 0 {
		t.Fatal("development registration left a reusable challenge")
	}
	hash := sha256.Sum256([]byte(result.Session.Token))
	if !bytes.Equal(hash[:], store.session.TokenHash) {
		t.Fatal("session token was not stored as a hash")
	}
	if _, err := service.Authenticate(context.Background(), result.Session.Token); err != nil {
		t.Fatalf("development session could not authenticate: %v", err)
	}
	if _, err := service.Verify(context.Background(), "anything", "000000"); !errors.Is(err, ErrInvalidChallenge) {
		t.Fatal("public OTP verification was accepted while disabled")
	}
	if err := service.Logout(context.Background(), result.Session.Token); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Authenticate(context.Background(), result.Session.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("logged-out development session still authenticated")
	}
}

type developmentFailureStore struct {
	*memoryAuthStore
	eligible    bool
	createError error
	verifyError error
}

func (store developmentFailureStore) CreateChallenge(ctx context.Context, challenge Challenge) (bool, error) {
	if !store.eligible || store.createError != nil {
		return false, store.createError
	}
	return store.memoryAuthStore.CreateChallenge(ctx, challenge)
}

func (store developmentFailureStore) VerifyChallenge(ctx context.Context, id string, hash []byte, record SessionRecord, now time.Time) (User, error) {
	if store.verifyError != nil {
		return User{}, store.verifyError
	}
	return store.memoryAuthStore.VerifyChallenge(ctx, id, hash, record, now)
}

func TestDevelopmentLoginRetainsEligibilityAndFailureChecks(t *testing.T) {
	storeError := errors.New("database unavailable")
	for _, test := range []struct {
		name                                string
		eligible                            bool
		createError, verifyError, wantError error
	}{
		{name: "eligible account", eligible: true},
		{name: "unknown account", wantError: ErrInvalidProfile},
		{name: "rate limited", createError: ErrRateLimited, wantError: ErrRateLimited},
		{name: "database unavailable", createError: storeError, wantError: storeError},
		{name: "session failure", eligible: true, verifyError: storeError, wantError: storeError},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := developmentFailureStore{newMemoryAuthStore(), test.eligible, test.createError, test.verifyError}
			service, err := NewDevelopmentService(store)
			if err != nil {
				t.Fatal(err)
			}
			result, err := service.RequestLogin(context.Background(), "+2348012345678", "127.0.0.1")
			if !errors.Is(err, test.wantError) {
				t.Fatalf("RequestLogin() error = %v, want %v", err, test.wantError)
			}
			if (result.Session != nil) != (test.wantError == nil) {
				t.Fatal("session returned for failed login or missing from successful login")
			}
			if len(store.challenges) != 0 {
				t.Fatal("login left an unconsumed challenge")
			}
		})
	}
	service, err := NewDevelopmentService(newMemoryAuthStore())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.RequestLogin(context.Background(), "invalid", ""); !errors.Is(err, ErrInvalidProfile) {
		t.Fatal("development login skipped phone validation")
	}
	if _, err := service.RequestRegistration(context.Background(), Profile{}, ""); !errors.Is(err, ErrInvalidProfile) {
		t.Fatal("development registration skipped profile validation")
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
