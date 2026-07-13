package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"backend/internal/model"
	"backend/internal/service"

	"github.com/gin-gonic/gin"
)

// mockService implements TodoServiceInterface for testing
type mockService struct {
	todos  map[uint]*model.Todo
	nextID uint
}

func newMockService() *mockService {
	return &mockService{
		todos:  make(map[uint]*model.Todo),
		nextID: 1,
	}
}

func (m *mockService) Create(req service.CreateTodoRequest) (*model.Todo, error) {
	todo := &model.Todo{
		ID:          m.nextID,
		Title:       req.Title,
		Description: req.Description,
		Priority:    req.Priority,
		DueDate:     req.DueDate,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	if todo.Priority == "" {
		todo.Priority = "medium"
	}
	if todo.Title == "" {
		return nil, model.ErrEmptyTitle
	}
	if len([]rune(todo.Title)) > 200 {
		return nil, model.ErrTitleTooLong
	}
	if todo.Priority != "high" && todo.Priority != "medium" && todo.Priority != "low" {
		return nil, model.ErrInvalidPriority
	}
	m.nextID++
	m.todos[todo.ID] = todo
	return todo, nil
}

func (m *mockService) GetByID(id uint) (*model.Todo, error) {
	todo, ok := m.todos[id]
	if !ok {
		return nil, service.ErrTodoNotFound
	}
	return todo, nil
}

func (m *mockService) List(req service.ListTodosRequest) (*service.ListTodosResponse, error) {
	var items []model.Todo
	for _, t := range m.todos {
		items = append(items, *t)
	}
	if items == nil {
		items = []model.Todo{}
	}
	return &service.ListTodosResponse{
		Items:    items,
		Total:    int64(len(items)),
		Page:     1,
		PageSize: 20,
	}, nil
}

func (m *mockService) Update(id uint, req service.UpdateTodoRequest) (*model.Todo, error) {
	todo, ok := m.todos[id]
	if !ok {
		return nil, service.ErrTodoNotFound
	}
	if req.Title != nil {
		if *req.Title == "" {
			return nil, model.ErrEmptyTitle
		}
		todo.Title = *req.Title
	}
	if req.Description != nil {
		todo.Description = *req.Description
	}
	if req.Priority != nil {
		todo.Priority = *req.Priority
	}
	if req.Completed != nil {
		todo.Completed = *req.Completed
	}
	if req.DueDate != nil {
		todo.DueDate = req.DueDate
	}
	todo.UpdatedAt = time.Now()
	return todo, nil
}

func (m *mockService) Delete(id uint) error {
	if _, ok := m.todos[id]; !ok {
		return service.ErrTodoNotFound
	}
	delete(m.todos, id)
	return nil
}

func (m *mockService) Complete(id uint) (*model.Todo, error) {
	todo, ok := m.todos[id]
	if !ok {
		return nil, service.ErrTodoNotFound
	}
	todo.Completed = true
	return todo, nil
}

func (m *mockService) Uncomplete(id uint) (*model.Todo, error) {
	todo, ok := m.todos[id]
	if !ok {
		return nil, service.ErrTodoNotFound
	}
	todo.Completed = false
	return todo, nil
}

// mockFailingService always returns errors
type mockFailingService struct{}

func (m *mockFailingService) Create(req service.CreateTodoRequest) (*model.Todo, error) {
	return nil, errors.New("db error")
}
func (m *mockFailingService) GetByID(id uint) (*model.Todo, error) {
	return nil, errors.New("db error")
}
func (m *mockFailingService) List(req service.ListTodosRequest) (*service.ListTodosResponse, error) {
	return nil, errors.New("db error")
}
func (m *mockFailingService) Update(id uint, req service.UpdateTodoRequest) (*model.Todo, error) {
	return nil, errors.New("db error")
}
func (m *mockFailingService) Delete(id uint) error {
	return errors.New("db error")
}
func (m *mockFailingService) Complete(id uint) (*model.Todo, error) {
	return nil, errors.New("db error")
}
func (m *mockFailingService) Uncomplete(id uint) (*model.Todo, error) {
	return nil, errors.New("db error")
}

func setupTestRouter(svc TodoServiceInterface) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterRoutes(router, svc)
	return router
}

