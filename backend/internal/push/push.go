package push

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

var (
	ErrInvalidRegistration = errors.New("push device registration is invalid")
	deviceIDPattern        = regexp.MustCompile(`^[A-Za-z0-9_-]{16,128}$`)
	expoTokenPattern       = regexp.MustCompile(`^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$`)
	languagePattern        = regexp.MustCompile(`^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$`)
)

const ExpoEndpoint = "https://exp.host/--/api/v2/push/send"

type Registration struct {
	DeviceID string `json:"device_id"`
	Token    string `json:"expo_push_token"`
	Platform string `json:"platform"`
	Language string `json:"language"`
}

func NormalizeDeviceID(deviceID string) (string, error) {
	deviceID = strings.TrimSpace(deviceID)
	if !deviceIDPattern.MatchString(deviceID) {
		return "", ErrInvalidRegistration
	}
	return deviceID, nil
}

func NormalizeRegistration(registration Registration) (Registration, error) {
	var err error
	registration.DeviceID, err = NormalizeDeviceID(registration.DeviceID)
	if err != nil {
		return Registration{}, err
	}
	registration.Token = strings.TrimSpace(registration.Token)
	registration.Platform = strings.TrimSpace(registration.Platform)
	registration.Language = strings.TrimSpace(registration.Language)
	if !expoTokenPattern.MatchString(registration.Token) ||
		(registration.Platform != "ios" && registration.Platform != "android") ||
		(len(registration.Language) > 35) ||
		(registration.Language != "" && !languagePattern.MatchString(registration.Language)) {
		return Registration{}, ErrInvalidRegistration
	}
	if registration.Language == "" {
		registration.Language = "en-NG"
	}
	return registration, nil
}

type Message struct {
	Token    string            `json:"to"`
	Title    string            `json:"title"`
	Body     string            `json:"body"`
	Data     map[string]string `json:"data,omitempty"`
	Sound    string            `json:"sound"`
	Priority string            `json:"priority"`
}

type Delivery struct {
	ID       int64
	UserID   string
	DeviceID string
	Token    string
	Title    string
	Body     string
	Data     map[string]string
	Attempts int
}

type Ticket struct {
	ID string
}

type DeliveryError struct {
	Code                string
	Retryable           bool
	DeviceNotRegistered bool
}

func (err *DeliveryError) Error() string {
	return err.Code
}

type Sender interface {
	Send(context.Context, Message) (Ticket, error)
}

type ExpoSender struct {
	client      *http.Client
	accessToken string
	endpoint    string
}

func NewExpoSender(client *http.Client, accessToken string) *ExpoSender {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &ExpoSender{client: client, accessToken: strings.TrimSpace(accessToken), endpoint: ExpoEndpoint}
}

func (sender *ExpoSender) Send(ctx context.Context, message Message) (Ticket, error) {
	message.Sound = "default"
	message.Priority = "high"
	body, err := json.Marshal(message)
	if err != nil {
		return Ticket{}, &DeliveryError{Code: "invalid_push_message"}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, sender.endpoint, bytes.NewReader(body))
	if err != nil {
		return Ticket{}, &DeliveryError{Code: "push_request_failed"}
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	if sender.accessToken != "" {
		request.Header.Set("Authorization", "Bearer "+sender.accessToken)
	}
	response, err := sender.client.Do(request)
	if err != nil {
		return Ticket{}, &DeliveryError{Code: "expo_unavailable", Retryable: true}
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 64*1024))
		return Ticket{}, &DeliveryError{
			Code:      "expo_http_error",
			Retryable: response.StatusCode == http.StatusTooManyRequests || response.StatusCode >= http.StatusInternalServerError,
		}
	}
	var envelope struct {
		Data json.RawMessage `json:"data"`
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, 64*1024))
	if err := decoder.Decode(&envelope); err != nil {
		return Ticket{}, &DeliveryError{Code: "expo_invalid_response", Retryable: true}
	}
	var ticket struct {
		Status  string `json:"status"`
		ID      string `json:"id"`
		Message string `json:"message"`
		Details struct {
			Error string `json:"error"`
		} `json:"details"`
	}
	if len(envelope.Data) == 0 || json.Unmarshal(envelope.Data, &ticket) != nil {
		var tickets []struct {
			Status  string `json:"status"`
			ID      string `json:"id"`
			Message string `json:"message"`
			Details struct {
				Error string `json:"error"`
			} `json:"details"`
		}
		if err := json.Unmarshal(envelope.Data, &tickets); err != nil || len(tickets) != 1 {
			return Ticket{}, &DeliveryError{Code: "expo_invalid_response", Retryable: true}
		}
		ticket = tickets[0]
	}
	if ticket.Status != "ok" || ticket.ID == "" {
		code := ticket.Details.Error
		if code == "" {
			code = "expo_delivery_rejected"
		}
		return Ticket{}, &DeliveryError{
			Code:                code,
			Retryable:           code != "DeviceNotRegistered",
			DeviceNotRegistered: code == "DeviceNotRegistered",
		}
	}
	return Ticket{ID: ticket.ID}, nil
}

func CheckInContent(language, slot string) (string, string, error) {
	language = strings.ToLower(language)
	switch slot {
	case "morning":
		switch {
		case strings.HasPrefix(language, "fr"):
			return "Petit bonjour de PADI", "Une nouvelle journée commence. Si vous voulez parler, PADI est là.", nil
		case language == "pcm-ng":
			return "Morning from PADI", "New day don start. If you wan talk, PADI dey here.", nil
		default:
			return "Good morning from PADI", "A new day is here. If you want to talk, PADI is here.", nil
		}
	case "afternoon":
		switch {
		case strings.HasPrefix(language, "fr"):
			return "Une pause avec PADI", "Si vous en avez besoin, prenez un moment. PADI est là pour vous écouter.", nil
		case language == "pcm-ng":
			return "Small time with PADI", "If e go help, take small break. PADI dey here to listen.", nil
		default:
			return "A moment with PADI", "If it would help, take a small pause. PADI is here to listen.", nil
		}
	case "evening":
		switch {
		case strings.HasPrefix(language, "fr"):
			return "PADI est là", "Comment s'est passée votre journée ? Vous pouvez en parler avec PADI.", nil
		case language == "pcm-ng":
			return "PADI dey here", "How your day go? You fit gist with PADI anytime.", nil
		default:
			return "PADI is here", "How was your day? You can talk it through with PADI.", nil
		}
	default:
		return "", "", fmt.Errorf("unsupported check-in slot %q", slot)
	}
}
