package main

import (
	"context"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
	"time"
)

// RemoteIDs carries the public IDs of the remote-access tools installed on the
// machine (S4). Only the ID is read, never a password or a configuration file.
type RemoteIDs struct {
	RustDesk string `json:"rustdesk,omitempty"`
	AnyDesk  string `json:"anydesk,omitempty"`
}

// remoteIDPattern mirrors isValidRemoteId on the server.
var (
	remoteIDPattern = regexp.MustCompile(`^[A-Za-z0-9._@-]{4,64}$`)
	digitsOnly     = regexp.MustCompile(`^\d+$`)
)

// parseRemoteID extracts the ID from the output of `<tool> --get-id`: the first
// non-empty line, with spaces and dashes of numeric IDs removed.
func parseRemoteID(out string) string {
	for _, line := range strings.Split(out, "\n") {
		id := strings.TrimSpace(line)
		if id == "" {
			continue
		}
		compact := strings.NewReplacer(" ", "", "-", "").Replace(id)
		if digitsOnly.MatchString(compact) {
			id = compact
		}
		if remoteIDPattern.MatchString(id) {
			return id
		}
		return ""
	}
	return ""
}

func remoteToolPaths(name string) []string {
	if runtime.GOOS == "windows" {
		switch name {
		case "rustdesk":
			return []string{`C:\Program Files\RustDesk\rustdesk.exe`}
		case "anydesk":
			return []string{
				`C:\Program Files (x86)\AnyDesk\AnyDesk.exe`,
				`C:\Program Files\AnyDesk\AnyDesk.exe`,
			}
		}
		return nil
	}
	return []string{name}
}

func readRemoteID(name string) string {
	for _, path := range remoteToolPaths(name) {
		bin, err := exec.LookPath(path)
		if err != nil {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		out, err := exec.CommandContext(ctx, bin, "--get-id").Output()
		cancel()
		if err != nil {
			continue
		}
		if id := parseRemoteID(string(out)); id != "" {
			return id
		}
	}
	return ""
}

// detectRemoteIDs returns nil when no supported tool answers, so reports from
// machines without RustDesk or AnyDesk stay exactly as before.
func detectRemoteIDs() *RemoteIDs {
	ids := &RemoteIDs{RustDesk: readRemoteID("rustdesk"), AnyDesk: readRemoteID("anydesk")}
	if ids.RustDesk == "" && ids.AnyDesk == "" {
		return nil
	}
	return ids
}
