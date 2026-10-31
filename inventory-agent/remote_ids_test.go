package main

import "testing"

func TestParseRemoteID(t *testing.T) {
	cases := []struct{ in, want string }{
		{"123456789\n", "123456789"},
		{"  123 456 789  \n", "123456789"},
		{"\n\n987-654-321", "987654321"},
		{"suporte@ad", "suporte@ad"},
		{"", ""},
		{"abc", ""},
		{"has space inside", ""},
		{"error: not running", ""},
	}
	for _, c := range cases {
		if got := parseRemoteID(c.in); got != c.want {
			t.Errorf("parseRemoteID(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestDetectRemoteIDsWithoutTools(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	if ids := detectRemoteIDs(); ids != nil {
		t.Errorf("expected nil without tools, got %+v", ids)
	}
}
