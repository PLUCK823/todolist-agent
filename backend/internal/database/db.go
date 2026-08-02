package database

import (
	"fmt"
	"log"

	"backend/internal/model"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type Config struct {
	Driver string // "postgres" or "sqlite"
	DSN    string // connection string
}

func InitDB(cfg Config) (*gorm.DB, error) {
	var dialector gorm.Dialector

	switch cfg.Driver {
	case "sqlite":
		dialector = sqlite.Open(cfg.DSN)
	case "postgres":
		dialector = postgres.Open(cfg.DSN)
	default:
		return nil, fmt.Errorf("unsupported database driver: %s", cfg.Driver)
	}

	db, err := gorm.Open(dialector, &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	if err := db.AutoMigrate(&model.Todo{}, &model.User{}, &model.AuthSession{}); err != nil {
		return nil, fmt.Errorf("failed to migrate database models Todo, User, AuthSession: %w", err)
	}
	if err := backfillLegacyTodoOwners(db); err != nil {
		return nil, err
	}

	log.Printf("Database connected with driver: %s", cfg.Driver)
	return db, nil
}

func backfillLegacyTodoOwners(db *gorm.DB) error {
	var legacyCount int64
	if err := db.Model(&model.Todo{}).Where("owner_id IS NULL").Count(&legacyCount).Error; err != nil {
		return fmt.Errorf("count legacy todos without an owner: %w", err)
	}
	if legacyCount == 0 {
		return nil
	}
	var ownerIDs []string
	if err := db.Model(&model.User{}).Order("created_at ASC").Order("id ASC").Limit(2).Pluck("id", &ownerIDs).Error; err != nil {
		return fmt.Errorf("find legacy todo owner: %w", err)
	}
	if len(ownerIDs) == 0 {
		return nil
	}
	if len(ownerIDs) > 1 {
		return fmt.Errorf("cannot safely assign %d legacy todos across multiple users", legacyCount)
	}
	if err := db.Model(&model.Todo{}).Where("owner_id IS NULL").Update("owner_id", ownerIDs[0]).Error; err != nil {
		return fmt.Errorf("backfill legacy todo owner: %w", err)
	}
	return nil
}
