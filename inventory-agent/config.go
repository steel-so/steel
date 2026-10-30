package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"
)

// Config is what the installer writes and the agent reads on every start.
// AutoUpdate (default true) lets the agent replace itself with the release the
// server publishes; the workspace has its own server-side switch on top.
type Config struct {
	URL        string `json:"url"`
	Token      string `json:"token"`
	Interval   string `json:"interval,omitempty"`
	AutoUpdate bool   `json:"autoUpdate"`
}

const (
	defaultInterval = 6 * time.Hour
	minInterval     = 15 * time.Minute
)

// Validate normalizes the URL and checks the required fields.
func (c *Config) Validate() error {
	c.URL = strings.TrimRight(strings.TrimSpace(c.URL), "/")
	c.Token = strings.TrimSpace(c.Token)
	if c.URL == "" {
		return errors.New("url is required")
	}
	if !strings.HasPrefix(c.URL, "https://") && !strings.HasPrefix(c.URL, "http://") {
		return errors.New("url must start with https:// (or http:// for tests)")
	}
	if c.Token == "" {
		return errors.New("token is required")
	}
	if _, err := c.IntervalDuration(); err != nil {
		return err
	}
	return nil
}

// IntervalDuration parses the interval, applying the default and the floor.
func (c *Config) IntervalDuration() (time.Duration, error) {
	if strings.TrimSpace(c.Interval) == "" {
		return defaultInterval, nil
	}
	d, err := time.ParseDuration(strings.TrimSpace(c.Interval))
	if err != nil {
		return 0, fmt.Errorf("invalid interval %q: %w", c.Interval, err)
	}
	if d < minInterval {
		return minInterval, nil
	}
	return d, nil
}

// ReportURL is the full ingestion endpoint.
func (c *Config) ReportURL() string {
	return c.URL + "/api/servicedesk/inventory/report"
}

func loadConfig(path string) (*Config, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	cfg := Config{AutoUpdate: true} // files written before auto-update existed keep it on
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	return &cfg, nil
}

// saveConfig writes the file readable by its owner only: it holds the token.
func saveConfig(path string, cfg *Config) error {
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(raw, '\n'), 0o600)
}
