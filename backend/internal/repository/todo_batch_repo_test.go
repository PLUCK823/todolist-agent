package repository

import (
	"errors"
	"fmt"
	"testing"

	"backend/internal/model"
	"gorm.io/gorm"
)

func TestBatchCreateAndGetPreserveRequestOrder(t *testing.T) {
	repo := NewTodoRepository(setupTestDB(t))
	items := make([]*model.Todo, 100)
	for i := range items {
		items[i] = &model.Todo{Title: fmt.Sprintf("todo-%d", i), Priority: "medium"}
	}
	if err := repo.CreateBatch(items); err != nil {
		t.Fatal(err)
	}
	ordered, err := repo.GetByIDs([]uint{items[99].ID, items[0].ID, items[49].ID})
	if err != nil {
		t.Fatal(err)
	}
	if ordered[0].Title != "todo-99" || ordered[1].Title != "todo-0" || ordered[2].Title != "todo-49" {
		t.Fatalf("request order lost: %#v", ordered)
	}
}

func TestBatchUpdateCallbackFailureRollsBackEveryRow(t *testing.T) {
	repo := NewTodoRepository(setupTestDB(t))
	one := createTestTodo(t, repo, "one", "low")
	two := createTestTodo(t, repo, "two", "low")
	sentinel := errors.New("stop")
	_, err := repo.UpdateBatch([]uint{two.ID, one.ID}, func(items map[uint]*model.Todo) error {
		items[one.ID].Title = "changed"
		items[two.ID].Priority = "high"
		return sentinel
	})
	if !errors.Is(err, sentinel) {
		t.Fatalf("expected callback error, got %v", err)
	}
	afterOne, _ := repo.GetByID(one.ID)
	afterTwo, _ := repo.GetByID(two.ID)
	if afterOne.Title != "one" || afterTwo.Priority != "low" {
		t.Fatalf("transaction leaked: %#v %#v", afterOne, afterTwo)
	}
}

func TestBatchWriteWithMissingTargetDoesNotMutate(t *testing.T) {
	repo := NewTodoRepository(setupTestDB(t))
	one := createTestTodo(t, repo, "one", "low")
	if _, err := repo.SetCompletedBatch([]uint{one.ID, 9999}, true); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("expected record not found, got %v", err)
	}
	after, _ := repo.GetByID(one.ID)
	if after.Completed {
		t.Fatal("existing row changed despite missing target")
	}
}

func TestBatchDeleteReturnsSnapshotsInRequestOrderAndIsAtomic(t *testing.T) {
	repo := NewTodoRepository(setupTestDB(t))
	one := createTestTodo(t, repo, "one", "low")
	two := createTestTodo(t, repo, "two", "high")
	deleted, err := repo.DeleteBatch([]uint{two.ID, one.ID})
	if err != nil {
		t.Fatal(err)
	}
	if deleted[0].ID != two.ID || deleted[1].ID != one.ID {
		t.Fatalf("delete order lost: %#v", deleted)
	}
	if found, _ := repo.GetByID(one.ID); found != nil {
		t.Fatal("row was not deleted")
	}

	three := createTestTodo(t, repo, "three", "low")
	if _, err := repo.DeleteBatch([]uint{three.ID, 9999}); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("expected record not found, got %v", err)
	}
	if found, _ := repo.GetByID(three.ID); found == nil {
		t.Fatal("partial delete occurred")
	}
}