// Helper to make request and get response
func makeRequest(router *gin.Engine, method, path string, body interface{}) *httptest.ResponseRecorder {
	var reqBody *bytes.Buffer
	if body != nil {
		jsonBytes, _ := json.Marshal(body)
		reqBody = bytes.NewBuffer(jsonBytes)
	} else {
		reqBody = bytes.NewBuffer(nil)
	}
	req, _ := http.NewRequest(method, path, reqBody)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

func parseResponse(t *testing.T, w *httptest.ResponseRecorder) map[string]interface{} {
	t.Helper()
	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v, body: %s", err, w.Body.String())
	}
	return resp
}

// --- Health Check ---

func TestHealthCheck(t *testing.T) {
	router := setupTestRouter(newMockService())

	w := makeRequest(router, "GET", "/api/health", nil)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
	resp := parseResponse(t, w)
	if resp["code"] != float64(0) {
		t.Errorf("expected code 0, got %v", resp["code"])
	}
}

// --- Create Todo ---

func TestHandler_CreateTodo(t *testing.T) {
	router := setupTestRouter(newMockService())

	body := map[string]interface{}{
		"title":    "Buy milk",
		"priority": "high",
	}
	w := makeRequest(router, "POST", "/api/todos", body)

	if w.Code != http.StatusCreated {
		t.Errorf("expected status 201, got %d", w.Code)
	}
	resp := parseResponse(t, w)
	if resp["code"] != float64(0) {
		t.Errorf("expected code 0, got %v", resp["code"])
	}
	data := resp["data"].(map[string]interface{})
	if data["title"] != "Buy milk" {
		t.Errorf("expected title 'Buy milk', got '%v'", data["title"])
	}
}

func TestHandler_CreateTodo_EmptyTitle(t *testing.T) {
	router := setupTestRouter(newMockService())

	body := map[string]string{"title": ""}
	w := makeRequest(router, "POST", "/api/todos", body)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
	resp := parseResponse(t, w)
	if resp["code"] != float64(40001) {
		t.Errorf("expected code 40001, got %v", resp["code"])
	}
}

func TestHandler_CreateTodo_DBError(t *testing.T) {
	router := setupTestRouter(&mockFailingService{})

	body := map[string]string{"title": "test"}
	w := makeRequest(router, "POST", "/api/todos", body)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected status 500, got %d", w.Code)
	}
}

// --- Get Todo ---

func TestHandler_GetTodo(t *testing.T) {
	svc := newMockService()
	svc.Create(service.CreateTodoRequest{Title: "Test Todo"})
	router := setupTestRouter(svc)

	w := makeRequest(router, "GET", "/api/todos/1", nil)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d, body: %s", w.Code, w.Body.String())
	}
	resp := parseResponse(t, w)
	if resp["code"] != float64(0) {
		t.Errorf("expected code 0, got %v", resp["code"])
	}
}

func TestHandler_GetTodo_NotFound(t *testing.T) {
	router := setupTestRouter(newMockService())

	w := makeRequest(router, "GET", "/api/todos/999", nil)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
	resp := parseResponse(t, w)
	if resp["code"] != float64(40401) {
		t.Errorf("expected code 40401, got %v", resp["code"])
	}
}

