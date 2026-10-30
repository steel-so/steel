package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const (
	oldBinary = "old-binary-contents"
	newBinary = "new-binary-contents-v2"
)

func shaHex(body []byte) string {
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:])
}

func manifestFor(body []byte, ver string) string {
	return fmt.Sprintf(
		`{"updateAvailable":true,"version":%q,"sha256":%q,"size":%d,"downloadPath":"/api/servicedesk/inventory/agent/download/%s"}`,
		ver, shaHex(body), len(body), ver)
}

// updateFixture is a fake Steel server for the version and download endpoints.
//
// status is the answer of the version endpoint (0 means 200), manifest the JSON
// of its "data" object, headerSHA the X-Content-SHA256 header of the download
// (omitted when empty).
type updateFixture struct {
	status        int
	manifest      string
	body          []byte
	headerSHA     string
	versionCalls  int32
	downloadCalls int32
}

func (f *updateFixture) start(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok-123" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/api/servicedesk/inventory/agent/version":
			atomic.AddInt32(&f.versionCalls, 1)
			if f.status != 0 {
				w.WriteHeader(f.status)
				return
			}
			fmt.Fprintf(w, `{"success":true,"statusCode":200,"data":%s}`, f.manifest) // nosemgrep: test server, not HTML
		case "/api/servicedesk/inventory/agent/download/2.0.0":
			atomic.AddInt32(&f.downloadCalls, 1)
			w.Header().Set("Content-Type", "application/octet-stream")
			if f.headerSHA != "" {
				w.Header().Set("X-Content-SHA256", f.headerSHA)
			}
			_, _ = w.Write(f.body) // nosemgrep: test server, not HTML
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func newExe(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "agent")
	if err := os.WriteFile(path, []byte(oldBinary), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func assertFile(t *testing.T, path, want string) {
	t.Helper()
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if string(got) != want {
		t.Fatalf("%s = %q, want %q", filepath.Base(path), got, want)
	}
}

func assertMissing(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("%s should not exist (stat error: %v)", filepath.Base(path), err)
	}
}

// stubSmoke replaces the selftest runner and records the calls.
func stubSmoke(t *testing.T, fn func(path, want string) error) *[]string {
	t.Helper()
	var calls []string
	original := smokeTest
	smokeTest = func(_ context.Context, path, want string) error {
		calls = append(calls, filepath.Base(path)+" "+want)
		return fn(path, want)
	}
	t.Cleanup(func() { smokeTest = original })
	return &calls
}

func okSmoke(string, string) error { return nil }

func TestCheckForUpdateNothingAvailable(t *testing.T) {
	fx := &updateFixture{manifest: `{"updateAvailable":false,"version":null,"sha256":null,"size":null,"downloadPath":null}`}
	srv := fx.start(t)
	exe := newExe(t)
	calls := stubSmoke(t, okSmoke)

	var out bytes.Buffer
	if err := checkForUpdate(context.Background(), newTestConfig(srv.URL), srv.Client(), exe, "1.0.0", &out); err != nil {
		t.Fatal(err)
	}
	if fx.versionCalls != 1 || fx.downloadCalls != 0 || len(*calls) != 0 {
		t.Fatalf("version=%d download=%d smoke=%v", fx.versionCalls, fx.downloadCalls, *calls)
	}
	assertFile(t, exe, oldBinary)
	assertMissing(t, exe+".new")
	assertMissing(t, markerPath(exe))
}

func TestCheckForUpdateSameVersionIsIgnored(t *testing.T) {
	body := []byte(newBinary)
	fx := &updateFixture{manifest: manifestFor(body, "2.0.0"), body: body}
	srv := fx.start(t)
	exe := newExe(t)
	stubSmoke(t, okSmoke)

	if err := checkForUpdate(context.Background(), newTestConfig(srv.URL), srv.Client(), exe, "2.0.0", &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	if fx.downloadCalls != 0 {
		t.Fatal("must not download the version that is already running")
	}
}

func TestCheckForUpdateChecksumMismatchAborts(t *testing.T) {
	good := []byte(newBinary)
	tampered := []byte(strings.Replace(newBinary, "new", "bad", 1)) // same length, different bytes
	fx := &updateFixture{manifest: manifestFor(good, "2.0.0"), body: tampered}
	srv := fx.start(t)
	exe := newExe(t)
	calls := stubSmoke(t, okSmoke)

	err := checkForUpdate(context.Background(), newTestConfig(srv.URL), srv.Client(), exe, "1.0.0", &bytes.Buffer{})
	if err == nil || errors.Is(err, errRestartRequested) {
		t.Fatalf("expected a checksum error, got %v", err)
	}
	assertFile(t, exe, oldBinary)
	assertMissing(t, exe+".new")
	assertMissing(t, exe+".old")
	assertMissing(t, markerPath(exe))
	if len(*calls) != 0 {
		t.Fatal("a corrupt download must never be executed")
	}
}

func TestCheckForUpdateHeaderDisagreementAborts(t *testing.T) {
	body := []byte(newBinary)
	fx := &updateFixture{
		manifest:  manifestFor(body, "2.0.0"),
		body:      body,
		headerSHA: strings.Repeat("a", 64),
	}
	srv := fx.start(t)
	exe := newExe(t)
	stubSmoke(t, okSmoke)

	err := checkForUpdate(context.Background(), newTestConfig(srv.URL), srv.Client(), exe, "1.0.0", &bytes.Buffer{})
	if err == nil || errors.Is(err, errRestartRequested) {
		t.Fatalf("expected a header/manifest disagreement error, got %v", err)
	}
	assertFile(t, exe, oldBinary)
	assertMissing(t, exe+".new")
	assertMissing(t, markerPath(exe))
}

func TestCheckForUpdateSelftestFailureAborts(t *testing.T) {
	body := []byte(newBinary)
	fx := &updateFixture{manifest: manifestFor(body, "2.0.0"), body: body}
	srv := fx.start(t)
	exe := newExe(t)
	stubSmoke(t, func(string, string) error { return errors.New("exit status 1") })

	err := checkForUpdate(context.Background(), newTestConfig(srv.URL), srv.Client(), exe, "1.0.0", &bytes.Buffer{})
	if err == nil || errors.Is(err, errRestartRequested) {
		t.Fatalf("expected a selftest error, got %v", err)
	}
	assertFile(t, exe, oldBinary)
	assertMissing(t, exe+".new")
	assertMissing(t, exe+".old")
	assertMissing(t, markerPath(exe))
}

func TestCheckForUpdateSuccessSwapsAndWritesMarker(t *testing.T) {
	body := []byte(newBinary)
	fx := &updateFixture{manifest: manifestFor(body, "2.0.0"), body: body, headerSHA: strings.ToUpper(shaHex(body))}
	srv := fx.start(t)
	exe := newExe(t)
	calls := stubSmoke(t, func(path, _ string) error {
		// The candidate is verified in place, next to the executable.
		assertFile(t, path, newBinary)
		return nil
	})

	var out bytes.Buffer
	err := checkForUpdate(context.Background(), newTestConfig(srv.URL), srv.Client(), exe, "1.0.0", &out)
	if !errors.Is(err, errRestartRequested) {
		t.Fatalf("expected errRestartRequested, got %v", err)
	}
	if len(*calls) != 1 || (*calls)[0] != filepath.Base(exe)+".new 2.0.0" {
		t.Fatalf("smoke calls: %v", *calls)
	}
	assertFile(t, exe, newBinary)
	assertFile(t, exe+".old", oldBinary)
	assertMissing(t, exe+".new")

	marker, err := readMarker(exe)
	if err != nil {
		t.Fatal(err)
	}
	if marker.FromVersion != "1.0.0" || marker.ToVersion != "2.0.0" || marker.Attempts != 0 || marker.CreatedAt.IsZero() {
		t.Fatalf("marker: %+v", marker)
	}
}

func TestCheckForUpdateDevNeverUpdates(t *testing.T) {
	body := []byte(newBinary)
	fx := &updateFixture{manifest: manifestFor(body, "2.0.0"), body: body}
	srv := fx.start(t)
	exe := newExe(t)
	stubSmoke(t, okSmoke)

	if err := checkForUpdate(context.Background(), newTestConfig(srv.URL), srv.Client(), exe, "dev", &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	if fx.versionCalls != 0 || fx.downloadCalls != 0 {
		t.Fatalf("a dev build must not even ask: version=%d download=%d", fx.versionCalls, fx.downloadCalls)
	}
	assertFile(t, exe, oldBinary)
}

func TestFetchManifestUnauthorized(t *testing.T) {
	fx := &updateFixture{status: http.StatusForbidden}
	srv := fx.start(t)

	_, err := fetchManifest(context.Background(), srv.Client(), newTestConfig(srv.URL), "1.0.0")
	var unauthorized ErrUnauthorized
	if !errors.As(err, &unauthorized) || unauthorized.Status != http.StatusForbidden {
		t.Fatalf("expected ErrUnauthorized(403), got %v", err)
	}

	// The wrong token is rejected by the fixture before the handler runs.
	wrong := &Config{URL: srv.URL, Token: "other"}
	_, err = fetchManifest(context.Background(), srv.Client(), wrong, "1.0.0")
	if !errors.As(err, &unauthorized) || unauthorized.Status != http.StatusUnauthorized {
		t.Fatalf("expected ErrUnauthorized(401), got %v", err)
	}

	exe := newExe(t)
	err = checkForUpdate(context.Background(), wrong, srv.Client(), exe, "1.0.0", &bytes.Buffer{})
	if !errors.As(err, &unauthorized) {
		t.Fatalf("checkForUpdate must keep ErrUnauthorized visible, got %v", err)
	}
}

func TestFetchManifestSendsPlatformAndCurrent(t *testing.T) {
	var query string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query = r.URL.RawQuery
		fmt.Fprint(w, `{"success":true,"statusCode":200,"data":{"updateAvailable":false}}`)
	}))
	defer srv.Close()

	m, err := fetchManifest(context.Background(), srv.Client(), newTestConfig(srv.URL), "1.2.3")
	if err != nil || m.UpdateAvailable {
		t.Fatalf("m=%+v err=%v", m, err)
	}
	for _, part := range []string{"os=", "arch=", "current=1.2.3"} {
		if !strings.Contains(query, part) {
			t.Fatalf("query %q is missing %q", query, part)
		}
	}
}

