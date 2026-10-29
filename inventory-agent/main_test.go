package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunCLIVersionHelpAndUnknown(t *testing.T) {
	var out, errOut bytes.Buffer
	if code := runCLI([]string{"version"}, &out, &errOut); code != 0 || strings.TrimSpace(out.String()) != version {
		t.Fatalf("version: code=%d out=%q", code, out.String())
	}
	out.Reset()
	if code := runCLI([]string{"help"}, &out, &errOut); code != 0 || !strings.Contains(out.String(), "Usage:") {
		t.Fatalf("help: code=%d", code)
	}
	if code := runCLI([]string{"explode"}, &out, &errOut); code != 2 {
		t.Fatalf("unknown command should exit 2, got %d", code)
	}
}

func TestRunCLIRequiresURLAndToken(t *testing.T) {
	t.Setenv("STEEL_INVENTORY_URL", "")
	t.Setenv("STEEL_INVENTORY_TOKEN", "")
	missing := filepath.Join(t.TempDir(), "none.json")
	var out, errOut bytes.Buffer
	if code := runCLI([]string{"once", "--config", missing}, &out, &errOut); code != 2 {
		t.Fatalf("expected exit 2 without url/token, got %d (%s)", code, errOut.String())
	}
}

func TestParseSettingsPrecedence(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "cfg.json")
	if err := saveConfig(path, &Config{URL: "https://file.example.com", Token: "from-file", Interval: "12h"}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("STEEL_INVENTORY_URL", "https://env.example.com")
	t.Setenv("STEEL_INVENTORY_TOKEN", "from-env")

	var errOut bytes.Buffer
	s, err := parseSettings("run", []string{"--config", path, "--token", "from-flag"}, &errOut)
	if err != nil {
		t.Fatal(err)
	}
	if s.cfg.URL != "https://env.example.com" || s.cfg.Token != "from-flag" || s.cfg.Interval != "12h" {
		t.Fatalf("precedence broken: %+v", s.cfg)
	}

	bad := filepath.Join(dir, "bad.json")
	_ = os.WriteFile(bad, []byte("{"), 0o600)
	if _, err := parseSettings("run", []string{"--config", bad}, &errOut); err == nil {
		t.Fatal("expected a parse error for a broken config file")
	}
}

func TestCollectProducesAValidReport(t *testing.T) {
	report, err := collect()
	if err != nil {
		t.Skipf("collector unavailable on this runner: %v", err)
	}
	report.clamp()
	if report.Hostname == "" || len(report.AgentID) < 8 {
		t.Fatalf("incomplete report: %+v", report)
	}
}
