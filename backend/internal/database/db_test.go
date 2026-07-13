package database

import (
	"testing"
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

func TestInitDB_UnsupportedDriver(t *testing.T) {
	_, err := InitDB(Config{
		Driver: "mysql",
		DSN:    "root:@/test",
	})
	if err == nil {
		t.Fatal("expected error for unsupported driver")
	}
}
