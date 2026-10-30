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

const (
	windowsTaskName       = "Steel Inventory Agent"
	windowsUpdateTaskName = "Steel Inventory Agent Update"
)

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

func report(name string, args []string, output []byte, err error) error {
	if err != nil {
		return fmt.Errorf("%s %v: %w: %s", name, args, err, output)
	}
	return nil
}

// runSchtasks and runIcacls spawn fixed executables; only the arguments vary.
func runSchtasks(args ...string) error {
	output, err := exec.Command("schtasks", args...).CombinedOutput()
	return report("schtasks", args, output, err)
}

func runIcacls(args ...string) error {
	output, err := exec.Command("icacls", args...).CombinedOutput()
	return report("icacls", args, output, err)
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
	_ = runIcacls(configPath, "/inheritance:r", "/grant:r", "SYSTEM:F", "Administrators:F")

	interval, err := cfg.IntervalDuration()
	if err != nil {
		return err
	}
	hours := int(interval.Hours())
	if hours < 1 {
		hours = 1
	}
	command := fmt.Sprintf(`"%s" once --config "%s"`, target, configPath)
	if err := runSchtasks("/Create", "/TN", windowsTaskName, "/TR", command,
		"/SC", "HOURLY", "/MO", strconv.Itoa(hours), "/RU", "SYSTEM", "/RL", "HIGHEST", "/F"); err != nil {
		return err
	}
	// The report task runs `once`, so there is no long-lived process to update
	// itself: a second daily task runs `update`. The new binary is picked up by
	// the next `once` run, so no restart is needed.
	if cfg.AutoUpdate {
		updateCommand := fmt.Sprintf(`"%s" update --config "%s"`, target, configPath)
		if err := runSchtasks("/Create", "/TN", windowsUpdateTaskName, "/TR", updateCommand,
			"/SC", "DAILY", "/RU", "SYSTEM", "/RL", "HIGHEST", "/F"); err != nil {
			return err
		}
	} else {
		_ = runSchtasks("/Delete", "/TN", windowsUpdateTaskName, "/F")
	}
	if err := runSchtasks("/Run", "/TN", windowsTaskName); err != nil {
		return err
	}
	fmt.Fprintf(out, "installed: scheduled task %q runs every %d h (first report started)\n", windowsTaskName, hours)
	return nil
}

func uninstallService(out io.Writer) error {
	_ = runSchtasks("/Delete", "/TN", windowsTaskName, "/F")
	_ = runSchtasks("/Delete", "/TN", windowsUpdateTaskName, "/F")
	for _, path := range []string{installDir(), programDataDir()} {
		if err := os.RemoveAll(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	fmt.Fprintln(out, "uninstalled")
	return nil
}
