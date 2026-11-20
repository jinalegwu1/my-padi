package push

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestNormalizeRegistration(t *testing.T) {
	normalized, err := NormalizeRegistration(Registration{
		DeviceID: " padi_device_install_123 ",
		Token:    " ExpoPushToken[valid_123] ",
		Platform: " ios ",
	})
	if err != nil {
		t.Fatal(err)
	}
	if normalized.DeviceID != "padi_device_install_123" || normalized.Token != "ExpoPushToken[valid_123]" ||
		normalized.Platform != "ios" || normalized.Language != "en-NG" {
		t.Fatalf("normalized registration = %+v", normalized)
	}
	for _, invalid := range []Registration{
		{DeviceID: "short", Token: "ExpoPushToken[x]", Platform: "ios"},
		{DeviceID: "padi_device_install_123", Token: "https://example.test", Platform: "ios"},
		{DeviceID: "padi_device_install_123", Token: "ExpoPushToken[x]", Platform: "web"},
		{DeviceID: "padi_device_install_123", Token: "ExpoPushToken[x]", Platform: "ios", Language: "not a locale"},
	} {
		if _, err := NormalizeRegistration(invalid); !errors.Is(err, ErrInvalidRegistration) {
			t.Errorf("NormalizeRegistration(%+v) error = %v, want invalid registration", invalid, err)
		}
	}
}

func TestExpoSenderSendsAuthenticatedMessageAndReadsTicket(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer access-token" {
			t.Errorf("request headers/method = %s/%q", r.Method, r.Header.Get("Authorization"))
		}
		var payload Message
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("decode message: %v", err)
		}
		if payload.Token != "ExpoPushToken[device]" || payload.Title != "Good morning from PADI" ||
			payload.Data["kind"] != "padi_check_in" || payload.Sound != "default" || payload.Priority != "high" {
			t.Errorf("push payload = %+v", payload)
		}
		_, _ = w.Write([]byte(`{"data":{"status":"ok","id":"ticket-123"}}`))
	}))
	defer server.Close()
	sender := NewExpoSender(server.Client(), "access-token")
	sender.endpoint = server.URL
	ticket, err := sender.Send(context.Background(), Message{
		Token: "ExpoPushToken[device]", Title: "Good morning from PADI", Body: "PADI is here.",
		Data: map[string]string{"kind": "padi_check_in"},
	})
	if err != nil || ticket.ID != "ticket-123" {
		t.Fatalf("Send() = %+v, %v", ticket, err)
	}
}

func TestExpoSenderClassifiesRejectedDevicesAndRateLimits(t *testing.T) {
	for _, test := range []struct {
		name        string
		status      int
		body        string
		wantRetry   bool
		wantInvalid bool
	}{
		{
			name: "invalid device", status: http.StatusOK,
			body:        `{"data":{"status":"error","details":{"error":"DeviceNotRegistered"}}}`,
			wantInvalid: true,
		},
		{name: "rate limited", status: http.StatusTooManyRequests, body: `{}`, wantRetry: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(test.status)
				_, _ = w.Write([]byte(test.body))
			}))
			defer server.Close()
			sender := NewExpoSender(server.Client(), "")
			sender.endpoint = server.URL
			_, err := sender.Send(context.Background(), Message{Token: "ExpoPushToken[device]"})
			var deliveryError *DeliveryError
			if !errors.As(err, &deliveryError) || deliveryError.Retryable != test.wantRetry ||
				deliveryError.DeviceNotRegistered != test.wantInvalid {
				t.Fatalf("Send() error = %#v, want retry=%v invalid-device=%v", err, test.wantRetry, test.wantInvalid)
			}
		})
	}
}

type testStore struct {
	scheduled int
	claimed   []Delivery
	accepted  []Ticket
	failures  []DeliveryError
	retries   []bool
	retryAt   []time.Time
}

func (store *testStore) Register(context.Context, string, Registration) error { return nil }
func (store *testStore) Unregister(context.Context, string, string) error     { return nil }
func (store *testStore) ScheduleDueCheckIns(context.Context, time.Time, time.Duration) error {
	store.scheduled++
	return nil
}
func (store *testStore) ClaimPending(context.Context, time.Time, int) ([]Delivery, error) {
	return store.claimed, nil
}
func (store *testStore) RecordAccepted(_ context.Context, _ int64, ticketID string, _ time.Time) error {
	store.accepted = append(store.accepted, Ticket{ID: ticketID})
	return nil
}
func (store *testStore) RecordFailure(_ context.Context, _ Delivery, code string, retryAt time.Time, retry bool, invalid bool, _ time.Time) error {
	store.failures = append(store.failures, DeliveryError{Code: code, DeviceNotRegistered: invalid})
	store.retries = append(store.retries, retry)
	store.retryAt = append(store.retryAt, retryAt)
	return nil
}

type testSender struct {
	ticket Ticket
	err    error
}

func (sender testSender) Send(context.Context, Message) (Ticket, error) {
	return sender.ticket, sender.err
}

func TestWorkerSchedulesAndRecordsAcceptedPushes(t *testing.T) {
	store := &testStore{claimed: []Delivery{{
		ID: 1, UserID: "user", DeviceID: "device", Token: "ExpoPushToken[device]",
		Title: "Good morning", Body: "PADI is here.",
		Data: map[string]string{"kind": "padi_check_in"}, Attempts: 1,
	}}}
	worker := NewWorker(store, testSender{ticket: Ticket{ID: "expo-ticket"}}, nil)
	if err := worker.Process(context.Background(), time.Now()); err != nil {
		t.Fatal(err)
	}
	if store.scheduled != 1 || len(store.accepted) != 1 || store.accepted[0].ID != "expo-ticket" {
		t.Fatalf("worker result: schedules=%d accepted=%+v", store.scheduled, store.accepted)
	}
}

func TestWorkerSchedulesRetryForTransientExpoFailure(t *testing.T) {
	now := time.Date(2026, time.November, 20, 9, 0, 0, 0, time.UTC)
	store := &testStore{claimed: []Delivery{{
		ID: 1, UserID: "user", DeviceID: "device", Token: "ExpoPushToken[device]",
		Title: "Good morning", Body: "PADI is here.", Attempts: 1,
	}}}
	sender := testSender{err: &DeliveryError{Code: "expo_unavailable", Retryable: true}}
	worker := NewWorker(store, sender, nil)
	if err := worker.Process(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	if len(store.failures) != 1 || store.failures[0].Code != "expo_unavailable" ||
		len(store.retries) != 1 || !store.retries[0] ||
		!store.retryAt[0].Equal(now.Add(30*time.Second)) {
		t.Fatalf("worker retry state: failures=%+v retry=%v retryAt=%v", store.failures, store.retries, store.retryAt)
	}
}

func TestCheckInContentIsLocalizedAndRejectsUnknownSlots(t *testing.T) {
	title, body, err := CheckInContent("pcm-NG", "afternoon")
	if err != nil || title != "Small time with PADI" || body == "" {
		t.Fatalf("Pidgin content = %q/%q, %v", title, body, err)
	}
	if _, _, err := CheckInContent("en-NG", "unscheduled"); err == nil {
		t.Fatal("unknown notification slot was accepted")
	}
}
