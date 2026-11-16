package ai

import (
	"context"
	"errors"
	"fmt"
	"time"
)

type MessageRole string

const (
	RoleSystem    MessageRole = "system"
	RoleUser      MessageRole = "user"
	RoleAssistant MessageRole = "assistant"
)

type Task string

const (
	TaskConversation Task = "conversation"
	TaskReasoning    Task = "reasoning"
	TaskExtraction   Task = "extraction"
)

type Complexity string

const (
	ComplexitySimple  Complexity = "simple"
	ComplexityNormal  Complexity = "normal"
	ComplexityComplex Complexity = "complex"
)

type Message struct {
	Role    MessageRole `json:"role"`
	Content string      `json:"content"`
}

// Request is provider-neutral. Task and Complexity may be omitted and inferred.
type Request struct {
	Messages   []Message  `json:"messages"`
	Task       Task       `json:"task,omitempty"`
	Complexity Complexity `json:"complexity,omitempty"`
}

type Usage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

type Response struct {
	Content  string `json:"content"`
	Provider string `json:"provider"`
	Model    string `json:"model"`
	Usage    Usage  `json:"usage"`
}

type ModelConfig struct {
	ID                   string  `json:"id"`
	Provider             string  `json:"provider"`
	Model                string  `json:"model"`
	Endpoint             string  `json:"endpoint,omitempty"`
	APIKeyEnv            string  `json:"api_key_env"`
	TimeoutMillis        int     `json:"timeout_ms,omitempty"`
	Retries              int     `json:"retries,omitempty"`
	InputCostPerMillion  float64 `json:"input_cost_per_million,omitempty"`
	OutputCostPerMillion float64 `json:"output_cost_per_million,omitempty"`
}

type RoutingConfig struct {
	PrimaryModel   string
	FastModel      string
	ReasoningModel string
	BackupModel    string
}

type Provider interface {
	Generate(context.Context, ModelConfig, Request) (Response, error)
}

type Event struct {
	ModelID       string
	Provider      string
	Duration      time.Duration
	Success       bool
	ErrorClass    string
	Usage         Usage
	EstimatedCost float64
}

type Observer interface {
	ObserveAI(Event)
}

type ObserverFunc func(Event)

func (observer ObserverFunc) ObserveAI(event Event) {
	observer(event)
}

var ErrCircuitOpen = errors.New("AI provider circuit is open")

type ProviderError struct {
	Provider  string
	Status    int
	Retryable bool
	Err       error
}

func (err *ProviderError) Error() string {
	if err.Status != 0 {
		return fmt.Sprintf("%s provider returned HTTP %d", err.Provider, err.Status)
	}
	return fmt.Sprintf("%s provider request failed", err.Provider)
}

func (err *ProviderError) Unwrap() error {
	return err.Err
}

func retryable(err error) bool {
	var providerErr *ProviderError
	return errors.As(err, &providerErr) && providerErr.Retryable
}
