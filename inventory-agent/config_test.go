package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestConfigValidate(t *testing.T) {
	cases := []struct {
		name string
		cfg  Config
		ok   bool
	}{
		{"valid", Config{URL: "https://steel.example.com/", Token: "t"}, true},
		{"no url", Config{Token: "t"}, false},
		{"bad scheme", Config{URL: "ftp://x", Token: "t"}, false},
		{"no token", Config{URL: "https://x"}, false},
		{"bad interval", Config{URL: "https://x", Token: "t", Interval: "soon"}, false},
	}
	for _, c := range cases {
		cfg := c.cfg
		err := cfg.Validate()
		if (err == nil) != c.ok {
			t.Errorf("%s: err=%v", c.name, err)
		}
	}
	cfg := Config{URL: " https://steel.example.com/ ", Token: " t "}
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
	if cfg.URL != "https://steel.example.com" || cfg.Token != "t" {
		t.Fatalf("not normalized: %+v", cfg)
	}
	if cfg.ReportURL() != "https://steel.example.com/api/servicedesk/inventory/report" {
		t.Fatalf("report url: %s", cfg.ReportURL())
	}
}

func TestIntervalDuration(t *testing.T) {
	cfg := Config{}
	if d, _ := cfg.IntervalDuration(); d != defaultInterval {
		t.Fatalf("default: %v", d)
	}
	cfg.Interval = "1m"
	if d, _ := cfg.IntervalDuration(); d != minInterval {
		t.Fatalf("floor: %v", d)
	}
	cfg.Interval = "12h"
	if d, _ := cfg.IntervalDuration(); d != 12*time.Hour {
		t.Fatalf("explicit: %v", d)
	}
}

func TestSaveAndLoadConfig(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cfg.json")
	if err := saveConfig(path, &Config{URL: "https://x", Token: "secret"}); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if runtimeSupportsUnixModes() && info.Mode().Perm() != 0o600 {
		t.Fatalf("config must be owner-only, got %v", info.Mode().Perm())
	}
	cfg, err := loadConfig(path)
	if err != nil || cfg.Token != "secret" {
		t.Fatalf("load: %+v %v", cfg, err)
	}
	if _, err := loadConfig(filepath.Join(t.TempDir(), "missing.json")); !os.IsNotExist(err) {
		t.Fatalf("expected not-exist, got %v", err)
	}
	bad := filepath.Join(t.TempDir(), "bad.json")
	_ = os.WriteFile(bad, []byte("{"), 0o600)
	if _, err := loadConfig(bad); err == nil {
		t.Fatal("expected a parse error")
	}
}
