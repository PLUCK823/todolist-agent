package service

import (
	"errors"
	"testing"

	"backend/internal/model"
)

type batchRepoStub struct {
	created []*model.Todo
	todos   map[uint]*model.Todo
}

func newBatchRepoStub() *batchRepoStub {
	return &batchRepoStub{todos: map[uint]*model.Todo{}}
}

func (r *batchRepoStub) Create(todo *model.Todo) error                { return nil }
func (r *batchRepoStub) GetByID(id uint) (*model.Todo, error)         { return r.todos[id], nil }
func (r *batchRepoStub) List(TodoFilter) ([]model.Todo, int64, error) { return nil, 0, nil }
func (r *batchRepoStub) Update(todo *model.Todo) error                { return nil }
func (r *batchRepoStub) Delete(id uint) error                         { return nil }
func (r *batchRepoStub) CreateBatch(todos []*model.Todo) error {
	r.created = todos
	for i, todo := range todos {
		todo.ID = uint(i + 1)
		r.todos[todo.ID] = todo
	}
	return nil
}
func (r *batchRepoStub) GetByIDs(ids []uint) ([]model.Todo, error) {
	result := make([]model.Todo, 0, len(ids))
	for _, id := range ids {
		todo := r.todos[id]
		if todo == nil {
			return nil, nil
		}
		result = append(result, *todo)
	}
	return result, nil
}
func (r *batchRepoStub) UpdateBatch(ids []uint, mutate func(map[uint]*model.Todo) error) ([]model.Todo, error) {
	working := map[uint]*model.Todo{}
	for _, id := range ids {
		if r.todos[id] == nil {
			return nil, nil
		}
		copy := *r.todos[id]
		working[id] = &copy
	}
	if err := mutate(working); err != nil {
		return nil, err
	}
	result := make([]model.Todo, 0, len(ids))
	for _, id := range ids {
		r.todos[id] = working[id]
		result = append(result, *working[id])
	}
	return result, nil
}
func (r *batchRepoStub) SetCompletedBatch(ids []uint, completed bool) ([]model.Todo, error) {
	return r.UpdateBatch(ids, func(items map[uint]*model.Todo) error {
		for _, todo := range items {
			todo.Completed = completed
		}
		return nil
	})
}
func (r *batchRepoStub) DeleteBatch(ids []uint) ([]model.Todo, error) {
	items, err := r.GetByIDs(ids)
	if err != nil || len(items) != len(ids) {
		return nil, err
	}
	for _, id := range ids {
		delete(r.todos, id)
	}
	return items, nil
}

func TestBatchRejectsInvalidCardinalityAndDuplicateIDs(t *testing.T) {
	svc := NewTodoService(newBatchRepoStub())
	if _, err := svc.BatchCreate(BatchCreateRequest{}); !errors.Is(err, ErrInvalidBatch) {
		t.Fatalf("empty create: expected ErrInvalidBatch, got %v", err)
	}
	items := make([]CreateTodoRequest, 101)
	for i := range items {
		items[i].Title = "valid"
	}
	if _, err := svc.BatchCreate(BatchCreateRequest{Items: items}); !errors.Is(err, ErrInvalidBatch) {
		t.Fatalf("101 creates: expected ErrInvalidBatch, got %v", err)
	}
	if _, err := svc.BatchGet(BatchIDsRequest{IDs: []uint{1, 1}}); !errors.Is(err, ErrInvalidBatch) {
		t.Fatalf("duplicate ids: expected ErrInvalidBatch, got %v", err)
	}
	if _, err := svc.BatchGet(BatchIDsRequest{IDs: []uint{0}}); !errors.Is(err, ErrInvalidBatch) {
		t.Fatalf("zero id: expected ErrInvalidBatch, got %v", err)
	}
}

func TestBatchCreateReportsInvalidItemAndDoesNotWrite(t *testing.T) {
	repo := newBatchRepoStub()
	svc := NewTodoService(repo)
	_, err := svc.BatchCreate(BatchCreateRequest{Items: []CreateTodoRequest{{Title: "ok"}, {Title: ""}}})
	var itemErr *BatchItemError
	if !errors.As(err, &itemErr) || itemErr.Index != 1 || itemErr.Field != "title" {
		t.Fatalf("expected item 1 title error, got %#v", err)
	}
	if len(repo.created) != 0 {
		t.Fatalf("repository wrote %d items", len(repo.created))
	}
}

func TestBatchUpdateAppliesIndependentPatchesInRequestOrder(t *testing.T) {
	repo := newBatchRepoStub()
	repo.todos[2] = &model.Todo{ID: 2, Title: "two", Priority: "low"}
	repo.todos[1] = &model.Todo{ID: 1, Title: "one", Priority: "medium"}
	svc := NewTodoService(repo)
	title := "renamed"
	priority := "high"
	response, err := svc.BatchUpdate(BatchUpdateRequest{Items: []BatchUpdateItem{
		{ID: 2, UpdateTodoRequest: UpdateTodoRequest{Title: &title}},
		{ID: 1, UpdateTodoRequest: UpdateTodoRequest{Priority: &priority}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if response.Items[0].ID != 2 || response.Items[0].Title != "renamed" || response.Items[0].Priority != "low" {
		t.Fatalf("unexpected first result: %#v", response.Items[0])
	}
	if response.Items[1].ID != 1 || response.Items[1].Title != "one" || response.Items[1].Priority != "high" {
		t.Fatalf("unexpected second result: %#v", response.Items[1])
	}
}

func TestBatchUpdateValidationIsAtomic(t *testing.T) {
	repo := newBatchRepoStub()
	repo.todos[1] = &model.Todo{ID: 1, Title: "one", Priority: "low"}
	repo.todos[2] = &model.Todo{ID: 2, Title: "two", Priority: "low"}
	svc := NewTodoService(repo)
	valid := "changed"
	invalid := "invalid"
	_, err := svc.BatchUpdate(BatchUpdateRequest{Items: []BatchUpdateItem{
		{ID: 1, UpdateTodoRequest: UpdateTodoRequest{Title: &valid}},
		{ID: 2, UpdateTodoRequest: UpdateTodoRequest{Priority: &invalid}},
	}})
	var itemErr *BatchItemError
	if !errors.As(err, &itemErr) || itemErr.Index != 1 || itemErr.ID != 2 {
		t.Fatalf("unexpected error: %#v", err)
	}
	if repo.todos[1].Title != "one" {
		t.Fatalf("first item mutated despite rollback: %#v", repo.todos[1])
	}
}

func TestBatchGetMissingIDReturnsNotFound(t *testing.T) {
	repo := newBatchRepoStub()
	repo.todos[1] = &model.Todo{ID: 1, Title: "one", Priority: "medium"}
	svc := NewTodoService(repo)
	if _, err := svc.BatchGet(BatchIDsRequest{IDs: []uint{1, 2}}); !errors.Is(err, ErrTodoNotFound) {
		t.Fatalf("expected ErrTodoNotFound, got %v", err)
	}
}
