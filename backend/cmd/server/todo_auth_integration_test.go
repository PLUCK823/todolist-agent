package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"testing"
)

const browserOrigin = "http://localhost:3000"

func authenticatedClient(t *testing.T, tsURL, name, email string) *http.Client {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("create cookie jar: %v", err)
	}
	client := &http.Client{Jar: jar}
	request := func(path, body string) *http.Response {
		req, err := http.NewRequest(http.MethodPost, tsURL+path, bytes.NewBufferString(body))
		if err != nil {
			t.Fatalf("create auth request: %v", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", browserOrigin)
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("send auth request: %v", err)
		}
		return resp
	}
	register := request("/api/auth/register", fmt.Sprintf(`{"name":%q,"email":%q,"password":"password8"}`, name, email))
	register.Body.Close()
	if register.StatusCode != http.StatusCreated {
		t.Fatalf("register %s: expected 201, got %d", email, register.StatusCode)
	}
	login := request("/api/auth/login", fmt.Sprintf(`{"email":%q,"password":"password8"}`, email))
	login.Body.Close()
	if login.StatusCode != http.StatusOK {
		t.Fatalf("login %s: expected 200, got %d", email, login.StatusCode)
	}
	return client
}

func todoRequest(t *testing.T, client *http.Client, method, url, body string, withOrigin bool) *http.Response {
	t.Helper()
	var payload *bytes.Reader
	if body == "" {
		payload = bytes.NewReader(nil)
	} else {
		payload = bytes.NewReader([]byte(body))
	}
	req, err := http.NewRequest(method, url, payload)
	if err != nil {
		t.Fatalf("create todo request: %v", err)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if withOrigin {
		req.Header.Set("Origin", browserOrigin)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("send todo request: %v", err)
	}
	return resp
}

func TestIntegration_TodoRoutesRequireAuthenticationAndOrigin(t *testing.T) {
	ts := setupIntegrationApp(t)
	defer ts.Close()

	unauthenticated := todoRequest(t, http.DefaultClient, http.MethodGet, ts.URL+"/api/todos", "", false)
	unauthenticated.Body.Close()
	if unauthenticated.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous list: expected 401, got %d", unauthenticated.StatusCode)
	}

	alice := authenticatedClient(t, ts.URL, "Alice", "alice@example.com")
	missingOrigin := todoRequest(t, alice, http.MethodPost, ts.URL+"/api/todos", `{"title":"private"}`, false)
	missingOrigin.Body.Close()
	if missingOrigin.StatusCode != http.StatusForbidden {
		t.Fatalf("missing Origin: expected 403, got %d", missingOrigin.StatusCode)
	}
}

func TestIntegration_TodosAreIsolatedByAuthenticatedOwner(t *testing.T) {
	ts := setupIntegrationApp(t)
	defer ts.Close()

	alice := authenticatedClient(t, ts.URL, "Alice", "alice@example.com")
	bob := authenticatedClient(t, ts.URL, "Bob", "bob@example.com")

	created := todoRequest(t, alice, http.MethodPost, ts.URL+"/api/todos", `{"title":"Alice private task"}`, true)
	if created.StatusCode != http.StatusCreated {
		created.Body.Close()
		t.Fatalf("Alice create: expected 201, got %d", created.StatusCode)
	}
	var envelope struct {
		Data struct {
			ID uint `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(created.Body).Decode(&envelope); err != nil {
		created.Body.Close()
		t.Fatalf("decode created todo: %v", err)
	}
	created.Body.Close()

	bobList := todoRequest(t, bob, http.MethodGet, ts.URL+"/api/todos", "", false)
	var listEnvelope struct {
		Data struct {
			Total int64 `json:"total"`
		} `json:"data"`
	}
	if err := json.NewDecoder(bobList.Body).Decode(&listEnvelope); err != nil {
		bobList.Body.Close()
		t.Fatalf("decode Bob list: %v", err)
	}
	bobList.Body.Close()
	if bobList.StatusCode != http.StatusOK || listEnvelope.Data.Total != 0 {
		t.Fatalf("Bob list leaked Alice data: status=%d total=%d", bobList.StatusCode, listEnvelope.Data.Total)
	}

	bobRead := todoRequest(t, bob, http.MethodGet, fmt.Sprintf("%s/api/todos/%d", ts.URL, envelope.Data.ID), "", false)
	bobRead.Body.Close()
	if bobRead.StatusCode != http.StatusNotFound {
		t.Fatalf("Bob read Alice todo: expected 404, got %d", bobRead.StatusCode)
	}
}
