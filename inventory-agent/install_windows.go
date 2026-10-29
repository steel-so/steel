//go:build windows

package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
)

const windowsTaskName = "Steel Inventory Agent"

func programDataDir() string {
	if v := os.Getenv("ProgramData"); v != "" {
		return filepath.Join(v, "SteelInventoryAgent")
	}
	return `C:\ProgramData\SteelInventoryAgent`
}

func installDir() string {
	if v := os.Getenv("ProgramFiles"); v != "" {
		return filepath.Join(v, "Steel Inventory Agent")
	}
	return `C:\Program Files\Steel Inventory Agent`
}

func defaultConfigPath() string { return filepath.Join(programDataDir(), "config.json") }

func copyFile(from, to string) error {
	raw, err := os.ReadFile(from)
	if err != nil {
		return err
	}
	return os.WriteFile(to, raw, 0o755)
}

func runCmd(name string, args ...string) error {
	if output, err := exec.Command(name, args...).CombinedOutput(); err != nil {
		return fmt.Errorf("%s %v: %w: %s", name, args, err, output)
	}
	return nil
}

// installService copies the binary, writes the config (restricted to SYSTEM
// and Administrators, because it holds the token) and registers a scheduled
// task that runs `once` every few hours. A task avoids needing a Windows
// service wrapper and survives agent crashes by design.
func installService(cfg *Config, configPath string, out io.Writer) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(installDir(), 0o755); err != nil {
		return fmt.Errorf("create %s (run as Administrator): %w", installDir(), err)
	}
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		return err
	}
	target := filepath.Join(installDir(), "steel-inventory-agent.exe")
	if exe != target {
		if err := copyFile(exe, target); err != nil {
			return fmt.Errorf("copy binary: %w", err)
		}
	}
	if err := saveConfig(configPath, cfg); err != nil {
		return fmt.Errorf("write config: %w", err)
	}
	// Best effort: drop inherited access so ordinary users cannot read the token.
	_ = runCmd("icacls", configPath, "/inheritance:r", "/grant:r", "SYSTEM:F", "Administrators:F")

	interval, err := cfg.IntervalDuration()
	if err != nil {
		return err
	}
	hours := int(interval.Hours())
	if hours < 1 {
		hours = 1
	}
	command := fmt.Sprintf(`"%s" once --config "%s"`, target, configPath)
	if err := runCmd("schtasks", "/Create", "/TN", windowsTaskName, "/TR", command,
		"/SC", "HOURLY", "/MO", strconv.Itoa(hours), "/RU", "SYSTEM", "/RL", "HIGHEST", "/F"); err != nil {
		return err
	}
	if err := runCmd("schtasks", "/Run", "/TN", windowsTaskName); err != nil {
		return err
	}
	fmt.Fprintf(out, "installed: scheduled task %q runs every %d h (first report started)\n", windowsTaskName, hours)
	return nil
}

func uninstallService(out io.Writer) error {
	_ = runCmd("schtasks", "/Delete", "/TN", windowsTaskName, "/F")
	for _, path := range []string{installDir(), programDataDir()} {
		if err := os.RemoveAll(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	fmt.Fprintln(out, "uninstalled")
	return nil
}
