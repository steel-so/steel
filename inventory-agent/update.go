package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Auto-update: the agent asks the server for the release published for its OS
// and architecture, downloads it next to the running executable, verifies the
// SHA-256, smoke-tests it (`selftest`), swaps the files and exits cleanly so
// the supervisor starts the new binary. An update marker lets a new binary that
// keeps dying before its first accepted report be rolled back automatically.

const (
	versionPath = "/api/servicedesk/inventory/agent/version"

	// selftestTimeout bounds the smoke test of a freshly downloaded binary.
	selftestTimeout = 10 * time.Second

	// maxBootAttempts is how many starts of a new version are tolerated
	// without a confirmed report; the next start rolls back.
	maxBootAttempts = 2

	// maxManifestBytes bounds the version endpoint response.
	maxManifestBytes = 1 << 20
)

// maxDownloadBytes caps a downloaded binary (64 MiB). A variable so tests can
// lower it.
var maxDownloadBytes int64 = 64 << 20

// errRestartRequested is returned by the run loop when an update was applied
// (or rolled back) and the process must exit so the supervisor restarts it.
var errRestartRequested = errors.New("restart requested")

// Manifest is the data of the version endpoint.
type Manifest struct {
	UpdateAvailable bool   `json:"updateAvailable"`
	Version         string `json:"version"`
	SHA256          string `json:"sha256"`
	Size            int64  `json:"size"`
	DownloadPath    string `json:"downloadPath"`
}

type manifestEnvelope struct {
	Success bool     `json:"success"`
	Data    Manifest `json:"data"`
}

// validate checks an "update available" manifest before anything is downloaded.
func (m *Manifest) validate() error {
	if strings.TrimSpace(m.Version) == "" {
		return errors.New("manifest has no version")
	}
	m.SHA256 = strings.ToLower(strings.TrimSpace(m.SHA256))
	if raw, err := hex.DecodeString(m.SHA256); err != nil || len(raw) != sha256.Size {
		return errors.New("manifest sha256 is not 64 hex characters")
	}
	if !strings.HasPrefix(m.DownloadPath, "/") {
		return errors.New("manifest download path must start with /")
	}
	if m.Size < 0 || m.Size > maxDownloadBytes {
		return fmt.Errorf("manifest size %d is out of range", m.Size)
	}
	return nil
}

// envAutoUpdate reads STEEL_INVENTORY_AUTO_UPDATE; set is false when absent or
// not a boolean.
func envAutoUpdate() (value, set bool) {
	raw := strings.TrimSpace(os.Getenv("STEEL_INVENTORY_AUTO_UPDATE"))
	if raw == "" {
		return false, false
	}
	parsed, err := strconv.ParseBool(raw)
	if err != nil {
		return false, false
	}
	return parsed, true
}

// resolveExecutable is the path of the running binary with symlinks resolved.
// Resolve it once at startup: after a swap the OS may report the renamed
// ".old" path for the running process.
func resolveExecutable() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		return resolved
	}
	return exe
}

// fetchManifest asks the server which release this OS/arch should run.
func fetchManifest(ctx context.Context, client *http.Client, cfg *Config, current string) (*Manifest, error) {
	query := url.Values{}
	query.Set("os", runtime.GOOS)
	query.Set("arch", runtime.GOARCH)
	query.Set("current", current)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cfg.URL+versionPath+"?"+query.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.Token)
	req.Header.Set("User-Agent", "steel-inventory-agent/"+version)

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		return nil, ErrUnauthorized{Status: resp.StatusCode}
	case resp.StatusCode < 200 || resp.StatusCode >= 300:
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("version endpoint answered HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(snippet)))
	}

	var envelope manifestEnvelope
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxManifestBytes)).Decode(&envelope); err != nil {
		return nil, fmt.Errorf("decode version response: %w", err)
	}
	if !envelope.Success {
		return nil, errors.New("version endpoint reported failure")
	}
	return &envelope.Data, nil
}

