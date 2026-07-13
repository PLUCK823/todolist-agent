package repository

import (
	"fmt"
	"strings"
	"time"

	"backend/internal/model"

	"gorm.io/gorm"
)

type TodoFilter struct {
	Page      int     `form:"page"`
	PageSize  int     `form:"page_size"`
	Completed *bool   `form:"completed"`
	Priority  *string `form:"priority"`
	Keyword   *string `form:"keyword"`
	SortBy    *string `form:"sort_by"`
	Order     *string `form:"order"`
	DueFrom   *time.Time
	DueTo     *time.Time
}

type TodoRepository struct {
	db *gorm.DB
}

func NewTodoRepository(db *gorm.DB) *TodoRepository {
	return &TodoRepository{db: db}
}

func (r *TodoRepository) Create(todo *model.Todo) error {
	result := r.db.Create(todo)
	return result.Error
}

func (r *TodoRepository) GetByID(id uint) (*model.Todo, error) {
	var todo model.Todo
	result := r.db.First(&todo, id)
	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, result.Error
	}
	return &todo, nil
}

func (r *TodoRepository) List(filter TodoFilter) ([]model.Todo, int64, error) {
	var todos []model.Todo
	var total int64

	query := r.db.Model(&model.Todo{})

	// Apply filters
	if filter.Completed != nil {
		query = query.Where("completed = ?", *filter.Completed)
	}
	if filter.Priority != nil && *filter.Priority != "" {
		query = query.Where("priority = ?", *filter.Priority)
	}
	if filter.Keyword != nil && *filter.Keyword != "" {
		keyword := strings.ToLower(strings.TrimSpace(*filter.Keyword))
		if keyword != "" {
			escaped := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(keyword)
			query = query.Where(`LOWER(title) LIKE ? ESCAPE '\'`, "%"+escaped+"%")
		}
	}
	if filter.DueFrom != nil {
		query = query.Where("due_date IS NOT NULL AND due_date >= ?", *filter.DueFrom)
	}
	if filter.DueTo != nil {
		query = query.Where("due_date IS NOT NULL AND due_date < ?", *filter.DueTo)
	}

	// Count total
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// Apply sorting
	sortBy := "created_at"
	if filter.SortBy != nil && *filter.SortBy != "" {
		sortBy = *filter.SortBy
	}
	// Validate sortBy to prevent SQL injection
	allowedSorts := map[string]bool{
		"created_at": true,
		"updated_at": true,
		"priority":   true,
		"due_date":   true,
		"title":      true,
	}
	if !allowedSorts[sortBy] {
		sortBy = "created_at"
	}

	order := "desc"
	if filter.Order != nil && *filter.Order == "asc" {
		order = "asc"
	}

	if sortBy == "due_date" {
		query = query.Order(fmt.Sprintf("due_date %s, id %s", order, order))
	} else {
		query = query.Order(fmt.Sprintf("%s %s", sortBy, order))
	}

	// Apply pagination
	page := filter.Page
	if page < 1 {
		page = 1
	}
	pageSize := filter.PageSize
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	offset := (page - 1) * pageSize
	query = query.Offset(offset).Limit(pageSize)

	if err := query.Find(&todos).Error; err != nil {
		return nil, 0, err
	}

	return todos, total, nil
}

func (r *TodoRepository) Update(todo *model.Todo) error {
	result := r.db.Save(todo)
	return result.Error
}

func (r *TodoRepository) Delete(id uint) error {
	result := r.db.Delete(&model.Todo{}, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
