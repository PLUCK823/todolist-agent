package service

import (
	"errors"
	"fmt"

	"backend/internal/model"
)

const maxBatchSize = 100

var ErrInvalidBatch = errors.New("批量请求无效")

type BatchItemError struct {
	Index   int    `json:"index"`
	ID      uint   `json:"id,omitempty"`
	Field   string `json:"field"`
	Message string `json:"message"`
	Cause   error  `json:"-"`
}

func (e *BatchItemError) Error() string {
	return fmt.Sprintf("batch item %d (%s): %s", e.Index, e.Field, e.Message)
}

func (e *BatchItemError) Unwrap() error { return e.Cause }

type BatchIDsRequest struct {
	IDs []uint `json:"ids" binding:"required"`
}

type BatchCreateRequest struct {
	Items []CreateTodoRequest `json:"items" binding:"required"`
}

type BatchUpdateItem struct {
	ID uint `json:"id"`
	UpdateTodoRequest
}

type BatchUpdateRequest struct {
	Items []BatchUpdateItem `json:"items" binding:"required"`
}

type BatchStatusRequest struct {
	IDs       []uint `json:"ids" binding:"required"`
	Completed bool   `json:"completed"`
}

type BatchTodosResponse struct {
	Items []model.Todo `json:"items"`
	Count int          `json:"count"`
}

type TodoBatchRepository interface {
	CreateBatch(todos []*model.Todo) error
	GetByIDs(ids []uint) ([]model.Todo, error)
	UpdateBatch(ids []uint, mutate func(map[uint]*model.Todo) error) ([]model.Todo, error)
	SetCompletedBatch(ids []uint, completed bool) ([]model.Todo, error)
	DeleteBatch(ids []uint) ([]model.Todo, error)
}

func validateBatchCount(count int) error {
	if count < 1 || count > maxBatchSize {
		return ErrInvalidBatch
	}
	return nil
}

func validateBatchIDs(ids []uint) error {
	if err := validateBatchCount(len(ids)); err != nil {
		return err
	}
	seen := make(map[uint]struct{}, len(ids))
	for _, id := range ids {
		if id == 0 {
			return ErrInvalidBatch
		}
		if _, exists := seen[id]; exists {
			return ErrInvalidBatch
		}
		seen[id] = struct{}{}
	}
	return nil
}

func batchField(err error) string {
	switch {
	case errors.Is(err, model.ErrEmptyTitle), errors.Is(err, model.ErrTitleTooLong):
		return "title"
	case errors.Is(err, model.ErrInvalidPriority):
		return "priority"
	default:
		return "item"
	}
}

func itemError(index int, id uint, err error) error {
	return &BatchItemError{Index: index, ID: id, Field: batchField(err), Message: err.Error(), Cause: err}
}

func response(items []model.Todo) *BatchTodosResponse {
	if items == nil {
		items = []model.Todo{}
	}
	return &BatchTodosResponse{Items: items, Count: len(items)}
}

func (s *TodoService) requireBatchRepo() (TodoBatchRepository, error) {
	if s.batchRepo == nil {
		return nil, errors.New("batch repository unavailable")
	}
	return s.batchRepo, nil
}

func (s *TodoService) BatchCreate(req BatchCreateRequest) (*BatchTodosResponse, error) {
	if err := validateBatchCount(len(req.Items)); err != nil {
		return nil, err
	}
	todos := make([]*model.Todo, len(req.Items))
	for index, request := range req.Items {
		priority := request.Priority
		if priority == "" {
			priority = "medium"
		}
		todo := &model.Todo{Title: request.Title, Description: request.Description, Priority: priority, DueDate: request.DueDate}
		if err := todo.Validate(); err != nil {
			return nil, itemError(index, 0, err)
		}
		todos[index] = todo
	}
	repo, err := s.requireBatchRepo()
	if err != nil {
		return nil, err
	}
	if err := repo.CreateBatch(todos); err != nil {
		return nil, err
	}
	items := make([]model.Todo, len(todos))
	for i, todo := range todos {
		items[i] = *todo
	}
	return response(items), nil
}

func (s *TodoService) BatchGet(req BatchIDsRequest) (*BatchTodosResponse, error) {
	if err := validateBatchIDs(req.IDs); err != nil {
		return nil, err
	}
	repo, err := s.requireBatchRepo()
	if err != nil {
		return nil, err
	}
	items, err := repo.GetByIDs(req.IDs)
	if err != nil {
		return nil, err
	}
	if len(items) != len(req.IDs) {
		return nil, ErrTodoNotFound
	}
	return response(items), nil
}

func applyTodoUpdate(todo *model.Todo, req UpdateTodoRequest) {
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
	if req.DueDate.Set {
		todo.DueDate = req.DueDate.Value
	}
}

func (s *TodoService) BatchUpdate(req BatchUpdateRequest) (*BatchTodosResponse, error) {
	if err := validateBatchCount(len(req.Items)); err != nil {
		return nil, err
	}
	ids := make([]uint, len(req.Items))
	for i, item := range req.Items {
		ids[i] = item.ID
	}
	if err := validateBatchIDs(ids); err != nil {
		return nil, err
	}
	repo, err := s.requireBatchRepo()
	if err != nil {
		return nil, err
	}
	items, err := repo.UpdateBatch(ids, func(todos map[uint]*model.Todo) error {
		for index, item := range req.Items {
			todo := todos[item.ID]
			if todo == nil {
				return ErrTodoNotFound
			}
			applyTodoUpdate(todo, item.UpdateTodoRequest)
			if err := todo.Validate(); err != nil {
				return itemError(index, item.ID, err)
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if len(items) != len(ids) {
		return nil, ErrTodoNotFound
	}
	return response(items), nil
}

func (s *TodoService) BatchSetStatus(req BatchStatusRequest) (*BatchTodosResponse, error) {
	if err := validateBatchIDs(req.IDs); err != nil {
		return nil, err
	}
	repo, err := s.requireBatchRepo()
	if err != nil {
		return nil, err
	}
	items, err := repo.SetCompletedBatch(req.IDs, req.Completed)
	if err != nil {
		return nil, err
	}
	if len(items) != len(req.IDs) {
		return nil, ErrTodoNotFound
	}
	return response(items), nil
}

func (s *TodoService) BatchDelete(req BatchIDsRequest) (*BatchTodosResponse, error) {
	if err := validateBatchIDs(req.IDs); err != nil {
		return nil, err
	}
	repo, err := s.requireBatchRepo()
	if err != nil {
		return nil, err
	}
	items, err := repo.DeleteBatch(req.IDs)
	if err != nil {
		return nil, err
	}
	if len(items) != len(req.IDs) {
		return nil, ErrTodoNotFound
	}
	return response(items), nil
}
