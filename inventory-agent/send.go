package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// ErrUnauthorized means the token is wrong or revoked: retrying is pointless.
type ErrUnauthorized struct{ Status int }

func (e ErrUnauthorized) Error() string {
	return fmt.Sprintf("server rejected the token (HTTP %d): create a new one in Settings > Inventory", e.Status)
}

// send posts the report once.
func send(ctx context.Context, client *http.Client, cfg *Config, report *Report) error {
	body, err := json.Marshal(report)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.ReportURL(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.Token)
	req.Header.Set("User-Agent", "steel-inventory-agent/"+version)

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 512))

	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		return nil
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		return ErrUnauthorized{Status: resp.StatusCode}
	default:
		return fmt.Errorf("server answered HTTP %d: %s", resp.StatusCode, bytes.TrimSpace(snippet))
	}
}

// sendWithRetry retries transient failures with exponential backoff.
func sendWithRetry(ctx context.Context, client *http.Client, cfg *Config, report *Report, attempts int, base time.Duration) error {
	var last error
	delay := base
	for i := 0; i < attempts; i++ {
		last = send(ctx, client, cfg, report)
		if last == nil {
			return nil
		}
		if _, fatal := last.(ErrUnauthorized); fatal {
			return last
		}
		if i == attempts-1 {
			break
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delay):
		}
		delay *= 2
	}
	return last
}
