//go:build linux

package main

import (
	"os"
	"os/exec"
	"runtime"
	"strings"
	"syscall"
)

func readTrim(path string) string {
	raw, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(raw))
}

func machineID() string {
	if id := readTrim("/etc/machine-id"); id != "" {
		return id
	}
	return readTrim("/var/lib/dbus/machine-id")
}

// pseudoFS are mounts that are not storage and would only add noise.
var pseudoFS = map[string]bool{
	"proc": true, "sysfs": true, "devtmpfs": true, "devpts": true, "tmpfs": true,
	"cgroup": true, "cgroup2": true, "overlay": true, "squashfs": true,
	"securityfs": true, "debugfs": true, "tracefs": true, "configfs": true,
	"fusectl": true, "pstore": true, "bpf": true, "mqueue": true, "hugetlbfs": true,
	"autofs": true, "binfmt_misc": true, "efivarfs": true, "ramfs": true,
	"nsfs": true, "rpc_pipefs": true, "fuse.gvfsd-fuse": true, "fuse.portal": true,
}

func collectDisks() []Disk {
	raw, err := os.ReadFile("/proc/mounts")
	if err != nil {
		return nil
	}
	var disks []Disk
	seen := map[string]bool{}
	for _, line := range strings.Split(string(raw), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		device, mount, fs := fields[0], fields[1], fields[2]
		if pseudoFS[fs] || !strings.HasPrefix(device, "/") || seen[device] {
			continue
		}
		var st syscall.Statfs_t
		if err := syscall.Statfs(mount, &st); err != nil {
			continue
		}
		total := int64(st.Blocks) * int64(st.Bsize) / (1024 * 1024)
		free := int64(st.Bfree) * int64(st.Bsize) / (1024 * 1024)
		if total <= 0 {
			continue
		}
		seen[device] = true
		disks = append(disks, Disk{Mount: mount, FS: fs, TotalMB: total, UsedMB: total - free})
	}
	return disks
}

func collectSoftware() []Software {
	if path, err := exec.LookPath("dpkg-query"); err == nil {
		out, err := exec.Command(path, "-W", "-f=${Package}\t${Version}\n").Output()
		if err == nil {
			return parseDpkgList(string(out))
		}
	}
	if path, err := exec.LookPath("rpm"); err == nil {
		out, err := exec.Command(path, "-qa", "--qf", "%{NAME}\t%{VERSION}-%{RELEASE}\t%{VENDOR}\n").Output()
		if err == nil {
			return parseRPMList(string(out))
		}
	}
	return nil
}

func collect() (*Report, error) {
	hostname, _ := os.Hostname()
	osName, osVersion := parseOSRelease(readTrim("/etc/os-release"))
	cpuModel, cores := parseCPUInfo(readTrim("/proc/cpuinfo"))
	totalMB, usedMB := parseMeminfo(readTrim("/proc/meminfo"))
	ips, macs := networkAddresses()

	id := machineID()
	if id == "" {
		id = hostname + strings.Join(macs, ",")
	}

	return &Report{
		AgentID:      agentIDFrom(id),
		AgentVersion: version,
		Hostname:     hostname,
		OS:           OSInfo{Name: osName, Version: osVersion, Arch: runtime.GOARCH},
		Hardware: Hardware{
			Manufacturer: readTrim("/sys/class/dmi/id/sys_vendor"),
			Model:        readTrim("/sys/class/dmi/id/product_name"),
			// Readable only by root on most distros; empty otherwise.
			SerialNumber: readTrim("/sys/class/dmi/id/product_serial"),
			CPUModel:     cpuModel,
			CPUCores:     cores,
			RAMTotalMB:   totalMB,
			RAMUsedMB:    usedMB,
		},
		IPAddresses:  ips,
		MACAddresses: macs,
		Disks:        collectDisks(),
		Software:     collectSoftware(),
	}, nil
}
