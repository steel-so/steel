//go:build !linux && !windows

package main

import (
	"errors"
	"io"
	"os"
	"path/filepath"
)

func defaultConfigPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "steel-inventory-agent.json"
	}
	return filepath.Join(home, ".steel-inventory-agent.json")
}

func installService(_ *Config, _ string, _ io.Writer) error {
	return errors.New("install is only supported on Linux and Windows; use `run` under your own supervisor")
}

func uninstallService(_ io.Writer) error {
	return errors.New("uninstall is only supported on Linux and Windows")
}
