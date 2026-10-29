//go:build !linux && !windows

package main

import (
	"os"
	"runtime"
	"strings"
)

// collect on unsupported systems reports only what is portable, so the
// binary still builds (and the unit tests run) on a developer's laptop.
func collect() (*Report, error) {
	hostname, _ := os.Hostname()
	ips, macs := networkAddresses()
	return &Report{
		AgentID:      agentIDFrom(hostname + strings.Join(macs, ",")),
		AgentVersion: version,
		Hostname:     hostname,
		OS:           OSInfo{Name: runtime.GOOS, Arch: runtime.GOARCH},
		IPAddresses:  ips,
		MACAddresses: macs,
		Disks:        []Disk{},
	}, nil
}
