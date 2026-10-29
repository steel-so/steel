package main

import (
	"encoding/json"
	"fmt"
	"testing"
)

func TestClampDedupesAndLimits(t *testing.T) {
	r := &Report{
		IPAddresses: []string{"10.0.0.1", "", "10.0.0.2"},
		Software: []Software{
			{Name: "a", Version: "1"}, {Name: "a", Version: "1"}, {Name: ""}, {Name: "a", Version: "2"},
		},
	}
	r.clamp()
	if len(r.IPAddresses) != 2 {
		t.Fatalf("ips: %v", r.IPAddresses)
	}
	if len(r.Software) != 2 {
		t.Fatalf("software: %v", r.Software)
	}
	if r.Disks == nil {
		t.Fatal("disks must serialize as [] not null")
	}
}

func TestClampCaps(t *testing.T) {
	r := &Report{}
	for i := 0; i < maxSoftware+10; i++ {
		r.Software = append(r.Software, Software{Name: fmt.Sprintf("p%d", i), Version: "1"})
	}
	for i := 0; i < maxDisks+5; i++ {
		r.Disks = append(r.Disks, Disk{Mount: fmt.Sprintf("/m%d", i)})
	}
	r.clamp()
	if len(r.Software) != maxSoftware || len(r.Disks) != maxDisks {
		t.Fatalf("caps not applied: %d %d", len(r.Software), len(r.Disks))
	}
}

func TestReportJSONShapeMatchesServerSchema(t *testing.T) {
	r := &Report{AgentID: "abcdefgh", Hostname: "pc", Hardware: Hardware{RAMTotalMB: 1, RAMUsedMB: 0}}
	r.clamp()
	raw, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	var generic map[string]any
	if err := json.Unmarshal(raw, &generic); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"agentId", "agentVersion", "hostname", "os", "hardware", "ipAddresses", "macAddresses", "disks", "software"} {
		if _, ok := generic[key]; !ok {
			t.Fatalf("missing key %q in %s", key, raw)
		}
	}
	hw := generic["hardware"].(map[string]any)
	if _, ok := hw["ramTotalMb"]; !ok {
		t.Fatal("ramTotalMb must always be present")
	}
}

func TestDecodeFlexible(t *testing.T) {
	var many []Disk
	if err := decodeFlexible([]byte(`[{"mount":"C:","totalMb":10,"usedMb":5},{"mount":"D:"}]`), &many); err != nil || len(many) != 2 {
		t.Fatalf("array: %v %v", many, err)
	}
	var one []Disk
	if err := decodeFlexible([]byte(`{"mount":"C:","totalMb":10,"usedMb":5}`), &one); err != nil || len(one) != 1 || one[0].Mount != "C:" {
		t.Fatalf("object: %v %v", one, err)
	}
	var none []Disk
	if err := decodeFlexible([]byte(`null`), &none); err != nil || len(none) != 0 {
		t.Fatalf("null: %v %v", none, err)
	}
	if err := decodeFlexible([]byte(`{bad`), &none); err == nil {
		t.Fatal("expected an error for invalid json")
	}
}
