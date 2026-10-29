package main

// Report is the JSON body sent to POST /api/servicedesk/inventory/report.
// Field names mirror SdInventoryReportSchema on the server.
type Report struct {
	AgentID      string     `json:"agentId"`
	AgentVersion string     `json:"agentVersion"`
	Hostname     string     `json:"hostname"`
	OS           OSInfo     `json:"os"`
	Hardware     Hardware   `json:"hardware"`
	IPAddresses  []string   `json:"ipAddresses"`
	MACAddresses []string   `json:"macAddresses"`
	Disks        []Disk     `json:"disks"`
	Software     []Software `json:"software"`
}

type OSInfo struct {
	Name    string `json:"name,omitempty"`
	Version string `json:"version,omitempty"`
	Arch    string `json:"arch,omitempty"`
}

type Hardware struct {
	Manufacturer string `json:"manufacturer,omitempty"`
	Model        string `json:"model,omitempty"`
	SerialNumber string `json:"serialNumber,omitempty"`
	CPUModel     string `json:"cpuModel,omitempty"`
	CPUCores     int    `json:"cpuCores,omitempty"`
	RAMTotalMB   int64  `json:"ramTotalMb"`
	RAMUsedMB    int64  `json:"ramUsedMb"`
}

type Disk struct {
	Mount   string `json:"mount"`
	Label   string `json:"label,omitempty"`
	FS      string `json:"fs,omitempty"`
	TotalMB int64  `json:"totalMb"`
	UsedMB  int64  `json:"usedMb"`
}

type Software struct {
	Name      string `json:"name"`
	Version   string `json:"version"`
	Publisher string `json:"publisher,omitempty"`
}

// Limits mirror the server schema so one oversized list never fails a report.
const (
	maxDisks    = 64
	maxSoftware = 5000
	maxAddrs    = 32
)

// clamp trims the lists to what the server accepts and drops empty entries.
func (r *Report) clamp() {
	r.IPAddresses = cleanList(r.IPAddresses, maxAddrs)
	r.MACAddresses = cleanList(r.MACAddresses, maxAddrs)
	if len(r.Disks) > maxDisks {
		r.Disks = r.Disks[:maxDisks]
	}
	seen := make(map[string]bool, len(r.Software))
	out := make([]Software, 0, len(r.Software))
	for _, s := range r.Software {
		if s.Name == "" {
			continue
		}
		key := s.Name + "\x00" + s.Version
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, s)
		if len(out) == maxSoftware {
			break
		}
	}
	r.Software = out
	if r.Disks == nil {
		r.Disks = []Disk{}
	}
}

func cleanList(in []string, max int) []string {
	out := make([]string, 0, len(in))
	for _, v := range in {
		if v == "" {
			continue
		}
		out = append(out, v)
		if len(out) == max {
			break
		}
	}
	return out
}
