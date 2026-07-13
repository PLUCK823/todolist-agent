package repository

import (
	"testing"
	"time"

	"backend/internal/database"
	"backend/internal/model"

	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := database.InitDB(database.Config{
		Driver: "sqlite",
		DSN:    ":memory:",
	})
	if err != nil {
		t.Fatalf("failed to init test DB: %v", err)
	}
	return db
}

func createTestTodo(t *testing.T, repo *TodoRepository, title, priority string) *model.Todo {
	t.Helper()
	dueDate := time.Now().Add(24 * time.Hour)
	todo := &model.Todo{
		Title:       title,
		Description: "Test description",
		Priority:    priority,
		Completed:   false,
		DueDate:     &dueDate,
	}
	if err := repo.Create(todo); err != nil {
		t.Fatalf("failed to create test todo: %v", err)
	}
	return todo
}

func TestCreate(t *testing.T) {
	db := setupTestDB(t)
	repo := NewTodoRepository(db)

	dueDate := time.Now().Add(24 * time.Hour)
	todo := &model.Todo{
		Title:       "Test Todo",
		Description: "Test Description",
		Priority:    "high",
		DueDate:     &dueDate,
	}

	err := repo.Create(todo)
	if err != nil {
		t.Fatalf("Create() failed: %v", err)
	}
	if todo.ID == 0 {
		t.Error("expected ID to be set after create")
	}
	if todo.CreatedAt.IsZero() {
		t.Error("expected CreatedAt to be set")
	}
}

func TestGetByID(t *testing.T) {
	db := setupTestDB(t)
	repo := NewTodoRepository(db)

	// Create a todo
	created := createTestTodo(t, repo, "Find Me", "medium")

	// Get it back
	found, err := repo.GetByID(created.ID)
	if err != nil {
		t.Fatalf("GetByID() failed: %v", err)
	}
	if found == nil {
		t.Fatal("expected to find todo")
	}
	if found.Title != "Find Me" {
		t.Errorf("expected title 'Find Me', got '%s'", found.Title)
	}
}

func TestGetByID_NotFound(t *testing.T) {
	db := setupTestDB(t)
	repo := NewTodoRepository(db)

	found, err := repo.GetByID(9999)
	if err != nil {
		t.Fatalf("GetByID() error: %v", err)
	}
	if found != nil {
		t.Error("expected nil for non-existent todo")
	}
}

func TestList(t *testing.T) {
	db := setupTestDB(t)
	repo := NewTodoRepository(db)

	// Create some todos
	createTestTodo(t, repo, "Todo 1", "high")
	createTestTodo(t, repo, "Todo 2", "medium")
	createTestTodo(t, repo, "Todo 3", "low")

	todos, total, err := repo.List(TodoFilter{})
	if err != nil {
		t.Fatalf("List() failed: %v", err)
	}
	if total != 3 {
		t.Errorf("expected total 3, got %d", total)
	}
	if len(todos) != 3 {
		t.Errorf("expected 3 todos, got %d", len(todos))
	}
}

