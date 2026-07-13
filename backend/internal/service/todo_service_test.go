package service

import (
	"errors"
	"testing"
	"time"

	"backend/internal/model"
)

// mockRepo implements TodoRepository interface for testing
type mockRepo struct {
	todos    map[uint]*model.Todo
	nextID   uint
}

func newMockRepo() *mockRepo {
	return &mockRepo{
		todos:  make(map[uint]*model.Todo),
		nextID: 1,
	}
}

func (m *mockRepo) Create(todo *model.Todo) error {
	todo.ID = m.nextID
	m.nextID++
	now := time.Now()
	todo.CreatedAt = now
	todo.UpdatedAt = now
	m.todos[todo.ID] = todo
	return nil
}

func (m *mockRepo) GetByID(id uint) (*model.Todo, error) {
	todo, ok := m.todos[id]
	if !ok {
		return nil, nil
	}
	return todo, nil
}

func (m *mockRepo) List(filter TodoFilter) ([]model.Todo, int64, error) {
	var result []model.Todo
	for _, t := range m.todos {
		result = append(result, *t)
	}
	return result, int64(len(result)), nil
}

func (m *mockRepo) Update(todo *model.Todo) error {
	todo.UpdatedAt = time.Now()
	m.todos[todo.ID] = todo
	return nil
}

func (m *mockRepo) Delete(id uint) error {
	if _, ok := m.todos[id]; !ok {
		return errors.New("record not found")
	}
	delete(m.todos, id)
	return nil
}

func TestCreateTodo_Success(t *testing.T) {
	repo := newMockRepo()
	svc := NewTodoService(repo)

	dueDate := time.Now().Add(24 * time.Hour)
	req := CreateTodoRequest{
		Title:       "Buy milk",
		Description: "Whole milk 1L",
		Priority:    "high",
		DueDate:     &dueDate,
	}

	todo, err := svc.Create(req)
	if err != nil {
		t.Fatalf("Create() failed: %v", err)
	}
	if todo.ID == 0 {
		t.Error("expected ID to be set")
	}
	if todo.Title != "Buy milk" {
		t.Errorf("expected title 'Buy milk', got '%s'", todo.Title)
	}
	if todo.Priority != "high" {
		t.Errorf("expected priority 'high', got '%s'", todo.Priority)
	}
}

func TestCreateTodo_EmptyTitle(t *testing.T) {
	repo := newMockRepo()
	svc := NewTodoService(repo)

	_, err := svc.Create(CreateTodoRequest{Title: ""})
	if err == nil {
		t.Fatal("expected error for empty title")
	}
	if err != model.ErrEmptyTitle {
		t.Errorf("expected ErrEmptyTitle, got %v", err)
	}
}

func TestCreateTodo_TitleTooLong(t *testing.T) {
	repo := newMockRepo()
	svc := NewTodoService(repo)

	longTitle := ""
	for i := 0; i < 201; i++ {
		longTitle += "a"
	}
	_, err := svc.Create(CreateTodoRequest{Title: longTitle})
	if err == nil {
		t.Fatal("expected error for too long title")
	}
	if err != model.ErrTitleTooLong {
		t.Errorf("expected ErrTitleTooLong, got %v", err)
	}
}

func TestCreateTodo_InvalidPriority(t *testing.T) {
	repo := newMockRepo()
	svc := NewTodoService(repo)

	_, err := svc.Create(CreateTodoRequest{Title: "Test", Priority: "invalid"})
	if err == nil {
		t.Fatal("expected error for invalid priority")
	}
	if err != model.ErrInvalidPriority {
		t.Errorf("expected ErrInvalidPriority, got %v", err)
	}
}

func TestCreateTodo_DefaultPriority(t *testing.T) {
	repo := newMockRepo()
	svc := NewTodoService(repo)

	todo, err := svc.Create(CreateTodoRequest{Title: "Test"})
	if err != nil {
		t.Fatalf("Create() failed: %v", err)
	}
	if todo.Priority != "medium" {
		t.Errorf("expected default priority 'medium', got '%s'", todo.Priority)
	}
}

func TestGetByID_Found(t *testing.T) {
	repo := newMockRepo()
	svc := NewTodoService(repo)

	created, _ := svc.Create(CreateTodoRequest{Title: "Test"})

	found, err := svc.GetByID(created.ID)
	if err != nil {
		t.Fatalf("GetByID() failed: %v", err)
	}
	if found == nil {
		t.Fatal("expected to find todo")
	}
	if found.ID != created.ID {
		t.Errorf("expected ID %d, got %d", created.ID, found.ID)
	}
}

func TestGetByID_NotFound(t *testing.T) {
	repo := newMockRepo()
	svc := NewTodoService(repo)

	_, err := svc.GetByID(9999)
	if err == nil {
		t.Fatal("expected error for not found")
	}
	if err != ErrTodoNotFound {
		t.Errorf("expected ErrTodoNotFound, got %v", err)
	}
}

func TestList(t *testing.T) {
	repo := newMockRepo()
	svc := NewTodoService(repo)

	svc.Create(CreateTodoRequest{Title: "Todo 1"})
	svc.Create(CreateTodoRequest{Title: "Todo 2"})

	result, err := svc.List(ListTodosRequest{})
	if err != nil {
		t.Fatalf("List() failed: %v", err)
	}
	if result.Total != 2 {
		t.Errorf("expected total 2, got %d", result.Total)
	}
}

