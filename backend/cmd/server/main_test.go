package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"backend/internal/database"
)

func setupIntegrationApp(t *testing.T) *httptest.Server {
	t.Helper()

	t.Setenv("DB_DRIVER", "sqlite")
	dsn := filepath.Join(t.TempDir(), "integration.db")
	// agent_sessions belongs to the Agent schema, so SetupApp intentionally
	// does not migrate it. Pre-create the external table in the same SQLite
	// file to mirror the compose deployment before exercising auth endpoints.
	db, err := database.InitDB(database.Config{Driver: "sqlite", DSN: dsn})
	if err != nil {
		t.Fatalf("create integration database: %v", err)
	}
	if err := db.Exec(`CREATE TABLE agent_sessions (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL)`).Error; err != nil {
		t.Fatalf("create agent_sessions fixture: %v", err)
	}
	t.Setenv("DB_DSN", dsn)
	t.Setenv("GIN_MODE", "test")
	t.Setenv("AUTH_JWT_SECRET", "integration-test-secret-at-least-32-bytes")

	router, _, err := SetupApp()
	if err != nil {
		t.Fatalf("SetupApp() failed: %v", err)
	}

	return httptest.NewServer(router)
}

func doRequest(ts *httptest.Server, method, path string, body io.Reader) *http.Response {
	req, _ := http.NewRequest(method, ts.URL+path, body)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		panic(fmt.Sprintf("request failed: %v", err))
	}
	return resp
}

func parseBody(resp *http.Response) map[string]interface{} {
	var m map[string]interface{}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	json.Unmarshal(body, &m)
	return m
}

func TestIntegration_HealthCheck(t *testing.T) {
	ts := setupIntegrationApp(t)
	defer ts.Close()

	resp := doRequest(ts, "GET", "/api/health", nil)
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
}

func TestIntegration_CreateTodo(t *testing.T) {
	ts := setupIntegrationApp(t)
	defer ts.Close()

	body := bytes.NewBuffer([]byte(`{"title":"Buy milk","priority":"high","description":"1L whole milk"}`))
	resp := doRequest(ts, "POST", "/api/todos", body)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d", resp.StatusCode)
	}
	data := parseBody(resp)
	d := data["data"].(map[string]interface{})
	if d["title"] != "Buy milk" {
		t.Errorf("unexpected title: %v", d["title"])
	}
}

