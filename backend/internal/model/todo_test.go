package model

import (
	"testing"
	"time"
)

func TestTodoStruct(t *testing.T) {
	now := time.Now()
	dueDate := now.Add(24 * time.Hour)

	todo := Todo{
		ID:          1,
		Title:       "Buy milk",
		Description: "Whole milk 1L",
		Priority:    "high",
		Completed:   false,
		DueDate:     &dueDate,
	}

	if todo.ID != 1 {
		t.Errorf("expected ID 1, got %d", todo.ID)
	}
	if todo.Title != "Buy milk" {
		t.Errorf("expected title 'Buy milk', got '%s'", todo.Title)
	}
	if todo.Priority != "high" {
		t.Errorf("expected priority 'high', got '%s'", todo.Priority)
	}
	if todo.Completed != false {
		t.Errorf("expected completed false, got %v", todo.Completed)
	}
	if todo.DueDate == nil {
		t.Error("expected due_date to be set")
	}
}

func TestValidate_TitleRequired(t *testing.T) {
	todo := Todo{Title: ""}
	err := todo.Validate()
	if err == nil {
		t.Fatal("expected error for empty title")
	}
	if err != ErrEmptyTitle {
		t.Errorf("expected ErrEmptyTitle, got %v", err)
	}
}

func TestValidate_TitleTooLong(t *testing.T) {
	longTitle := ""
	for i := 0; i < 201; i++ {
		longTitle += "a"
	}
	todo := Todo{Title: longTitle}
	err := todo.Validate()
	if err == nil {
		t.Fatal("expected error for too long title")
	}
	if err != ErrTitleTooLong {
		t.Errorf("expected ErrTitleTooLong, got %v", err)
	}
}

func TestValidate_InvalidPriority(t *testing.T) {
	todo := Todo{Title: "Test", Priority: "invalid"}
	err := todo.Validate()
	if err == nil {
		t.Fatal("expected error for invalid priority")
	}
	if err != ErrInvalidPriority {
		t.Errorf("expected ErrInvalidPriority, got %v", err)
	}
}

func TestValidate_ValidPriorities(t *testing.T) {
	priorities := []string{"high", "medium", "low"}
	for _, p := range priorities {
		todo := Todo{Title: "Test", Priority: p}
		err := todo.Validate()
		if err != nil {
			t.Errorf("expected no error for priority '%s', got %v", p, err)
		}
	}
}

func TestValidate_DefaultPriority(t *testing.T) {
	todo := Todo{Title: "Test"}
	err := todo.Validate()
	if err != nil {
		t.Errorf("expected no error with default priority, got %v", err)
	}
	if todo.Priority != "medium" {
		t.Errorf("expected default priority 'medium', got '%s'", todo.Priority)
	}
}

func TestValidate_TitleAtMaxLength(t *testing.T) {
	title := ""
	for i := 0; i < 200; i++ {
		title += "a"
	}
	todo := Todo{Title: title}
	err := todo.Validate()
	if err != nil {
		t.Errorf("expected no error for 200-char title, got %v", err)
	}
}

func TestValidate_TitleAtMinLength(t *testing.T) {
	todo := Todo{Title: "a"}
	err := todo.Validate()
	if err != nil {
		t.Errorf("expected no error for 1-char title, got %v", err)
	}
}
