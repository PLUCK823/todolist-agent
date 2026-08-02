package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"backend/internal/database"
	"backend/internal/repository"
	"backend/internal/service"
	"github.com/gin-gonic/gin"
)

type batchEnvelope struct {
	Code int `json:"code"`
	Data struct {
		Count int `json:"count"`
		Items []struct {
			ID        uint   `json:"id"`
			Title     string `json:"title"`
			Completed bool   `json:"completed"`
		} `json:"items"`
		Index int    `json:"index"`
		Field string `json:"field"`
	} `json:"data"`
}

func setupBatchRouter(t *testing.T) *gin.Engine {
	t.Helper()
	db, err := database.InitDB(database.Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	registerUnprotectedTestTodoRoutes(router, NewTodoHandler(service.NewTodoService(repository.NewTodoRepository(db))))
	return router
}

func batchRequest(t *testing.T, router *gin.Engine, method, path string, body any) (*httptest.ResponseRecorder, batchEnvelope) {
	t.Helper()
	payload, _ := json.Marshal(body)
	req := httptest.NewRequest(method, path, bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)
	var envelope batchEnvelope
	_ = json.Unmarshal(recorder.Body.Bytes(), &envelope)
	return recorder, envelope
}

func TestBatchEndpointsCompleteAtomicFlow(t *testing.T) {
	router := setupBatchRouter(t)
	createdRecorder, created := batchRequest(t, router, http.MethodPost, "/api/todos/batch", map[string]any{
		"items": []map[string]any{{"title": "one"}, {"title": "two", "priority": "high"}},
	})
	if createdRecorder.Code != http.StatusCreated || created.Code != 0 || created.Data.Count != 2 {
		t.Fatalf("create: %d %s", createdRecorder.Code, createdRecorder.Body.String())
	}
	first, second := created.Data.Items[0].ID, created.Data.Items[1].ID

	_, fetched := batchRequest(t, router, http.MethodPost, "/api/todos/batch/get", map[string]any{"ids": []uint{second, first}})
	if fetched.Data.Items[0].ID != second || fetched.Data.Items[1].ID != first {
		t.Fatalf("get order lost: %#v", fetched.Data.Items)
	}

	_, updated := batchRequest(t, router, http.MethodPut, "/api/todos/batch", map[string]any{"items": []map[string]any{
		{"id": first, "title": "renamed"}, {"id": second, "priority": "low"},
	}})
	if updated.Data.Items[0].Title != "renamed" {
		t.Fatalf("update failed: %#v", updated)
	}

	_, status := batchRequest(t, router, http.MethodPatch, "/api/todos/batch/status", map[string]any{"ids": []uint{first, second}, "completed": true})
	if !status.Data.Items[0].Completed || !status.Data.Items[1].Completed {
		t.Fatalf("status failed: %#v", status)
	}

	_, deleted := batchRequest(t, router, http.MethodDelete, "/api/todos/batch", map[string]any{"ids": []uint{second, first}})
	if deleted.Data.Items[0].ID != second || deleted.Data.Items[1].ID != first {
		t.Fatalf("delete snapshots lost order: %#v", deleted)
	}
}

func TestBatchHandlerReturnsStructuredItemError(t *testing.T) {
	router := setupBatchRouter(t)
	recorder, envelope := batchRequest(t, router, http.MethodPost, "/api/todos/batch", map[string]any{
		"items": []map[string]any{{"title": "ok"}, {"title": ""}},
	})
	if recorder.Code != http.StatusBadRequest || envelope.Code != 40002 || envelope.Data.Index != 1 || envelope.Data.Field != "title" {
		t.Fatalf("unexpected response: %d %s", recorder.Code, recorder.Body.String())
	}
}

func TestBatchHandlerReturnsNotFoundWithoutPartialWrite(t *testing.T) {
	router := setupBatchRouter(t)
	_, created := batchRequest(t, router, http.MethodPost, "/api/todos/batch", map[string]any{"items": []map[string]any{{"title": "one"}}})
	id := created.Data.Items[0].ID
	recorder, envelope := batchRequest(t, router, http.MethodPatch, "/api/todos/batch/status", map[string]any{"ids": []uint{id, 9999}, "completed": true})
	if recorder.Code != http.StatusNotFound || envelope.Code != 40401 {
		t.Fatalf("unexpected response: %d %s", recorder.Code, recorder.Body.String())
	}
	_, fetched := batchRequest(t, router, http.MethodPost, "/api/todos/batch/get", map[string]any{"ids": []uint{id}})
	if fetched.Data.Items[0].Completed {
		t.Fatal("partial update occurred")
	}
}