func TestDownloadSizeCapIsEnforced(t *testing.T) {
	body := []byte(strings.Repeat("x", 20))
	exe := newExe(t)
	dest := exe + ".new"

	// Declared size smaller than what the server sends.
	m := &Manifest{UpdateAvailable: true, Version: "2.0.0", SHA256: shaHex(body), Size: 10,
		DownloadPath: "/api/servicedesk/inventory/agent/download/2.0.0"}
	fx := &updateFixture{body: body}
	srv := fx.start(t)
	if err := downloadVerified(context.Background(), srv.Client(), newTestConfig(srv.URL), m, dest); err == nil {
		t.Fatal("expected the declared size to be enforced")
	}
	assertMissing(t, dest)

	// Declared size larger than the body that arrives.
	m.Size = 40
	if err := downloadVerified(context.Background(), srv.Client(), newTestConfig(srv.URL), m, dest); err == nil {
		t.Fatal("expected a short download to be rejected")
	}
	assertMissing(t, dest)

	// No declared size: the global cap applies (lowered for the test).
	original := maxDownloadBytes
	maxDownloadBytes = 8
	t.Cleanup(func() { maxDownloadBytes = original })
	m.Size = 0
	if err := downloadVerified(context.Background(), srv.Client(), newTestConfig(srv.URL), m, dest); err == nil {
		t.Fatal("expected the global cap to be enforced")
	}
	assertMissing(t, dest)
	if err := (&Manifest{Version: "2.0.0", SHA256: shaHex(body), DownloadPath: "/x", Size: 9}).validate(); err == nil {
		t.Fatal("a manifest above the cap must be rejected")
	}
}