func TestHandler_GetTodo_InvalidID(t *testing.T) {
	router := setupTestRouter(newMockService())

	w := makeRequest(router, "GET", "/api/todos/abc", nil)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

// --- List Todos ---

func TestHandler_ListTodos(t *testing.T) {
	svc := newMockService()
	svc.Create(service.CreateTodoRequest{Title: "Todo 1"})
	svc.Create(service.CreateTodoRequest{Title: "Todo 2"})
	router := setupTestRouter(svc)

	w := makeRequest(router, "GET", "/api/todos", nil)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
	resp := parseResponse(t, w)
	if resp["code"] != float64(0) {
		t.Errorf("expected code 0, got %v", resp["code"])
	}
	data := resp["data"].(map[string]interface{})
	if data["total"] != float64(2) {
		t.Errorf("expected total 2, got %v", data["total"])
	}
}

func TestHandler_ListTodos_DBError(t *testing.T) {
	router := setupTestRouter(&mockFailingService{})

	w := makeRequest(router, "GET", "/api/todos", nil)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected status 500, got %d", w.Code)
	}
}

// --- Update Todo ---

func TestHandler_UpdateTodo(t *testing.T) {
	svc := newMockService()
	svc.Create(service.CreateTodoRequest{Title: "Original"})
	router := setupTestRouter(svc)

	body := map[string]string{"title": "Updated"}
	w := makeRequest(router, "PUT", "/api/todos/1", body)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
	resp := parseResponse(t, w)
	data := resp["data"].(map[string]interface{})
	if data["title"] != "Updated" {
		t.Errorf("expected title 'Updated', got '%v'", data["title"])
	}
}

