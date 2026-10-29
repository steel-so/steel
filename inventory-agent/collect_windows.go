//go:build windows

package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"unicode/utf16"
)

// psScript gathers everything in one PowerShell run (one process start is far
// cheaper than one per query). Output is a single compressed JSON document.
const psScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'
$cs = Get-CimInstance Win32_ComputerSystem
$bios = Get-CimInstance Win32_BIOS
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$guid = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Cryptography').MachineGuid
$disks = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
  @{ mount = $_.DeviceID; label = [string]$_.VolumeName; fs = [string]$_.FileSystem;
     totalMb = [int64]($_.Size / 1MB); usedMb = [int64](($_.Size - $_.FreeSpace) / 1MB) } })
$sw = @(Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' |
  Where-Object { $_.DisplayName -and -not $_.SystemComponent } | ForEach-Object {
  @{ name = [string]$_.DisplayName; version = [string]$_.DisplayVersion; publisher = [string]$_.Publisher } })
@{
  machineId = [string]$guid; manufacturer = [string]$cs.Manufacturer; model = [string]$cs.Model;
  serial = [string]$bios.SerialNumber; osName = [string]$os.Caption; osVersion = [string]$os.Version;
  cpuModel = [string]$cpu.Name; cpuCores = [int]$cs.NumberOfLogicalProcessors;
  ramTotalMb = [int64]($os.TotalVisibleMemorySize / 1024);
  ramUsedMb = [int64](($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / 1024);
  disks = $disks; software = $sw
} | ConvertTo-Json -Depth 4 -Compress
`

type winDoc struct {
	MachineID    string          `json:"machineId"`
	Manufacturer string          `json:"manufacturer"`
	Model        string          `json:"model"`
	Serial       string          `json:"serial"`
	OSName       string          `json:"osName"`
	OSVersion    string          `json:"osVersion"`
	CPUModel     string          `json:"cpuModel"`
	CPUCores     int             `json:"cpuCores"`
	RAMTotalMB   int64           `json:"ramTotalMb"`
	RAMUsedMB    int64           `json:"ramUsedMb"`
	Disks        json.RawMessage `json:"disks"`
	Software     json.RawMessage `json:"software"`
}

// encodePowerShell turns a script into the -EncodedCommand form (UTF-16LE
// base64), which sidesteps every quoting problem.
func encodePowerShell(script string) string {
	units := utf16.Encode([]rune(script))
	buf := make([]byte, 0, len(units)*2)
	for _, u := range units {
		buf = append(buf, byte(u), byte(u>>8))
	}
	return base64.StdEncoding.EncodeToString(buf)
}

func collect() (*Report, error) {
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive",
		"-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(psScript))
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("powershell: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	// PowerShell may prepend a BOM.
	out = bytes.TrimPrefix(bytes.TrimSpace(out), []byte("\xef\xbb\xbf"))

	var doc winDoc
	if err := json.Unmarshal(out, &doc); err != nil {
		return nil, fmt.Errorf("parse powershell output: %w", err)
	}

	var disks []Disk
	if err := decodeFlexible(doc.Disks, &disks); err != nil {
		return nil, fmt.Errorf("parse disks: %w", err)
	}
	var software []Software
	if err := decodeFlexible(doc.Software, &software); err != nil {
		return nil, fmt.Errorf("parse software: %w", err)
	}

	hostname, _ := os.Hostname()
	ips, macs := networkAddresses()
	id := doc.MachineID
	if id == "" {
		id = hostname + strings.Join(macs, ",")
	}

	return &Report{
		AgentID:      agentIDFrom(id),
		AgentVersion: version,
		Hostname:     hostname,
		OS:           OSInfo{Name: doc.OSName, Version: doc.OSVersion, Arch: runtime.GOARCH},
		Hardware: Hardware{
			Manufacturer: doc.Manufacturer,
			Model:        doc.Model,
			SerialNumber: doc.Serial,
			CPUModel:     doc.CPUModel,
			CPUCores:     doc.CPUCores,
			RAMTotalMB:   doc.RAMTotalMB,
			RAMUsedMB:    doc.RAMUsedMB,
		},
		IPAddresses:  ips,
		MACAddresses: macs,
		Disks:        disks,
		Software:     software,
	}, nil
}
