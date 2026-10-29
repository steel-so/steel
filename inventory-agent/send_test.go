package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func newTestConfig(url string) *Config {
	return &Config{URL: url, Token: "tok-123"}
}

func TestSendSuccessSetsAuthAndBody(t *testing.T) {
	var gotAuth, gotPath string
	var gotBody Report
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth, gotPath = r.Header.Get("Authorization"), r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	report := &Report{AgentID: "abcdefgh", Hostname: "pc"}
	if err := send(context.Background(), srv.Client(), newTestConfig(srv.URL), report); err != nil {
		t.Fatal(err)
	}
	if gotAuth != "Bearer tok-123" || gotPath != "/api/servicedesk/inventory/report" || gotBody.Hostname != "pc" {
		t.Fatalf("auth=%q path=%q body=%+v", gotAuth, gotPath, gotBody)
	}
}

func TestSendUnauthorizedIsFatal(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	err := sendWithRetry(context.Background(), srv.Client(), newTestConfig(srv.URL), &Report{}, 4, time.Millisecond)
	var unauthorized ErrUnauthorized
	if !errors.As(err, &unauthorized) {
		t.Fatalf("expected ErrUnauthorized, got %v", err)
	}
	if calls != 1 {
		t.Fatalf("a rejected token must not be retried, got %d calls", calls)
	}
	if unauthorized.Error() == "" {
		t.Fatal("error message must not be empty")
	}
}

func TestSendRetriesServerErrors(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&calls, 1) < 3 {
			http.Error(w, "boom", http.StatusBadGateway)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	if err := sendWithRetry(context.Background(), srv.Client(), newTestConfig(srv.URL), &Report{}, 4, time.Millisecond); err != nil {
		t.Fatal(err)
	}
	if calls != 3 {
		t.Fatalf("expected 3 calls, got %d", calls)
	}
}

func TestSendGivesUpAndHonoursContext(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusInternalServerError)
	}))
	defer srv.Close()

	err := sendWithRetry(context.Background(), srv.Client(), newTestConfig(srv.URL), &Report{}, 2, time.Millisecond)
	if err == nil {
		t.Fatal("expected failure after the last attempt")
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := sendWithRetry(ctx, srv.Client(), newTestConfig(srv.URL), &Report{}, 3, time.Hour); err == nil {
		t.Fatal("expected a cancelled context to stop the retries")
	}
}

func TestReportOnce(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	var out bytes.Buffer
	collectFn := func() (*Report, error) { return &Report{Hostname: "pc"}, nil }
	if err := reportOnce(context.Background(), newTestConfig(srv.URL), collectFn, srv.Client(), &out); err != nil {
		t.Fatal(err)
	}
	if out.Len() == 0 {
		t.Fatal("expected a log line")
	}

	failing := func() (*Report, error) { return nil, errors.New("no sensors") }
	if err := reportOnce(context.Background(), newTestConfig(srv.URL), failing, srv.Client(), &out); err == nil {
		t.Fatal("expected the collect error to surface")
	}
}

func TestRunLoopStopsOnUnauthorizedAndCancel(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	// Cancelled before the initial jitter elapses: returns the context error.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	collectFn := func() (*Report, error) { return &Report{}, nil }
	var out bytes.Buffer
	if err := runLoop(ctx, newTestConfig(srv.URL), collectFn, srv.Client(), &out); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled, got %v", err)
	}
	if err := sleep(context.Background(), time.Millisecond); err != nil {
		t.Fatal(err)
	}
}
