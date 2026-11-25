package ai

import (
	"errors"
	"strings"
)

// Finish reasons are delivery metadata, not personality or response templates.
func completionError(provider, reason string, streamEnded bool) error {
	if reason == "length" || reason == "MAX_TOKENS" || reason == "max_tokens" {
		return &ProviderError{Provider: provider, Err: errors.Join(ErrIncompleteProviderResponse, ErrOutputTokenLimit)}
	}
	completed := reason == "stop" || reason == "STOP" || reason == "end_turn" || reason == "stop_sequence" ||
		(provider == ProviderAnthropic && reason == "refusal")
	if !streamEnded || !completed {
		return &ProviderError{Provider: provider, Retryable: reason == "", Err: ErrIncompleteProviderResponse}
	}
	return nil
}

func validateCompleteText(provider, text string) error {
	text = strings.TrimSpace(text)
	if text == "" {
		return &ProviderError{Provider: provider, Retryable: true, Err: ErrEmptyProviderResponse}
	}
	// A dangling clause is not made complete by a provider's stop signal.
	lastLine := strings.TrimSpace(text[strings.LastIndex(text, "\n")+1:])
	if strings.Trim(lastLine, "—–-") != "" && (strings.HasSuffix(text, "—") || strings.HasSuffix(text, "–") || strings.HasSuffix(text, "-")) {
		return &ProviderError{Provider: provider, Err: ErrIncompleteProviderResponse}
	}
	return nil
}

func largerCompletionBudget(request Request) (Request, bool) {
	budget := configuredMaxOutputTokens(request)
	if budget >= maxOutputTokens {
		return request, false
	}
	request.MaxOutputTokens = min(maxOutputTokens, max(defaultMaxOutputTokens, budget*2))
	return request, true
}
