package model

import (
	"errors"
	"time"
)

var (
	ErrEmptyTitle      = errors.New("待办标题不能为空")
	ErrTitleTooLong    = errors.New("待办标题不能超过200字符")
	ErrInvalidPriority = errors.New("优先级无效，必须为: high / medium / low")
)

type Todo struct {
	ID          uint       `json:"id" gorm:"primaryKey;index:idx_todos_due_date_id,priority:2"`
	Title       string     `json:"title" gorm:"type:varchar(200);not null"`
	Description string     `json:"description" gorm:"type:text;default:''"`
	Priority    string     `json:"priority" gorm:"type:varchar(10);not null;default:medium"`
	Completed   bool       `json:"completed" gorm:"not null;default:false"`
	DueDate     *time.Time `json:"due_date" gorm:"index:idx_todos_due_date_id,priority:1"`
	CreatedAt   time.Time  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   time.Time  `json:"updated_at" gorm:"autoUpdateTime"`
}

func (t *Todo) Validate() error {
	if t.Title == "" {
		return ErrEmptyTitle
	}
	if len([]rune(t.Title)) > 200 {
		return ErrTitleTooLong
	}
	if t.Priority == "" {
		t.Priority = "medium"
	}
	if t.Priority != "high" && t.Priority != "medium" && t.Priority != "low" {
		return ErrInvalidPriority
	}
	return nil
}
