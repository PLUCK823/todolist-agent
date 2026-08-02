package database

import (
	"path/filepath"
	"testing"

	"backend/internal/model"
)

func TestInitDB_SQLite(t *testing.T) {
	db, err := InitDB(Config{
		Driver: "sqlite",
		DSN:    ":memory:",
	})
	if err != nil {
		t.Fatalf("InitDB() failed: %v", err)
	}
	if db == nil {
		t.Fatal("expected non-nil DB")
	}

	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("failed to get sql.DB: %v", err)
	}
	if err := sqlDB.Ping(); err != nil {
		t.Fatalf("failed to ping DB: %v", err)
	}
	sqlDB.Close()
}

func TestInitDB_CreatesDueDateIDCompositeIndex(t *testing.T) {
	db, err := InitDB(Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatal(err)
	}
	var columns []struct {
		SeqNo int    `gorm:"column:seqno"`
		Name  string `gorm:"column:name"`
	}
	if err := db.Raw("PRAGMA index_info('idx_todos_due_date_id')").Scan(&columns).Error; err != nil {
		t.Fatal(err)
	}
	if len(columns) != 2 || columns[0].Name != "due_date" || columns[1].Name != "id" {
		t.Fatalf("expected due_date,id composite index, got %#v", columns)
	}
	var tableColumns []struct {
		Name string `gorm:"column:name"`
		PK   int    `gorm:"column:pk"`
	}
	if err := db.Raw("PRAGMA table_info('todos')").Scan(&tableColumns).Error; err != nil {
		t.Fatal(err)
	}
	for _, column := range tableColumns {
		if column.Name == "id" && column.PK == 1 {
			return
		}
	}
	t.Fatal("expected id to remain the primary key")
}

func TestInitDBMigratesAuthModels(t *testing.T) {
	db, err := InitDB(Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatalf("InitDB() failed: %v", err)
	}

	for _, table := range []string{"users", "auth_sessions"} {
		if !db.Migrator().HasTable(table) {
			t.Errorf("expected %s table to exist", table)
		}
	}
}

func TestInitDBBackfillsLegacyTodosWhenThereIsExactlyOneOwner(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "legacy.db")
	db, err := InitDB(Config{Driver: "sqlite", DSN: dsn})
	if err != nil {
		t.Fatal(err)
	}
	user := model.User{ID: "11111111-1111-1111-1111-111111111111", Email: "owner@example.com", DisplayName: "Owner", Timezone: "UTC", PasswordHash: "hash"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	legacy := model.Todo{Title: "legacy", Priority: "medium"}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("UPDATE todos SET owner_id = NULL WHERE id = ?", legacy.ID).Error; err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	_ = sqlDB.Close()

	reopened, err := InitDB(Config{Driver: "sqlite", DSN: dsn})
	if err != nil {
		t.Fatal(err)
	}
	var migrated model.Todo
	if err := reopened.First(&migrated, legacy.ID).Error; err != nil {
		t.Fatal(err)
	}
	if migrated.OwnerID != user.ID {
		t.Fatalf("expected legacy todo owner %q, got %q", user.ID, migrated.OwnerID)
	}
}

func TestInitDB_UnsupportedDriver(t *testing.T) {
	_, err := InitDB(Config{
		Driver: "mysql",
		DSN:    "root:@/test",
	})
	if err == nil {
		t.Fatal("expected error for unsupported driver")
	}
}
