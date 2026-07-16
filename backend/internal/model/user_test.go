package model

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestUserPersistenceContractDoesNotExposePasswordHash(t *testing.T) {
	user := User{
		ID:           "78cd2d35-3c5e-446d-b61e-66b7f6e2339b",
		Email:        "person@example.com",
		DisplayName:  "Person",
		PasswordHash: "secret-password-hash",
	}

	encoded, err := json.Marshal(user)
	if err != nil {
		t.Fatalf("json.Marshal() failed: %v", err)
	}
	if strings.Contains(string(encoded), user.PasswordHash) || strings.Contains(string(encoded), "password") {
		t.Fatalf("password hash leaked in public JSON: %s", encoded)
	}
	if (User{}).TableName() != "users" {
		t.Fatalf("unexpected users table name %q", (User{}).TableName())
	}
	if (AuthSession{}).TableName() != "auth_sessions" {
		t.Fatalf("unexpected auth sessions table name %q", (AuthSession{}).TableName())
	}
}
