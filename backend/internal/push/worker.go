package push

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"
)

const (
	defaultInterval = 30 * time.Second
	scheduleGrace   = 3 * time.Minute
	batchSize       = 100
	sendConcurrency = 10
	maxAttempts     = 5
)

type Store interface {
	Register(context.Context, string, Registration) error
	Unregister(context.Context, string, string) error
	ScheduleDueCheckIns(context.Context, time.Time, time.Duration) error
	ClaimPending(context.Context, time.Time, int) ([]Delivery, error)
	RecordAccepted(context.Context, int64, string, time.Time) error
	RecordFailure(context.Context, Delivery, string, time.Time, bool, bool, time.Time) error
}

type Worker struct {
	store  Store
	sender Sender
	logger *slog.Logger
}

func NewWorker(store Store, sender Sender, logger *slog.Logger) *Worker {
	if logger == nil {
		logger = slog.Default()
	}
	return &Worker{store: store, sender: sender, logger: logger}
}

func (worker *Worker) Process(ctx context.Context, now time.Time) error {
	var failures []error
	if err := worker.store.ScheduleDueCheckIns(ctx, now, scheduleGrace); err != nil {
		failures = append(failures, fmt.Errorf("schedule due check-ins: %w", err))
	}
	deliveries, err := worker.store.ClaimPending(ctx, now, batchSize)
	if err != nil {
		failures = append(failures, fmt.Errorf("claim push deliveries: %w", err))
		return errors.Join(failures...)
	}
	failureChannel := make(chan error, len(deliveries)+1)
	semaphore := make(chan struct{}, sendConcurrency)
	var wait sync.WaitGroup
dispatch:
	for _, delivery := range deliveries {
		select {
		case semaphore <- struct{}{}:
		case <-ctx.Done():
			failureChannel <- ctx.Err()
			break dispatch
		}
		wait.Add(1)
		go func(delivery Delivery) {
			defer wait.Done()
			defer func() { <-semaphore }()
			if err := worker.deliver(ctx, delivery, now); err != nil {
				failureChannel <- err
			}
		}(delivery)
	}
	wait.Wait()
	close(failureChannel)
	for err := range failureChannel {
		failures = append(failures, err)
	}
	return errors.Join(failures...)
}

func (worker *Worker) deliver(ctx context.Context, delivery Delivery, now time.Time) error {
	ticket, sendErr := worker.sender.Send(ctx, Message{
		Token: delivery.Token,
		Title: delivery.Title,
		Body:  delivery.Body,
		Data:  delivery.Data,
	})
	if sendErr == nil {
		if err := worker.store.RecordAccepted(ctx, delivery.ID, ticket.ID, now); err != nil {
			return fmt.Errorf("record accepted push delivery %d: %w", delivery.ID, err)
		}
		return nil
	}
	var deliveryErr *DeliveryError
	if !errors.As(sendErr, &deliveryErr) {
		deliveryErr = &DeliveryError{Code: "push_send_failed", Retryable: true}
	}
	retry := deliveryErr.Retryable && delivery.Attempts < maxAttempts
	retryAt := time.Time{}
	if retry {
		retryAt = now.Add(retryDelay(delivery.Attempts))
	}
	if err := worker.store.RecordFailure(ctx, delivery, deliveryErr.Code, retryAt,
		retry, deliveryErr.DeviceNotRegistered, now); err != nil {
		return fmt.Errorf("record failed push delivery %d: %w", delivery.ID, err)
	}
	if !retry {
		worker.logger.Warn("push delivery failed permanently", "delivery_id", delivery.ID, "error_code", deliveryErr.Code)
	}
	return nil
}

func (worker *Worker) Run(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = defaultInterval
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		if err := worker.Process(ctx, time.Now()); err != nil && ctx.Err() == nil {
			worker.logger.Error("push notification processing failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func retryDelay(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	delay := 30 * time.Second
	for i := 1; i < attempt && delay < time.Hour; i++ {
		delay *= 2
	}
	if delay > time.Hour {
		return time.Hour
	}
	return delay
}
