package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"net"
	"strconv"
	"strings"
)

// The functions in this file are pure text parsers shared by the platform
// collectors. They carry no build tag so the tests run on every OS.

// parseOSRelease reads /etc/os-release and returns (name, version).
func parseOSRelease(content string) (string, string) {
	values := map[string]string{}
	scanner := bufio.NewScanner(strings.NewReader(content))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		key, value, ok := strings.Cut(line, "=")
		if !ok || strings.HasPrefix(key, "#") {
			continue
		}
		values[key] = strings.Trim(value, `"'`)
	}
	name := values["NAME"]
	if name == "" {
		name = values["PRETTY_NAME"]
	}
	return name, values["VERSION_ID"]
}

// parseMeminfo returns total and used memory in MB from /proc/meminfo.
// "Used" is total minus MemAvailable, which matches what users expect.
func parseMeminfo(content string) (totalMB, usedMB int64) {
	var totalKB, availKB int64 = 0, -1
	scanner := bufio.NewScanner(strings.NewReader(content))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		value, err := strconv.ParseInt(fields[1], 10, 64)
		if err != nil {
			continue
		}
		switch fields[0] {
		case "MemTotal:":
			totalKB = value
		case "MemAvailable:":
			availKB = value
		}
	}
	if totalKB <= 0 {
		return 0, 0
	}
	if availKB < 0 {
		availKB = 0
	}
	return totalKB / 1024, (totalKB - availKB) / 1024
}

// parseCPUInfo returns the first model name and the logical core count.
func parseCPUInfo(content string) (model string, cores int) {
	scanner := bufio.NewScanner(strings.NewReader(content))
	for scanner.Scan() {
		key, value, ok := strings.Cut(scanner.Text(), ":")
		if !ok {
			continue
		}
		switch strings.TrimSpace(key) {
		case "model name":
			if model == "" {
				model = strings.TrimSpace(value)
			}
		case "processor":
			cores++
		}
	}
	return model, cores
}

// parseDpkgList parses `dpkg-query -W -f='${Package}\t${Version}\n'`.
func parseDpkgList(content string) []Software {
	return parseTabbedSoftware(content)
}

// parseRPMList parses `rpm -qa --qf '%{NAME}\t%{VERSION}-%{RELEASE}\t%{VENDOR}\n'`.
func parseRPMList(content string) []Software {
	return parseTabbedSoftware(content)
}

func parseTabbedSoftware(content string) []Software {
	var out []Software
	scanner := bufio.NewScanner(strings.NewReader(content))
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		parts := strings.Split(strings.TrimSpace(scanner.Text()), "\t")
		if len(parts) < 1 || parts[0] == "" {
			continue
		}
		item := Software{Name: parts[0]}
		if len(parts) > 1 {
			item.Version = parts[1]
		}
		if len(parts) > 2 && parts[2] != "(none)" {
			item.Publisher = parts[2]
		}
		out = append(out, item)
	}
	return out
}

// agentIDFrom derives the stable agent identity from the machine id, so a
// reinstall (or a reimaged config) keeps reporting the same device.
func agentIDFrom(machineID string) string {
	sum := sha256.Sum256([]byte("steel-inventory:" + strings.TrimSpace(strings.ToLower(machineID))))
	return hex.EncodeToString(sum[:])[:40]
}

// networkAddresses lists the non-loopback IPs and MACs of the up interfaces.
func networkAddresses() (ips []string, macs []string) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil, nil
	}
	seenMAC := map[string]bool{}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		if mac := iface.HardwareAddr.String(); mac != "" && !seenMAC[mac] {
			seenMAC[mac] = true
			macs = append(macs, mac)
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ipnet, ok := addr.(*net.IPNet)
			if !ok {
				continue
			}
			ip := ipnet.IP
			if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
				continue
			}
			ips = append(ips, ip.String())
		}
	}
	return ips, macs
}
