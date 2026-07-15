package model

import (
	"encoding/json"
	"testing"
)

func TestOptionalTimeDistinguishesMissingAndNull(t *testing.T) {
	type payload struct {
		DueDate OptionalTime `json:"due_date"`
	}
	var missing payload
	if err := json.Unmarshal([]byte(`{}`), &missing); err != nil {
		t.Fatal(err)
	}
	if missing.DueDate.Set {
		t.Fatal("expected missing due_date to remain unset")
	}
	var cleared payload
	if err := json.Unmarshal([]byte(`{"due_date":null}`), &cleared); err != nil {
		t.Fatal(err)
	}
	if !cleared.DueDate.Set || cleared.DueDate.Value != nil {
		t.Fatalf("expected explicit null, got %#v", cleared.DueDate)
	}
}
