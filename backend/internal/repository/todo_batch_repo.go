package repository

import (
	"sort"

	"backend/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (r *TodoRepository) CreateBatch(todos []*model.Todo) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		return tx.Create(&todos).Error
	})
}

func reorderTodos(ids []uint, rows []model.Todo) ([]model.Todo, error) {
	if len(rows) != len(ids) {
		return nil, gorm.ErrRecordNotFound
	}
	byID := make(map[uint]model.Todo, len(rows))
	for _, row := range rows {
		byID[row.ID] = row
	}
	result := make([]model.Todo, len(ids))
	for index, id := range ids {
		row, exists := byID[id]
		if !exists {
			return nil, gorm.ErrRecordNotFound
		}
		result[index] = row
	}
	return result, nil
}

func (r *TodoRepository) GetByIDs(ids []uint) ([]model.Todo, error) {
	var rows []model.Todo
	if err := r.db.Where("id IN ?", ids).Find(&rows).Error; err != nil {
		return nil, err
	}
	return reorderTodos(ids, rows)
}

func sortedIDs(ids []uint) []uint {
	ordered := append([]uint(nil), ids...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	return ordered
}

func loadBatchForUpdate(tx *gorm.DB, ids []uint) (map[uint]*model.Todo, error) {
	var rows []model.Todo
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id IN ?", sortedIDs(ids)).Order("id ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) != len(ids) {
		return nil, gorm.ErrRecordNotFound
	}
	byID := make(map[uint]*model.Todo, len(rows))
	for index := range rows {
		byID[rows[index].ID] = &rows[index]
	}
	return byID, nil
}

func saveBatch(tx *gorm.DB, ids []uint, items map[uint]*model.Todo) ([]model.Todo, error) {
	for _, id := range sortedIDs(ids) {
		if err := tx.Save(items[id]).Error; err != nil {
			return nil, err
		}
	}
	rows := make([]model.Todo, len(ids))
	for index, id := range ids {
		rows[index] = *items[id]
	}
	return rows, nil
}

func (r *TodoRepository) UpdateBatch(ids []uint, mutate func(map[uint]*model.Todo) error) ([]model.Todo, error) {
	var result []model.Todo
	err := r.db.Transaction(func(tx *gorm.DB) error {
		items, err := loadBatchForUpdate(tx, ids)
		if err != nil {
			return err
		}
		if err := mutate(items); err != nil {
			return err
		}
		result, err = saveBatch(tx, ids, items)
		return err
	})
	return result, err
}

func (r *TodoRepository) SetCompletedBatch(ids []uint, completed bool) ([]model.Todo, error) {
	return r.UpdateBatch(ids, func(items map[uint]*model.Todo) error {
		for _, todo := range items {
			todo.Completed = completed
		}
		return nil
	})
}

func (r *TodoRepository) DeleteBatch(ids []uint) ([]model.Todo, error) {
	var result []model.Todo
	err := r.db.Transaction(func(tx *gorm.DB) error {
		items, err := loadBatchForUpdate(tx, ids)
		if err != nil {
			return err
		}
		result = make([]model.Todo, len(ids))
		for index, id := range ids {
			result[index] = *items[id]
		}
		deleteResult := tx.Delete(&model.Todo{}, sortedIDs(ids))
		if deleteResult.Error != nil {
			return deleteResult.Error
		}
		if deleteResult.RowsAffected != int64(len(ids)) {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
	return result, err
}
