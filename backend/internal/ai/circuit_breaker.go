package ai

import (
	"sync"
	"time"
)

type circuitBreaker struct {
	mu           sync.Mutex
	failures     int
	openUntil    time.Time
	probeRunning bool
}

func (breaker *circuitBreaker) allow(now time.Time) bool {
	breaker.mu.Lock()
	defer breaker.mu.Unlock()

	if breaker.openUntil.IsZero() {
		return true
	}
	if now.Before(breaker.openUntil) || breaker.probeRunning {
		return false
	}
	breaker.probeRunning = true
	return true
}

func (breaker *circuitBreaker) recordFailure(now time.Time, retryable bool) {
	breaker.mu.Lock()
	defer breaker.mu.Unlock()

	if breaker.probeRunning {
		breaker.probeRunning = false
		if retryable {
			breaker.openUntil = now.Add(circuitOpenDuration)
			return
		}
		breaker.openUntil = time.Time{}
		breaker.failures = 0
		return
	}
	if !retryable {
		return
	}
	breaker.failures++
	if breaker.failures >= circuitFailureLimit {
		breaker.openUntil = now.Add(circuitOpenDuration)
	}
}

func (breaker *circuitBreaker) recordSuccess() {
	breaker.mu.Lock()
	breaker.failures = 0
	breaker.openUntil = time.Time{}
	breaker.probeRunning = false
	breaker.mu.Unlock()
}