func TestDownloadVerifiedSuccess(t *testing.T) {
	body := []byte(newBinary)
	exe := newExe(t)
	dest := exe + ".new"
	m := &Manifest{UpdateAvailable: true, Version: "2.0.0", SHA256: shaHex(body), Size: int64(len(body)),
		DownloadPath: "/api/servicedesk/inventory/agent/download/2.0.0"}
	fx := &updateFixture{body: body, headerSHA: shaHex(body)}
	srv := fx.start(t)

	if err := downloadVerified(context.Background(), srv.Client(), newTestConfig(srv.URL), m, dest); err != nil {
		t.Fatal(err)
	}
	assertFile(t, dest, newBinary)
}

func TestManifestValidate(t *testing.T) {
	valid := Manifest{UpdateAvailable: true, Version: "2.0.0", SHA256: strings.Repeat("ab", 32), Size: 10, DownloadPath: "/d"}
	ok := valid
	if err := ok.validate(); err != nil {
		t.Fatal(err)
	}
	cases := map[string]func(m *Manifest){
		"no version":    func(m *Manifest) { m.Version = " " },
		"short sha":     func(m *Manifest) { m.SHA256 = "abc" },
		"non hex sha":   func(m *Manifest) { m.SHA256 = strings.Repeat("zz", 32) },
		"relative path": func(m *Manifest) { m.DownloadPath = "download" },
		"negative size": func(m *Manifest) { m.Size = -1 },
	}
	for name, mutate := range cases {
		m := valid
		mutate(&m)
		if err := m.validate(); err == nil {
			t.Errorf("%s: expected a validation error", name)
		}
	}
}