// downloadVerified streams the release binary to destPath while hashing it,
// and compares the digest with the manifest and with the X-Content-SHA256
// header (when the server sends one). On any problem destPath is removed.
func downloadVerified(ctx context.Context, client *http.Client, cfg *Config, m *Manifest, destPath string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cfg.URL+m.DownloadPath, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.Token)
	req.Header.Set("User-Agent", "steel-inventory-agent/"+version)

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		return ErrUnauthorized{Status: resp.StatusCode}
	case resp.StatusCode != http.StatusOK:
		return fmt.Errorf("download answered HTTP %d", resp.StatusCode)
	}

	limit := maxDownloadBytes
	if m.Size > 0 && m.Size < limit {
		limit = m.Size
	}
	if resp.ContentLength > limit {
		return fmt.Errorf("download is %d bytes, larger than the allowed %d", resp.ContentLength, limit)
	}
	want := strings.ToLower(m.SHA256)
	if header := strings.ToLower(strings.TrimSpace(resp.Header.Get("X-Content-SHA256"))); header != "" && header != want {
		return fmt.Errorf("X-Content-SHA256 %s disagrees with the manifest %s", header, want)
	}

	file, err := os.OpenFile(destPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	hash := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(file, hash), io.LimitReader(resp.Body, limit+1))
	closeErr := file.Close()

	fail := func(e error) error {
		_ = os.Remove(destPath)
		return e
	}
	if copyErr != nil {
		return fail(fmt.Errorf("download: %w", copyErr))
	}
	if closeErr != nil {
		return fail(closeErr)
	}
	if written > limit {
		return fail(fmt.Errorf("download exceeds the allowed %d bytes", limit))
	}
	if m.Size > 0 && written != m.Size {
		return fail(fmt.Errorf("download is %d bytes, manifest declared %d", written, m.Size))
	}
	if got := hex.EncodeToString(hash.Sum(nil)); got != want {
		return fail(fmt.Errorf("checksum mismatch: got %s, expected %s", got, want))
	}
	return nil
}

// smokeTest runs the downloaded binary's `selftest`. A variable so tests do
// not execute real binaries.
var smokeTest = runSelftest

func runSelftest(ctx context.Context, binary, wantVersion string) error {
	ctx, cancel := context.WithTimeout(ctx, selftestTimeout)
	defer cancel()
	output, err := exec.CommandContext(ctx, binary, "selftest").Output() // nosemgrep: the binary is the agent's own just-downloaded, checksum-verified file
	if err != nil {
		if ctx.Err() != nil {
			return fmt.Errorf("selftest did not finish in %s", selftestTimeout)
		}
		return fmt.Errorf("selftest failed: %w", err)
	}
	return checkSelftestOutput(string(output), wantVersion)
}

// checkSelftestOutput looks for a line `ok <version>` with the expected version.
func checkSelftestOutput(output, wantVersion string) error {
	for _, line := range strings.Split(output, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[0] == "ok" {
			if fields[1] == wantVersion {
				return nil
			}
			return fmt.Errorf("selftest reported version %q, expected %q", fields[1], wantVersion)
		}
	}
	return errors.New("selftest printed no `ok <version>` line")
}

// updateMarker records an applied update until its first report is accepted.
type updateMarker struct {
	FromVersion string    `json:"fromVersion"`
	ToVersion   string    `json:"toVersion"`
	Attempts    int       `json:"attempts"`
	CreatedAt   time.Time `json:"createdAt"`
}

func markerPath(exePath string) string { return exePath + ".update.json" }

func readMarker(exePath string) (*updateMarker, error) {
	raw, err := os.ReadFile(markerPath(exePath))
	if err != nil {
		return nil, err
	}
	var marker updateMarker
	if err := json.Unmarshal(raw, &marker); err != nil {
		return nil, fmt.Errorf("parse update marker: %w", err)
	}
	return &marker, nil
}

func writeMarker(exePath string, marker *updateMarker) error {
	raw, err := json.Marshal(marker)
	if err != nil {
		return err
	}
	return os.WriteFile(markerPath(exePath), append(raw, '\n'), 0o600)
}

// applyUpdate swaps newPath in as the executable, keeping the previous binary
// as <exe>.old, and writes the update marker. Renaming a running executable is
// allowed on Linux and Windows. Every failure leaves the original in place.
func applyUpdate(exePath, newPath string, m *Manifest, fromVersion string) error {
	oldPath := exePath + ".old"
	if runtime.GOOS != "windows" {
		if err := os.Chmod(newPath, 0o755); err != nil {
			return fmt.Errorf("chmod new binary: %w", err)
		}
	}
	// Leftovers of the previous cycle: the last kept .old and a failed binary.
	_ = os.Remove(oldPath)
	_ = os.Remove(exePath + ".failed")

	if err := os.Rename(exePath, oldPath); err != nil {
		return fmt.Errorf("keep current binary: %w", err)
	}
	if err := os.Rename(newPath, exePath); err != nil {
		if backErr := os.Rename(oldPath, exePath); backErr != nil {
			return fmt.Errorf("install new binary: %v; restoring the old one also failed: %w", err, backErr)
		}
		return fmt.Errorf("install new binary: %w", err)
	}
	marker := &updateMarker{FromVersion: fromVersion, ToVersion: m.Version, Attempts: 0, CreatedAt: time.Now().UTC()}
	if err := writeMarker(exePath, marker); err != nil {
		// Without the marker there is no rollback safety net: undo the swap.
		if backErr := os.Rename(oldPath, exePath); backErr != nil {
			return fmt.Errorf("write update marker: %v; restoring the old binary also failed: %w", err, backErr)
		}
		return fmt.Errorf("write update marker: %w", err)
	}
	return nil
}

