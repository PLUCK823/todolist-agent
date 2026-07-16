package repository

import (
	"context"
	"errors"
	"testing"
	"time"

	"backend/internal/database"
	"backend/internal/model"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func setupAuthTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := database.InitDB(database.Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatalf("failed to initialize auth test database: %v", err)
	}
	return db
}

func TestAuthRepositoryNormalizesEmailAndFindsItCaseInsensitively(t *testing.T) {
	ctx := context.Background()
	repo := NewAuthRepository(setupAuthTestDB(t))
	user := &model.User{
		Email:        "  Person@Example.COM  ",
		DisplayName:  "Person",
		PasswordHash: "password-hash",
	}

	if err := repo.CreateUser(ctx, user); err != nil {
		t.Fatalf("CreateUser() failed: %v", err)
	}
	if _, err := uuid.Parse(user.ID); err != nil {
		t.Fatalf("expected generated random UUID, got %q: %v", user.ID, err)
	}
	if user.Email != "person@example.com" {
		t.Fatalf("expected normalized email, got %q", user.Email)
	}

	found, err := repo.FindUserByEmail(ctx, " PERSON@EXAMPLE.com ")
	if err != nil {
		t.Fatalf("FindUserByEmail() failed: %v", err)
	}
	if found.ID != user.ID {
		t.Fatalf("expected user %s, got %s", user.ID, found.ID)
	}

	duplicate := &model.User{
		Email:        "PERSON@example.com",
		DisplayName:  "Duplicate",
		PasswordHash: "password-hash",
	}
	if err := repo.CreateUser(ctx, duplicate); err == nil {
		t.Fatal("expected normalized duplicate email to be rejected")
	}
}

func TestAuthRepositoryReturnsRecordNotFoundUnchanged(t *testing.T) {
	ctx := context.Background()
	repo := NewAuthRepository(setupAuthTestDB(t))

	_, err := repo.FindUserByEmail(ctx, "missing@example.com")
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("expected gorm.ErrRecordNotFound, got %v", err)
	}

	_, err = repo.FindActiveSessionByID(ctx, uuid.NewString(), time.Now())
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("expected gorm.ErrRecordNotFound, got %v", err)
	}
}

func TestAuthRepositoryFindsActiveRefreshSessionAndRevokesIt(t *testing.T) {
	ctx := context.Background()
	repo := NewAuthRepository(setupAuthTestDB(t))
	user := &model.User{
		Email:        "session@example.com",
		DisplayName:  "Session User",
		PasswordHash: "password-hash",
	}
	if err := repo.CreateUser(ctx, user); err != nil {
		t.Fatalf("CreateUser() failed: %v", err)
	}

	session := &model.AuthSession{
		UserID:           user.ID,
		RefreshTokenHash: "0c6f0f2ef50cb495fb3de546f5fb9a517b44c52ab9ae19f9bf4c8df5e86dba6e",
		ExpiresAt:        time.Now().Add(time.Hour),
	}
	if err := repo.CreateSession(ctx, session); err != nil {
		t.Fatalf("CreateSession() failed: %v", err)
	}
	if _, err := uuid.Parse(session.ID); err != nil {
		t.Fatalf("expected generated random UUID, got %q: %v", session.ID, err)
	}

	found, err := repo.FindActiveSessionByID(ctx, session.ID, time.Now())
	if err != nil {
		t.Fatalf("FindActiveSessionByID() failed: %v", err)
	}
	if found.RefreshTokenHash != session.RefreshTokenHash {
		t.Fatalf("expected refresh hash %q, got %q", session.RefreshTokenHash, found.RefreshTokenHash)
	}

	revokedAt := time.Now().UTC()
	if err := repo.RevokeSession(ctx, session.ID, revokedAt); err != nil {
		t.Fatalf("RevokeSession() failed: %v", err)
	}
	_, err = repo.FindActiveSessionByID(ctx, session.ID, time.Now())
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("expected revoked session to be unavailable, got %v", err)
	}
}

func TestAuthRepositoryExcludesAndDeletesExpiredRefreshSessions(t *testing.T) {
	ctx := context.Background()
	repo := NewAuthRepository(setupAuthTestDB(t))
	user := &model.User{
		Email:        "expiry@example.com",
		DisplayName:  "Expiry User",
		PasswordHash: "password-hash",
	}
	if err := repo.CreateUser(ctx, user); err != nil {
		t.Fatalf("CreateUser() failed: %v", err)
	}

	now := time.Now().UTC()
	expired := &model.AuthSession{
		UserID:           user.ID,
		RefreshTokenHash: "1c6f0f2ef50cb495fb3de546f5fb9a517b44c52ab9ae19f9bf4c8df5e86dba6e",
		ExpiresAt:        now.Add(-time.Minute),
	}
	active := &model.AuthSession{
		UserID:           user.ID,
		RefreshTokenHash: "2c6f0f2ef50cb495fb3de546f5fb9a517b44c52ab9ae19f9bf4c8df5e86dba6e",
		ExpiresAt:        now.Add(time.Hour),
	}
	for _, session := range []*model.AuthSession{expired, active} {
		if err := repo.CreateSession(ctx, session); err != nil {
			t.Fatalf("CreateSession() failed: %v", err)
		}
	}

	_, err := repo.FindActiveSessionByID(ctx, expired.ID, now)
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("expected expired session to be unavailable, got %v", err)
	}

	deleted, err := repo.DeleteExpiredSessions(ctx, now)
	if err != nil {
		t.Fatalf("DeleteExpiredSessions() failed: %v", err)
	}
	if deleted != 1 {
		t.Fatalf("expected one expired session deleted, got %d", deleted)
	}
	if _, err := repo.FindActiveSessionByID(ctx, active.ID, now); err != nil {
		t.Fatalf("expected active session to remain: %v", err)
	}
}
