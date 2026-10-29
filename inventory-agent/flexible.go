package main

import (
	"bytes"
	"encoding/json"
)

// decodeFlexible decodes either a JSON array or a single JSON object into a
// slice. Windows PowerShell 5 collapses one-element arrays into a bare object.
func decodeFlexible[T any](raw json.RawMessage, out *[]T) error {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		*out = nil
		return nil
	}
	if trimmed[0] == '[' {
		return json.Unmarshal(trimmed, out)
	}
	var one T
	if err := json.Unmarshal(trimmed, &one); err != nil {
		return err
	}
	*out = []T{one}
	return nil
}