func TestHandler_UpdateTodo_NotFound(t *testing.T) {
	router := setupTestRouter(newMockService())

	body := map[string]string{"title": "Updated"}
	w := makeRequest(router, "PUT", "/api/todos/999", body)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

func TestHandler_UpdateTodo_InvalidID(t *testing.T) {
	router := setupTestRouter(newMockService())

	body := map[string]string{"title": "Updated"}
	w := makeRequest(router, "PUT", "/api/todos/abc", body)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

// --- Delete Todo ---

func TestHandler_DeleteTodo(t *testing.T) {
	svc := newMockService()
	svc.Create(service.CreateTodoRequest{Title: "To Delete"})
	router := setupTestRouter(svc)

	w := makeRequest(router, "DELETE", "/api/todos/1", nil)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestHandler_DeleteTodo_NotFound(t *testing.T) {
	router := setupTestRouter(newMockService())

	w := makeRequest(router, "DELETE", "/api/todos/999", nil)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

// --- Complete ---

func TestHandler_CompleteTodo(t *testing.T) {
	svc := newMockService()
	svc.Create(service.CreateTodoRequest{Title: "To Complete"})
	router := setupTestRouter(svc)

	w := makeRequest(router, "PATCH", "/api/todos/1/complete", nil)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
	resp := parseResponse(t, w)
	data := resp["data"].(map[string]interface{})
	if data["completed"] != true {
		t.Errorf("expected completed true, got %v", data["completed"])
	}
}

func TestHandler_CompleteTodo_NotFound(t *testing.T) {
	router := setupTestRouter(newMockService())

	w := makeRequest(router, "PATCH", "/api/todos/999/complete", nil)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

// --- Uncomplete ---

func TestHandler_UncompleteTodo(t *testing.T) {
	svc := newMockService()
	svc.Create(service.CreateTodoRequest{Title: "To Uncomplete"})
	svc.Complete(1)
	router := setupTestRouter(svc)

	w := makeRequest(router, "PATCH", "/api/todos/1/uncomplete", nil)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
	resp := parseResponse(t, w)
	data := resp["data"].(map[string]interface{})
	if data["completed"] != false {
		t.Errorf("expected completed false, got %v", data["completed"])
	}
}

func TestHandler_UncompleteTodo_NotFound(t *testing.T) {
	router := setupTestRouter(newMockService())

	w := makeRequest(router, "PATCH", "/api/todos/999/uncomplete", nil)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

func TestHandler_CreateTodo_InvalidJSON(t *testing.T) {
	router := setupTestRouter(newMockService())

	req, _ := http.NewRequest("POST", "/api/todos", bytes.NewBuffer([]byte("not json")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestHandler_UpdateTodo_InvalidJSON(t *testing.T) {
	router := setupTestRouter(newMockService())

	req, _ := http.NewRequest("PUT", "/api/todos/1", bytes.NewBuffer([]byte("not json")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestHandler_UpdateTodo_ValidationError(t *testing.T) {
	svc := newMockService()
	svc.Create(service.CreateTodoRequest{Title: "Original"})
	router := setupTestRouter(svc)

	body := map[string]string{"title": ""}
	w := makeRequest(router, "PUT", "/api/todos/1", body)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestHandler_DeleteTodo_InvalidID(t *testing.T) {
	router := setupTestRouter(newMockService())

	w := makeRequest(router, "DELETE", "/api/todos/abc", nil)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestHandler_CompleteTodo_InvalidID(t *testing.T) {
	router := setupTestRouter(newMockService())

	w := makeRequest(router, "PATCH", "/api/todos/abc/complete", nil)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestHandler_UncompleteTodo_InvalidID(t *testing.T) {
	router := setupTestRouter(newMockService())

	w := makeRequest(router, "PATCH", "/api/todos/abc/uncomplete", nil)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestHandler_CompleteTodo_DBError(t *testing.T) {
	router := setupTestRouter(&mockFailingService{})

	w := makeRequest(router, "PATCH", "/api/todos/1/complete", nil)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected status 500, got %d", w.Code)
	}
}

func TestHandler_UncompleteTodo_DBError(t *testing.T) {
	router := setupTestRouter(&mockFailingService{})

	w := makeRequest(router, "PATCH", "/api/todos/1/uncomplete", nil)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected status 500, got %d", w.Code)
	}
}

func TestHandler_GetTodo_DBError(t *testing.T) {
	router := setupTestRouter(&mockFailingService{})

	w := makeRequest(router, "GET", "/api/todos/1", nil)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected status 500, got %d", w.Code)
	}
}

func TestHandler_UpdateTodo_DBError(t *testing.T) {
	router := setupTestRouter(&mockFailingService{})

	body := map[string]string{"title": "updated"}
	w := makeRequest(router, "PUT", "/api/todos/1", body)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected status 500, got %d", w.Code)
	}
}

func TestHandler_DeleteTodo_DBError(t *testing.T) {
	router := setupTestRouter(&mockFailingService{})

	w := makeRequest(router, "DELETE", "/api/todos/1", nil)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected status 500, got %d", w.Code)
	}
}

func TestHandler_ListTodos_Empty(t *testing.T) {
	router := setupTestRouter(newMockService())

	w := makeRequest(router, "GET", "/api/todos", nil)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
	resp := parseResponse(t, w)
	data := resp["data"].(map[string]interface{})
	items := data["items"].([]interface{})
	if len(items) != 0 {
		t.Errorf("expected empty items, got %d", len(items))
	}
}

func TestHandler_ListTodos_WithQueryParams(t *testing.T) {
	svc := newMockService()
	svc.Create(service.CreateTodoRequest{Title: "High", Priority: "high"})
	router := setupTestRouter(svc)

	req, _ := http.NewRequest("GET", "/api/todos?priority=high&page=1&page_size=10", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestHandler_CreateTodo_DefaultValues(t *testing.T) {
	router := setupTestRouter(newMockService())

	// Only title, no priority or due_date
	body := map[string]string{"title": "Minimal"}
	w := makeRequest(router, "POST", "/api/todos", body)

	if w.Code != http.StatusCreated {
		t.Errorf("expected status 201, got %d, body: %s", w.Code, w.Body.String())
	}
	resp := parseResponse(t, w)
	data := resp["data"].(map[string]interface{})
	if data["priority"] != "medium" {
		t.Errorf("expected default priority 'medium', got '%v'", data["priority"])
	}
}