func TestList_Pagination(t *testing.T) {
	db := setupTestDB(t)
	repo := NewTodoRepository(db)

	for i := 0; i < 25; i++ {
		createTestTodo(t, repo, "Todo", "medium")
	}

	todos, total, err := repo.List(TodoFilter{Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("List() failed: %v", err)
	}
	if total != 25 {
		t.Errorf("expected total 25, got %d", total)
	}
	if len(todos) != 10 {
		t.Errorf("expected 10 todos on page 1, got %d", len(todos))
	}

	// Page 2
	todos2, total2, err := repo.List(TodoFilter{Page: 2, PageSize: 10})
	if err != nil {
		t.Fatalf("List() page 2 failed: %v", err)
	}
	if total2 != 25 {
		t.Errorf("expected total 25, got %d", total2)
	}
	if len(todos2) != 10 {
		t.Errorf("expected 10 todos on page 2, got %d", len(todos2))
	}

	// Page 3
	todos3, _, err := repo.List(TodoFilter{Page: 3, PageSize: 10})
	if err != nil {
		t.Fatalf("List() page 3 failed: %v", err)
	}
	if len(todos3) != 5 {
		t.Errorf("expected 5 todos on page 3, got %d", len(todos3))
	}
}

func TestList_FilterByCompleted(t *testing.T) {
	db := setupTestDB(t)
	repo := NewTodoRepository(db)

	todo1 := createTestTodo(t, repo, "Incomplete", "medium")

	// Create a completed todo
	completed := &model.Todo{
		Title:     "Completed",
		Priority:  "high",
		Completed: true,
	}
	if err := repo.Create(completed); err != nil {
		t.Fatalf("Create() failed: %v", err)
	}

	// Mark the first one as complete via Update to trigger GORM hooks
	todo1.Completed = true
	repo.Update(todo1)

	completedFilter := true
	todos, total, err := repo.List(TodoFilter{Completed: &completedFilter})
	if err != nil {
		t.Fatalf("List() completed filter failed: %v", err)
	}
	if total != 2 {
		t.Errorf("expected total 2 completed, got %d", total)
	}
	if len(todos) != 2 {
		t.Errorf("expected 2 completed todos, got %d", len(todos))
	}

	incompleteFilter := false
	todos, total, err = repo.List(TodoFilter{Completed: &incompleteFilter})
	if err != nil {
		t.Fatalf("List() incomplete filter failed: %v", err)
	}
	if total != 0 {
		t.Errorf("expected total 0 incomplete, got %d", total)
	}
}

func TestList_FilterByPriority(t *testing.T) {
	db := setupTestDB(t)
	repo := NewTodoRepository(db)

	createTestTodo(t, repo, "High Priority", "high")
	createTestTodo(t, repo, "Medium Priority", "medium")
	createTestTodo(t, repo, "Low Priority", "low")

	priority := "high"
	todos, total, err := repo.List(TodoFilter{Priority: &priority})
	if err != nil {
		t.Fatalf("List() priority filter failed: %v", err)
	}
	if total != 1 {
		t.Errorf("expected 1 high priority, got %d", total)
	}
	if len(todos) != 1 {
		t.Errorf("expected 1 high priority todo, got %d", len(todos))
	}
}

func TestList_SortByCreatedAt(t *testing.T) {
	db := setupTestDB(t)
	repo := NewTodoRepository(db)

	createTestTodo(t, repo, "First", "medium")
	time.Sleep(10 * time.Millisecond)
	createTestTodo(t, repo, "Second", "medium")

	sortBy := "created_at"
	order := "asc"
	todos, _, err := repo.List(TodoFilter{SortBy: &sortBy, Order: &order})
	if err != nil {
		t.Fatalf("List() sort failed: %v", err)
	}
	if len(todos) < 2 {
		t.Fatal("expected at least 2 todos")
	}
	if todos[0].Title != "First" {
		t.Errorf("expected 'First' first, got '%s'", todos[0].Title)
	}
}

func TestList_SortByCreatedAtDesc(t *testing.T) {
	db := setupTestDB(t)
	repo := NewTodoRepository(db)

	createTestTodo(t, repo, "First", "medium")
	time.Sleep(10 * time.Millisecond)
	createTestTodo(t, repo, "Second", "medium")

	sortBy := "created_at"
	order := "desc"
	todos, _, err := repo.List(TodoFilter{SortBy: &sortBy, Order: &order})
	if err != nil {
		t.Fatalf("List() sort desc failed: %v", err)
	}
	if len(todos) < 2 {
		t.Fatal("expected at least 2 todos")
	}
	if todos[0].Title != "Second" {
		t.Errorf("expected 'Second' first with desc, got '%s'", todos[0].Title)
	}
}

func TestList_KeywordSearch(t *testing.T) {
	db := setupTestDB(t)
	repo := NewTodoRepository(db)

	createTestTodo(t, repo, "Buy milk", "medium")
	createTestTodo(t, repo, "Buy bread", "medium")
	createTestTodo(t, repo, "Read book", "low")

	keyword := "Buy"
	todos, total, err := repo.List(TodoFilter{Keyword: &keyword})
	if err != nil {
		t.Fatalf("List() keyword search failed: %v", err)
	}
	if total != 2 {
		t.Errorf("expected 2 matches for 'Buy', got %d", total)
	}
	if len(todos) != 2 {
		t.Errorf("expected 2 matches, got %d", len(todos))
	}
}

func TestUpdate(t *testing.T) {
	db := setupTestDB(t)
	repo := NewTodoRepository(db)

	todo := createTestTodo(t, repo, "Original Title", "medium")

	todo.Title = "Updated Title"
	todo.Priority = "high"
	err := repo.Update(todo)
	if err != nil {
		t.Fatalf("Update() failed: %v", err)
	}

	// Verify
	updated, _ := repo.GetByID(todo.ID)
	if updated == nil {
		t.Fatal("todo not found after update")
	}
	if updated.Title != "Updated Title" {
		t.Errorf("expected 'Updated Title', got '%s'", updated.Title)
	}
	if updated.Priority != "high" {
		t.Errorf("expected priority 'high', got '%s'", updated.Priority)
	}
}

func TestUpdate_ClearsDueDateToNull(t *testing.T) {
	db := setupTestDB(t)
	repo := NewTodoRepository(db)
	todo := createTestTodo(t, repo, "Clear due date", "medium")
	if todo.DueDate == nil {
		t.Fatal("expected seeded due date")
	}
	todo.DueDate = nil
	if err := repo.Update(todo); err != nil {
		t.Fatalf("Update() failed: %v", err)
	}
	reloaded, err := repo.GetByID(todo.ID)
	if err != nil {
		t.Fatalf("GetByID() failed: %v", err)
	}
	if reloaded == nil || reloaded.DueDate != nil {
		t.Fatalf("expected due_date NULL after Save, got %#v", reloaded)
	}
}

func TestDelete(t *testing.T) {
	db := setupTestDB(t)
	repo := NewTodoRepository(db)

	todo := createTestTodo(t, repo, "To Delete", "medium")

	err := repo.Delete(todo.ID)
	if err != nil {
		t.Fatalf("Delete() failed: %v", err)
	}

	// Verify deletion
	found, _ := repo.GetByID(todo.ID)
	if found != nil {
		t.Error("expected nil after delete")
	}
}

func TestDelete_NotFound(t *testing.T) {
	db := setupTestDB(t)
	repo := NewTodoRepository(db)

	err := repo.Delete(9999)
	if err == nil {
		t.Error("expected error for deleting non-existent todo")
	}
}