func TestRollbackAfterTooManyBootAttempts(t *testing.T) {
	exe := newExe(t)
	newPath := exe + ".new"
	if err := os.WriteFile(newPath, []byte(newBinary), 0o755); err != nil {
		t.Fatal(err)
	}
	m := &Manifest{Version: "2.0.0"}
	if err := applyUpdate(exe, newPath, m, "1.0.0"); err != nil {
		t.Fatal(err)
	}
	assertFile(t, exe, newBinary)

	// A different running version does not touch the marker.
	if rolled, err := rollbackIfFailed(exe, "1.0.0"); rolled || err != nil {
		t.Fatalf("rolled=%v err=%v", rolled, err)
	}
	marker, _ := readMarker(exe)
	if marker.Attempts != 0 {
		t.Fatalf("attempts changed by another version: %d", marker.Attempts)
	}

	// The first two starts of the new version are tolerated and counted.
	for attempt := 1; attempt <= maxBootAttempts; attempt++ {
		rolled, err := rollbackIfFailed(exe, "2.0.0")
		if rolled || err != nil {
			t.Fatalf("attempt %d: rolled=%v err=%v", attempt, rolled, err)
		}
		marker, err := readMarker(exe)
		if err != nil || marker.Attempts != attempt {
			t.Fatalf("attempt %d persisted as %+v (%v)", attempt, marker, err)
		}
	}
	assertFile(t, exe, newBinary)

	// The third start restores the previous binary.
	rolled, err := rollbackIfFailed(exe, "2.0.0")
	if !rolled || err != nil {
		t.Fatalf("expected a rollback, rolled=%v err=%v", rolled, err)
	}
	assertFile(t, exe, oldBinary)
	assertFile(t, exe+".failed", newBinary)
	assertMissing(t, exe+".old")
	assertMissing(t, markerPath(exe))

	// Nothing left to do afterwards.
	if rolled, err := rollbackIfFailed(exe, "1.0.0"); rolled || err != nil {
		t.Fatalf("rolled=%v err=%v", rolled, err)
	}
}

func TestRollbackWithoutPreviousBinary(t *testing.T) {
	exe := newExe(t)
	if err := writeMarker(exe, &updateMarker{FromVersion: "1.0.0", ToVersion: "2.0.0", Attempts: maxBootAttempts}); err != nil {
		t.Fatal(err)
	}
	rolled, err := rollbackIfFailed(exe, "2.0.0")
	if rolled || err == nil {
		t.Fatalf("expected an error and no rollback, rolled=%v err=%v", rolled, err)
	}
	assertFile(t, exe, oldBinary)
	assertMissing(t, markerPath(exe))
}