// rollbackIfFailed runs at the very start of `run`. When a marker says this
// version was just installed, it counts the boot attempt (persisted first) and,
// once the new binary has started more than maxBootAttempts times without
// confirming, restores the previous binary. rolledBack means the caller must
// exit so the supervisor starts the restored one.
func rollbackIfFailed(exePath, runningVersion string) (rolledBack bool, err error) {
	marker, err := readMarker(exePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return false, nil
		}
		_ = os.Remove(markerPath(exePath)) // unreadable marker: do not keep failing on it
		return false, err
	}
	if marker.ToVersion != runningVersion {
		return false, nil
	}
	marker.Attempts++
	if err := writeMarker(exePath, marker); err != nil {
		return false, fmt.Errorf("persist boot attempt: %w", err)
	}
	if marker.Attempts <= maxBootAttempts {
		return false, nil
	}

	oldPath := exePath + ".old"
	failedPath := exePath + ".failed"
	if _, statErr := os.Stat(oldPath); statErr != nil {
		_ = os.Remove(markerPath(exePath))
		return false, fmt.Errorf("version %s keeps failing but there is no previous binary to restore: %w", runningVersion, statErr)
	}
	_ = os.Remove(failedPath)
	if err := os.Rename(exePath, failedPath); err != nil {
		return false, fmt.Errorf("move failed binary aside: %w", err)
	}
	if err := os.Rename(oldPath, exePath); err != nil {
		if backErr := os.Rename(failedPath, exePath); backErr != nil {
			return false, fmt.Errorf("restore previous binary: %v; undo also failed: %w", err, backErr)
		}
		return false, fmt.Errorf("restore previous binary: %w", err)
	}
	_ = os.Remove(markerPath(exePath))
	return true, nil
}

// confirmUpdate runs once the server accepted a report: the new version works,
// so the marker goes away. The .old binary stays until the next update.
func confirmUpdate(exePath string) error {
	if err := os.Remove(markerPath(exePath)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// checkForUpdate runs the whole flow. It returns errRestartRequested when an
// update was applied, nil when there is nothing to do, and an error otherwise
// (the caller logs it and keeps reporting). Builds without a stamped version
// ("dev") never update themselves.
func checkForUpdate(ctx context.Context, cfg *Config, client *http.Client, exePath, current string, out io.Writer) error {
	if current == "" || current == "dev" {
		return nil
	}
	manifest, err := fetchManifest(ctx, client, cfg, current)
	if err != nil {
		return fmt.Errorf("check for update: %w", err)
	}
	if !manifest.UpdateAvailable || manifest.Version == current {
		return nil
	}
	if err := manifest.validate(); err != nil {
		return fmt.Errorf("check for update: %w", err)
	}

	newPath := exePath + ".new"
	_ = os.Remove(newPath)
	fmt.Fprintf(out, "%s updating agent %s -> %s\n", time.Now().Format(time.RFC3339), current, manifest.Version)
	if err := downloadVerified(ctx, client, cfg, manifest, newPath); err != nil {
		return fmt.Errorf("download update: %w", err)
	}
	if err := smokeTest(ctx, newPath, manifest.Version); err != nil {
		_ = os.Remove(newPath)
		return fmt.Errorf("smoke test of version %s: %w", manifest.Version, err)
	}
	if err := applyUpdate(exePath, newPath, manifest, current); err != nil {
		_ = os.Remove(newPath)
		return fmt.Errorf("apply update: %w", err)
	}
	fmt.Fprintf(out, "%s agent updated to %s, restarting\n", time.Now().Format(time.RFC3339), manifest.Version)
	return errRestartRequested
}
