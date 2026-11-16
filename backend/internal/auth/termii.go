package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type TermiiSender struct {
	apiKey   string
	senderID string
	client   *http.Client
	endpoint string
}

func NewTermiiSender(apiKey, senderID, baseURL string) (*TermiiSender, error) {
	apiKey = strings.TrimSpace(apiKey)
	senderID = strings.TrimSpace(senderID)
	baseURL = strings.TrimSpace(baseURL)
	if apiKey == "" || senderID == "" || baseURL == "" {
		return nil, errors.New("TERMI_API_KEY, TERMI_SENDER_ID, and TERMI_API_BASE_URL are required")
	}
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" ||
		(parsed.Path != "" && parsed.Path != "/") {
		return nil, errors.New("TERMI_API_BASE_URL must be an HTTPS origin without credentials, path, query, or fragment")
	}
	return &TermiiSender{
		apiKey:   apiKey,
		senderID: senderID,
		client:   &http.Client{Timeout: 10 * time.Second},
		endpoint: strings.TrimRight(baseURL, "/") + "/api/sms/send",
	}, nil
}

func (sender *TermiiSender) SendCode(ctx context.Context, phoneNumber, code string) error {
	payload := struct {
		To      string `json:"to"`
		From    string `json:"from"`
		SMS     string `json:"sms"`
		Type    string `json:"type"`
		Channel string `json:"channel"`
		APIKey  string `json:"api_key"`
	}{
		To:      strings.TrimPrefix(phoneNumber, "+"),
		From:    sender.senderID,
		SMS:     fmt.Sprintf("Your My PADI verification code is %s. It expires in 5 minutes. Do not share it.", code),
		Type:    "plain",
		Channel: "generic",
		APIKey:  sender.apiKey,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode Termii SMS request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, sender.endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create Termii SMS request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := sender.client.Do(request)
	if err != nil {
		return fmt.Errorf("send Termii SMS request: %w", err)
	}
	defer response.Body.Close()
	if _, err := io.Copy(io.Discard, io.LimitReader(response.Body, 4096)); err != nil {
		return fmt.Errorf("read Termii SMS response: %w", err)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("Termii rejected SMS request with HTTP %d", response.StatusCode)
	}
	return nil
}
