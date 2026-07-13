package service

import (
	"errors"
	"time"

	"backend/internal/model"
	"backend/internal/repository"
)

var (
	ErrTodoNotFound = errors.New("待办不存在")
)

// CreateTodoRequest represents the input for creating a todo
type CreateTodoRequest struct {
	Title       string     `json:"title" binding:"required"`
	Description string     `json:"description"`
	Priority    string     `json:"priority"`
	DueDate     *time.Time `json:"due_date"`
}

// UpdateTodoRequest represents the input for updating a todo (all fields optional)
type UpdateTodoRequest struct {
	Title       *string    `json:"title"`
	Description *string    `json:"description"`
	Priority    *string    `json:"priority"`
	Completed   *bool      `json:"completed"`
	DueDate     *time.Time `json:"due_date"`
}

// ListTodosRequest represents the input for listing todos
type ListTodosRequest struct {
	Page      int     `form:"page"`
	PageSize  int     `form:"page_size"`
	Completed *bool   `form:"completed"`
	Priority  *string `form:"priority"`
	Keyword   *string `form:"keyword"`
	SortBy    *string `form:"sort_by"`
	Order     *string `form:"order"`
}

// ListTodosResponse represents the list result
type ListTodosResponse struct {
	Items    []model.Todo `json:"items"`
	Total    int64        `json:"total"`
	Page     int          `json:"page"`
	PageSize int          `json:"page_size"`
}

// TodoFilter is the repository filter type
type TodoFilter = repository.TodoFilter

// TodoRepository defines the interface the service needs from the repository
type TodoRepository interface {
	Create(todo *model.Todo) error
	GetByID(id uint) (*model.Todo, error)
	List(filter TodoFilter) ([]model.Todo, int64, error)
	Update(todo *model.Todo) error
	Delete(id uint) error
}

// TodoService handles business logic for todos
type TodoService struct {
	repo TodoRepository
}

// NewTodoService creates a new TodoService
func NewTodoService(repo TodoRepository) *TodoService {
	return &TodoService{repo: repo}
}

// Create validates and creates a new todo
func (s *TodoService) Create(req CreateTodoRequest) (*model.Todo, error) {
	// Set default priority
	priority := req.Priority
	if priority == "" {
		priority = "medium"
	}

	todo := &model.Todo{
		Title:       req.Title,
		Description: req.Description,
		Priority:    priority,
		DueDate:     req.DueDate,
	}

	if err := todo.Validate(); err != nil {
		return nil, err
	}

	if err := s.repo.Create(todo); err != nil {
		return nil, err
	}

	return todo, nil
}

// GetByID returns a todo by ID
func (s *TodoService) GetByID(id uint) (*model.Todo, error) {
	todo, err := s.repo.GetByID(id)
	if err != nil {
		return nil, err
	}
	if todo == nil {
		return nil, ErrTodoNotFound
	}
	return todo, nil
}

// List returns a paginated, filtered list of todos
func (s *TodoService) List(req ListTodosRequest) (*ListTodosResponse, error) {
	page := req.Page
	if page < 1 {
		page = 1
	}
	pageSize := req.PageSize
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	filter := TodoFilter{
		Page:      page,
		PageSize:  pageSize,
		Completed: req.Completed,
		Priority:  req.Priority,
		Keyword:   req.Keyword,
		SortBy:    req.SortBy,
		Order:     req.Order,
	}

	todos, total, err := s.repo.List(filter)
	if err != nil {
		return nil, err
	}

	if todos == nil {
		todos = []model.Todo{}
	}

	return &ListTodosResponse{
		Items:    todos,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	}, nil
}

// Update partially updates an existing todo
func (s *TodoService) Update(id uint, req UpdateTodoRequest) (*model.Todo, error) {
	todo, err := s.GetByID(id)
	if err != nil {
		return nil, err
	}

	// Apply updates
	if req.Title != nil {
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

	if err := todo.Validate(); err != nil {
		return nil, err
	}

	if err := s.repo.Update(todo); err != nil {
		return nil, err
	}

	return todo, nil
}

// Delete removes a todo by ID
func (s *TodoService) Delete(id uint) error {
	// Check existence first
	if _, err := s.GetByID(id); err != nil {
		return err
	}
	return s.repo.Delete(id)
}

// Complete marks a todo as completed
func (s *TodoService) Complete(id uint) (*model.Todo, error) {
	todo, err := s.GetByID(id)
	if err != nil {
		return nil, err
	}

	todo.Completed = true

	if err := s.repo.Update(todo); err != nil {
		return nil, err
	}

	return todo, nil
}

// Uncomplete marks a todo as not completed
func (s *TodoService) Uncomplete(id uint) (*model.Todo, error) {
	todo, err := s.GetByID(id)
	if err != nil {
		return nil, err
	}

	todo.Completed = false

	if err := s.repo.Update(todo); err != nil {
		return nil, err
	}

	return todo, nil
}
