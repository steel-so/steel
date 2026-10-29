//go:build linux

package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
)

const (
	linuxConfigPath = "/etc/steel-inventory-agent.json"
	linuxBinaryPath = "/usr/local/bin/steel-inventory-agent"
	linuxUnitPath   = "/etc/systemd/system/steel-inventory-agent.service"
)

func defaultConfigPath() string { return linuxConfigPath }

const unitTemplate = `[Unit]
Description=Steel inventory agent
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=%s run --config %s
Restart=always
RestartSec=60

[Install]
WantedBy=multi-user.target
`

func copyFile(from, to string, mode os.FileMode) error {
	src, err := os.Open(from)
	if err != nil {
		return err
	}
	defer src.Close()
	tmp := to + ".new"
	dst, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		return err
	}
	if err := dst.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, to)
}

func installService(cfg *Config, configPath string, out io.Writer) error {
	if os.Geteuid() != 0 {
		return errors.New("install must run as root (use sudo)")
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if exe != linuxBinaryPath {
		if err := copyFile(exe, linuxBinaryPath, 0o755); err != nil {
			return fmt.Errorf("copy binary: %w", err)
		}
	}
	if err := saveConfig(configPath, cfg); err != nil {
		return fmt.Errorf("write config: %w", err)
	}
	unit := fmt.Sprintf(unitTemplate, linuxBinaryPath, configPath)
	if err := os.WriteFile(linuxUnitPath, []byte(unit), 0o644); err != nil {
		return fmt.Errorf("write unit: %w", err)
	}
	for _, args := range [][]string{
		{"daemon-reload"},
		{"enable", "--now", "steel-inventory-agent.service"},
	} {
		if output, err := exec.Command("systemctl", args...).CombinedOutput(); err != nil {
			return fmt.Errorf("systemctl %v: %w: %s", args, err, output)
		}
	}
	fmt.Fprintln(out, "installed: systemd service steel-inventory-agent is running")
	return nil
}

func uninstallService(out io.Writer) error {
	if os.Geteuid() != 0 {
		return errors.New("uninstall must run as root (use sudo)")
	}
	_ = exec.Command("systemctl", "disable", "--now", "steel-inventory-agent.service").Run()
	for _, path := range []string{linuxUnitPath, linuxConfigPath, linuxBinaryPath} {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	_ = exec.Command("systemctl", "daemon-reload").Run()
	fmt.Fprintln(out, "uninstalled")
	return nil
}