func TestUpdate_Success(t *testing.T) {
	repo := newMockRepo()
	svc := NewTodoService(repo)

	created, _ := svc.Create(CreateTodoRequest{Title: "Original", Priority: "low"})

	newTitle := "Updated"
	req := UpdateTodoRequest{Title: &newTitle}
	todo, err := svc.Update(created.ID, req)
	if err != nil {
		t.Fatalf("Update() failed: %v", err)
	}
	if todo.Title != "Updated" {
		t.Errorf("expected title 'Updated', got '%s'", todo.Title)
	}
}

func TestUpdate_NotFound(t *testing.T) {
	repo := newMockRepo()
	svc := NewTodoService(repo)

	newTitle := "Updated"
	_, err := svc.Update(9999, UpdateTodoRequest{Title: &newTitle})
	if err == nil {
		t.Fatal("expected error for not found")
	}
	if err != ErrTodoNotFound {
		t.Errorf("expected ErrTodoNotFound, got %v", err)
	}
}

func TestUpdate_EmptyTitle(t *testing.T) {
	repo := newMockRepo()
	svc := NewTodoService(repo)

	created, _ := svc.Create(CreateTodoRequest{Title: "Original"})

	emptyTitle := ""
	_, err := svc.Update(created.ID, UpdateTodoRequest{Title: &emptyTitle})
	if err == nil {
		t.Fatal("expected error for empty title")
	}
	if err != model.ErrEmptyTitle {
		t.Errorf("expected ErrEmptyTitle, got %v", err)
	}
}

func TestUpdate_InvalidPriority(t *testing.T) {
	repo := newMockRepo()
	svc := NewTodoService(repo)

	created, _ := svc.Create(CreateTodoRequest{Title: "Original"})

	invalidPri := "invalid"
	_, err := svc.Update(created.ID, UpdateTodoRequest{Priority: &invalidPri})
	if err == nil {
		t.Fatal("expected error for invalid priority")
	}
	if err != model.ErrInvalidPriority {
		t.Errorf("expected ErrInvalidPriority, got %v", err)
	}
}

func TestDelete_Success(t *testing.T) {
	repo := newMockRepo()
	svc := NewTodoService(repo)

	created, _ := svc.Create(CreateTodoRequest{Title: "To Delete"})

	err := svc.Delete(created.ID)
	if err != nil {
		t.Fatalf("Delete() failed: %v", err)
	}

	// Verify deletion
	_, err = svc.GetByID(created.ID)
	if err != ErrTodoNotFound {
		t.Errorf("expected ErrTodoNotFound after delete, got %v", err)
	}
}

func TestDelete_NotFound(t *testing.T) {
	repo := newMockRepo()
	svc := NewTodoService(repo)

	err := svc.Delete(9999)
	if err == nil {
		t.Fatal("expected error for not found")
	}
	if err != ErrTodoNotFound {
		t.Errorf("expected ErrTodoNotFound, got %v", err)
	}
}

func TestComplete(t *testing.T) {
	repo := newMockRepo()
	svc := NewTodoService(repo)

	created, _ := svc.Create(CreateTodoRequest{Title: "To Complete"})

	todo, err := svc.Complete(created.ID)
	if err != nil {
		t.Fatalf("Complete() failed: %v", err)
	}
	if !todo.Completed {
		t.Error("expected completed to be true")
	}
}

func TestComplete_NotFound(t *testing.T) {
	repo := newMockRepo()
	svc := NewTodoService(repo)

	_, err := svc.Complete(9999)
	if err == nil {
		t.Fatal("expected error for not found")
	}
	if err != ErrTodoNotFound {
		t.Errorf("expected ErrTodoNotFound, got %v", err)
	}
}

func TestComplete_AlreadyCompleted(t *testing.T) {
	repo := newMockRepo()
	svc := NewTodoService(repo)

	created, _ := svc.Create(CreateTodoRequest{Title: "Already Done"})
	svc.Complete(created.ID)

	// Complete again - should be idempotent (no error)
	todo, err := svc.Complete(created.ID)
	if err != nil {
		t.Fatalf("Complete() on already completed should not error: %v", err)
	}
	if !todo.Completed {
		t.Error("expected completed to still be true")
	}
}

func TestUncomplete(t *testing.T) {
	repo := newMockRepo()
	svc := NewTodoService(repo)

	created, _ := svc.Create(CreateTodoRequest{Title: "To Uncomplete"})
	svc.Complete(created.ID)

	todo, err := svc.Uncomplete(created.ID)
	if err != nil {
		t.Fatalf("Uncomplete() failed: %v", err)
	}
	if todo.Completed {
		t.Error("expected completed to be false after uncomplete")
	}
}

func TestUncomplete_NotFound(t *testing.T) {
	repo := newMockRepo()
	svc := NewTodoService(repo)

	_, err := svc.Uncomplete(9999)
	if err == nil {
		t.Fatal("expected error for not found")
	}
	if err != ErrTodoNotFound {
		t.Errorf("expected ErrTodoNotFound, got %v", err)
	}
}

func TestUncomplete_AlreadyUncompleted(t *testing.T) {
	repo := newMockRepo()
	svc := NewTodoService(repo)

	created, _ := svc.Create(CreateTodoRequest{Title: "Still Active"})

	// Uncomplete an already uncompleted todo - should be idempotent
	todo, err := svc.Uncomplete(created.ID)
	if err != nil {
		t.Fatalf("Uncomplete() on already uncompleted should not error: %v", err)
	}
	if todo.Completed {
		t.Error("expected completed to be false")
	}
}
