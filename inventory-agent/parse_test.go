package main

import (
	"reflect"
	"testing"
)

func TestParseOSRelease(t *testing.T) {
	name, version := parseOSRelease("# comment\nNAME=\"Ubuntu\"\nVERSION_ID=\"22.04\"\nID=ubuntu\n")
	if name != "Ubuntu" || version != "22.04" {
		t.Fatalf("got %q %q", name, version)
	}
	name, _ = parseOSRelease("PRETTY_NAME='Debian GNU/Linux 12'\n")
	if name != "Debian GNU/Linux 12" {
		t.Fatalf("fallback to PRETTY_NAME failed: %q", name)
	}
}

func TestParseMeminfo(t *testing.T) {
	total, used := parseMeminfo("MemTotal:       16384000 kB\nMemFree: 100 kB\nMemAvailable:    8192000 kB\n")
	if total != 16000 || used != 8000 {
		t.Fatalf("got total=%d used=%d", total, used)
	}
	if total, used := parseMeminfo("garbage"); total != 0 || used != 0 {
		t.Fatalf("expected zeros, got %d %d", total, used)
	}
	// Kernels without MemAvailable count everything as used.
	total, used = parseMeminfo("MemTotal: 2048 kB\n")
	if total != 2 || used != 2 {
		t.Fatalf("got total=%d used=%d", total, used)
	}
}

func TestParseCPUInfo(t *testing.T) {
	model, cores := parseCPUInfo("processor\t: 0\nmodel name\t: Intel(R) Xeon(R)\nprocessor\t: 1\nmodel name\t: Intel(R) Xeon(R)\n")
	if model != "Intel(R) Xeon(R)" || cores != 2 {
		t.Fatalf("got %q %d", model, cores)
	}
}

func TestParseSoftwareLists(t *testing.T) {
	got := parseDpkgList("bash\t5.2\n\ncurl\t8.0\n")
	want := []Software{{Name: "bash", Version: "5.2"}, {Name: "curl", Version: "8.0"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("dpkg: %#v", got)
	}
	rpm := parseRPMList("bash\t5.1-1\tFedora Project\nfoo\t1.0-2\t(none)\n")
	if rpm[0].Publisher != "Fedora Project" || rpm[1].Publisher != "" {
		t.Fatalf("rpm: %#v", rpm)
	}
}

func TestAgentIDIsStableAndValid(t *testing.T) {
	a := agentIDFrom("ABC-123 ")
	b := agentIDFrom("abc-123")
	if a != b {
		t.Fatal("id must ignore case and surrounding space")
	}
	if len(a) != 40 {
		t.Fatalf("unexpected length %d", len(a))
	}
	if agentIDFrom("other") == a {
		t.Fatal("different machines must differ")
	}
}

func TestNetworkAddressesDoesNotPanic(t *testing.T) {
	ips, macs := networkAddresses()
	for _, ip := range ips {
		if ip == "127.0.0.1" || ip == "::1" {
			t.Fatalf("loopback leaked: %s", ip)
		}
	}
	_ = macs
}