func TestRollbackDropsUnreadableMarker(t *testing.T) {
	exe := newExe(t)
	if err := os.WriteFile(markerPath(exe), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if rolled, err := rollbackIfFailed(exe, "2.0.0"); rolled || err == nil {
		t.Fatalf("rolled=%v err=%v", rolled, err)
	}
	assertMissing(t, markerPath(exe))
}

func TestConfirmUpdateRemovesMarker(t *testing.T) {
	exe := newExe(t)
	if err := writeMarker(exe, &updateMarker{FromVersion: "1.0.0", ToVersion: "2.0.0", Attempts: 1}); err != nil {
		t.Fatal(err)
	}
	if err := confirmUpdate(exe); err != nil {
		t.Fatal(err)
	}
	assertMissing(t, markerPath(exe))
	// Confirming again (no marker) is not an error.
	if err := confirmUpdate(exe); err != nil {
		t.Fatal(err)
	}
}

func TestSecondUpdateDropsTheOlderLeftovers(t *testing.T) {
	exe := newExe(t)
	if err := os.WriteFile(exe+".old", []byte("ancient"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(exe+".failed", []byte("broken"), 0o755); err != nil {
		t.Fatal(err)
	}
	newPath := exe + ".new"
	if err := os.WriteFile(newPath, []byte(newBinary), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := applyUpdate(exe, newPath, &Manifest{Version: "2.0.0"}, "1.0.0"); err != nil {
		t.Fatal(err)
	}
	assertFile(t, exe, newBinary)
	assertFile(t, exe+".old", oldBinary)
	assertMissing(t, exe+".failed")
}

func TestApplyUpdateFailureKeepsTheOriginal(t *testing.T) {
	exe := newExe(t)
	// The candidate does not exist: nothing may change.
	if err := applyUpdate(exe, exe+".new", &Manifest{Version: "2.0.0"}, "1.0.0"); err == nil {
		t.Fatal("expected an error for a missing candidate")
	}
	assertFile(t, exe, oldBinary)
	assertMissing(t, markerPath(exe))
}

func TestCheckSelftestOutput(t *testing.T) {
	if err := checkSelftestOutput("starting\nok 2.0.0\n", "2.0.0"); err != nil {
		t.Fatal(err)
	}
	if err := checkSelftestOutput("ok 1.9.0\n", "2.0.0"); err == nil {
		t.Fatal("a different version must fail")
	}
	if err := checkSelftestOutput("", "2.0.0"); err == nil {
		t.Fatal("no output must fail")
	}
}

func TestSelftestCommand(t *testing.T) {
	var out, errOut bytes.Buffer
	if code := runCLI([]string{"selftest"}, &out, &errOut); code != 0 {
		t.Fatalf("code=%d err=%s", code, errOut.String())
	}
	if err := checkSelftestOutput(out.String(), version); err != nil {
		t.Fatal(err)
	}
}

func TestAutoUpdateSettings(t *testing.T) {
	t.Setenv("STEEL_INVENTORY_URL", "https://steel.example.com")
	t.Setenv("STEEL_INVENTORY_TOKEN", "tok")
	t.Setenv("STEEL_INVENTORY_AUTO_UPDATE", "")
	dir := t.TempDir()
	missing := filepath.Join(dir, "none.json")
	var errOut bytes.Buffer

	s, err := parseSettings("run", []string{"--config", missing}, &errOut)
	if err != nil || !s.cfg.AutoUpdate {
		t.Fatalf("auto-update must default to on: %+v %v", s, err)
	}

	s, err = parseSettings("run", []string{"--config", missing, "--no-auto-update"}, &errOut)
	if err != nil || s.cfg.AutoUpdate {
		t.Fatalf("flag must disable it: %+v %v", s, err)
	}

	t.Setenv("STEEL_INVENTORY_AUTO_UPDATE", "false")
	s, err = parseSettings("run", []string{"--config", missing}, &errOut)
	if err != nil || s.cfg.AutoUpdate {
		t.Fatalf("env must disable it: %+v %v", s, err)
	}
	t.Setenv("STEEL_INVENTORY_AUTO_UPDATE", "")

	// A config file written before the field existed keeps auto-update on.
	legacy := filepath.Join(dir, "legacy.json")
	if err := os.WriteFile(legacy, []byte(`{"url":"https://a.example.com","token":"t"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err = parseSettings("run", []string{"--config", legacy}, &errOut)
	if err != nil || !s.cfg.AutoUpdate {
		t.Fatalf("legacy config: %+v %v", s, err)
	}

	// An explicit opt-out in the file is honoured and survives a save/load.
	optOut := filepath.Join(dir, "optout.json")
	if err := saveConfig(optOut, &Config{URL: "https://a.example.com", Token: "t", AutoUpdate: false}); err != nil {
		t.Fatal(err)
	}
	s, err = parseSettings("run", []string{"--config", optOut}, &errOut)
	if err != nil || s.cfg.AutoUpdate {
		t.Fatalf("opt-out config: %+v %v", s, err)
	}
}

func TestRunLoopHooks(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	originalDelay := initialDelay
	initialDelay = func() time.Duration { return 0 }
	t.Cleanup(func() { initialDelay = originalDelay })
	collectFn := func() (*Report, error) { return &Report{Hostname: "pc"}, nil }

	// An applied update stops the loop after the first accepted report.
	confirmed, ticks := 0, 0
	hooks := loopHooks{
		onReported: func() { confirmed++ },
		afterTick: func(context.Context) error {
			ticks++
			return fmt.Errorf("wrapped: %w", errRestartRequested)
		},
	}
	var out bytes.Buffer
	err := runLoopWith(context.Background(), newTestConfig(srv.URL), collectFn, srv.Client(), &out, hooks)
	if !errors.Is(err, errRestartRequested) || confirmed != 1 || ticks != 1 {
		t.Fatalf("err=%v confirmed=%d ticks=%d", err, confirmed, ticks)
	}

	// A failing update check is logged and does not stop the reporting.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	out.Reset()
	hooks = loopHooks{afterTick: func(context.Context) error {
		cancel() // end the loop at the next sleep
		return errors.New("version endpoint down")
	}}
	err = runLoopWith(ctx, newTestConfig(srv.URL), collectFn, srv.Client(), &out, hooks)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected the loop to carry on until cancelled, got %v", err)
	}
	if !strings.Contains(out.String(), "update check failed: version endpoint down") {
		t.Fatalf("missing log line in %q", out.String())
	}
}