func TestIntegration_GetTodo(t *testing.T) {
	ts := setupIntegrationApp(t)
	defer ts.Close()

	body := bytes.NewBuffer([]byte(`{"title":"Test Get"}`))
	resp := doRequest(ts, "POST", "/api/todos", body)
	data := parseBody(resp)
	d := data["data"].(map[string]interface{})
	id := int(d["id"].(float64))

	resp = doRequest(ts, "GET", fmt.Sprintf("/api/todos/%d", id), nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
}

func TestIntegration_GetTodo_NotFound(t *testing.T) {
	ts := setupIntegrationApp(t)
	defer ts.Close()

	resp := doRequest(ts, "GET", "/api/todos/9999", nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}

func TestIntegration_ListTodos(t *testing.T) {
	ts := setupIntegrationApp(t)
	defer ts.Close()

	doRequest(ts, "POST", "/api/todos", bytes.NewBuffer([]byte(`{"title":"A"}`)))
	doRequest(ts, "POST", "/api/todos", bytes.NewBuffer([]byte(`{"title":"B"}`)))

	resp := doRequest(ts, "GET", "/api/todos", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	data := parseBody(resp)
	d := data["data"].(map[string]interface{})
	if d["total"].(float64) != 2 {
		t.Errorf("expected total 2, got %v", d["total"])
	}
}

func TestIntegration_UpdateTodo(t *testing.T) {
	ts := setupIntegrationApp(t)
	defer ts.Close()

	body := bytes.NewBuffer([]byte(`{"title":"Original"}`))
	resp := doRequest(ts, "POST", "/api/todos", body)
	data := parseBody(resp)
	d := data["data"].(map[string]interface{})
	id := int(d["id"].(float64))

	updateBody := bytes.NewBuffer([]byte(`{"title":"Updated","priority":"low"}`))
	resp = doRequest(ts, "PUT", fmt.Sprintf("/api/todos/%d", id), updateBody)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	data = parseBody(resp)
	d = data["data"].(map[string]interface{})
	if d["title"] != "Updated" {
		t.Errorf("unexpected title: %v", d["title"])
	}
}

func TestIntegration_UpdateTodo_NotFound(t *testing.T) {
	ts := setupIntegrationApp(t)
	defer ts.Close()

	body := bytes.NewBuffer([]byte(`{"title":"Updated"}`))
	resp := doRequest(ts, "PUT", "/api/todos/9999", body)
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}

func TestIntegration_DeleteTodo(t *testing.T) {
	ts := setupIntegrationApp(t)
	defer ts.Close()

	body := bytes.NewBuffer([]byte(`{"title":"To Delete"}`))
	resp := doRequest(ts, "POST", "/api/todos", body)
	data := parseBody(resp)
	d := data["data"].(map[string]interface{})
	id := int(d["id"].(float64))

	resp = doRequest(ts, "DELETE", fmt.Sprintf("/api/todos/%d", id), nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("expected 204, got %d", resp.StatusCode)
	}
}

func TestIntegration_DeleteTodo_NotFound(t *testing.T) {
	ts := setupIntegrationApp(t)
	defer ts.Close()

	resp := doRequest(ts, "DELETE", "/api/todos/9999", nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}

func TestIntegration_CompleteAndUncomplete(t *testing.T) {
	ts := setupIntegrationApp(t)
	defer ts.Close()

	body := bytes.NewBuffer([]byte(`{"title":"Test State"}`))
	resp := doRequest(ts, "POST", "/api/todos", body)
	data := parseBody(resp)
	d := data["data"].(map[string]interface{})
	id := int(d["id"].(float64))

	resp = doRequest(ts, "PATCH", fmt.Sprintf("/api/todos/%d/complete", id), nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	data = parseBody(resp)
	d = data["data"].(map[string]interface{})
	if d["completed"] != true {
		t.Errorf("expected completed true, got %v", d["completed"])
	}

	resp = doRequest(ts, "PATCH", fmt.Sprintf("/api/todos/%d/uncomplete", id), nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	data = parseBody(resp)
	d = data["data"].(map[string]interface{})
	if d["completed"] != false {
		t.Errorf("expected completed false, got %v", d["completed"])
	}
}

func TestIntegration_SetupAppFailure(t *testing.T) {
	// Test with unsupported driver
	t.Setenv("DB_DRIVER", "mysql")
	t.Setenv("DB_DSN", "invalid")
	t.Setenv("GIN_MODE", "test")
	t.Setenv("AUTH_JWT_SECRET", "integration-test-secret-at-least-32-bytes")

	router, logger, err := SetupApp()
	if router != nil {
		// No router expected on failure
	}
	if err == nil {
		t.Error("expected error for unsupported driver")
	}
	_ = logger
}

func TestIntegration_AuthRejectsWeakJWTSecret(t *testing.T) {
	t.Setenv("DB_DRIVER", "sqlite")
	t.Setenv("DB_DSN", ":memory:")
	t.Setenv("GIN_MODE", "test")
	t.Setenv("AUTH_JWT_SECRET", "short")

	router, logger, err := SetupApp()
	if err == nil || router != nil {
		t.Fatalf("expected weak AUTH_JWT_SECRET startup failure, router=%v err=%v", router, err)
	}
	if logger != nil {
		_ = logger.Sync()
	}
}

func TestIntegration_AuthRoutesAreWired(t *testing.T) {
	ts := setupIntegrationApp(t)
	defer ts.Close()

	req, err := http.NewRequest(http.MethodPost, ts.URL+"/api/auth/register", bytes.NewBufferString(`{"name":"A","email":"a@example.com","password":"password8"}`))
	if err != nil {
		t.Fatalf("new register request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://localhost:3000")
	register, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("send register request: %v", err)
	}
	if register.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(register.Body)
		register.Body.Close()
		t.Fatalf("expected auth registration 201, got %d: %s", register.StatusCode, body)
	}
}
