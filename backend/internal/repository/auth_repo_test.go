package repository

import (
	"context"
	"errors"
	"sync"
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

func TestAuthRepositoryCountAgentSessionsPropagatesMissingTable(t *testing.T) {
	repo := NewAuthRepository(setupAuthTestDB(t))
	if _, err := repo.CountAgentSessions(context.Background(), uuid.NewString()); err == nil {
		t.Fatal("CountAgentSessions() hid the missing agent_sessions table")
	}
}

func TestAuthRepositoryProfilePatchOnlyMutatesRequestedFields(t *testing.T) {
	ctx := context.Background()
	repo := NewAuthRepository(setupAuthTestDB(t))
	user := &model.User{Email: "patch@example.com", DisplayName: "Before", Timezone: "Asia/Shanghai", PasswordHash: "password-hash"}
	if err := repo.CreateUser(ctx, user); err != nil {
		t.Fatalf("CreateUser() failed: %v", err)
	}
	name := "After"
	if err := repo.UpdateUserProfile(ctx, user.ID, model.ProfilePatch{DisplayName: &name}); err != nil {
		t.Fatalf("UpdateUserProfile() failed: %v", err)
	}
	updated, err := repo.FindUserByID(ctx, user.ID)
	if err != nil {
		t.Fatalf("FindUserByID() failed: %v", err)
	}
	if updated.DisplayName != "After" || updated.Email != "patch@example.com" || updated.Timezone != "Asia/Shanghai" {
		t.Fatalf("partial profile patch overwrote unrelated fields: %#v", updated)
	}
}

func TestAuthRepositoryConcurrentDisjointProfilePatchesPreserveBothFields(t *testing.T) {
	ctx := context.Background()
	db := setupAuthTestDB(t)
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("db.DB() failed: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	repo := NewAuthRepository(db)
	user := &model.User{Email: "concurrent-patch@example.com", DisplayName: "Before", Timezone: "Asia/Shanghai", PasswordHash: "password-hash"}
	if err := repo.CreateUser(ctx, user); err != nil {
		t.Fatalf("CreateUser() failed: %v", err)
	}
	name, timezone := "After", "Europe/Paris"
	patches := []model.ProfilePatch{{DisplayName: &name}, {Timezone: &timezone}}
	errs := make(chan error, len(patches))
	start := make(chan struct{})
	for _, patch := range patches {
		patch := patch
		go func() {
			<-start
			errs <- repo.UpdateUserProfile(ctx, user.ID, patch)
		}()
	}
	close(start)
	for range patches {
		if err := <-errs; err != nil {
			t.Fatalf("UpdateUserProfile() failed: %v", err)
		}
	}
	updated, err := repo.FindUserByID(ctx, user.ID)
	if err != nil {
		t.Fatalf("FindUserByID() failed: %v", err)
	}
	if updated.DisplayName != name || updated.Timezone != timezone {
		t.Fatalf("concurrent disjoint patches lost data: %#v", updated)
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

func TestAuthRepositoryRotatesRefreshSessionAtomically(t *testing.T) {
	ctx := context.Background()
	db := setupAuthTestDB(t)
	repo := NewAuthRepository(db)
	user := &model.User{
		Email:        "rotate@example.com",
		DisplayName:  "Rotate User",
		PasswordHash: "password-hash",
	}
	if err := repo.CreateUser(ctx, user); err != nil {
		t.Fatalf("CreateUser() failed: %v", err)
	}

	now := time.Now().UTC().Truncate(time.Millisecond)
	oldLastUsed := now.Add(-time.Hour)
	oldSession := &model.AuthSession{
		UserID:           user.ID,
		RefreshTokenHash: "3c6f0f2ef50cb495fb3de546f5fb9a517b44c52ab9ae19f9bf4c8df5e86dba6e",
		ExpiresAt:        now.Add(time.Hour),
		LastUsedAt:       oldLastUsed,
	}
	if err := repo.CreateSession(ctx, oldSession); err != nil {
		t.Fatalf("CreateSession() failed: %v", err)
	}
	replacement := &model.AuthSession{
		UserID:           user.ID,
		RefreshTokenHash: "4c6f0f2ef50cb495fb3de546f5fb9a517b44c52ab9ae19f9bf4c8df5e86dba6e",
		ExpiresAt:        now.Add(2 * time.Hour),
	}

	if err := repo.RotateSession(ctx, oldSession.ID, now, replacement); err != nil {
		t.Fatalf("RotateSession() failed: %v", err)
	}
	if _, err := uuid.Parse(replacement.ID); err != nil {
		t.Fatalf("expected replacement random UUID, got %q: %v", replacement.ID, err)
	}
	if !replacement.LastUsedAt.Equal(now) {
		t.Fatalf("expected replacement last_used_at %s, got %s", now, replacement.LastUsedAt)
	}
	if _, err := repo.FindActiveSessionByID(ctx, oldSession.ID, now); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("expected old session to be inactive, got %v", err)
	}
	if _, err := repo.FindActiveSessionByID(ctx, replacement.ID, now); err != nil {
		t.Fatalf("expected replacement session to be active: %v", err)
	}

	var persistedOld model.AuthSession
	if err := db.First(&persistedOld, "id = ?", oldSession.ID).Error; err != nil {
		t.Fatalf("failed to reload old session: %v", err)
	}
	if persistedOld.RevokedAt == nil || !persistedOld.RevokedAt.Equal(now) {
		t.Fatalf("expected old session revoked at %s, got %v", now, persistedOld.RevokedAt)
	}
	if !persistedOld.LastUsedAt.Equal(now) {
		t.Fatalf("expected old session last_used_at %s, got %s", now, persistedOld.LastUsedAt)
	}
}

func TestAuthRepositoryRotationRollsBackWhenReplacementInsertFails(t *testing.T) {
	ctx := context.Background()
	repo := NewAuthRepository(setupAuthTestDB(t))
	user := &model.User{
		Email:        "rollback@example.com",
		DisplayName:  "Rollback User",
		PasswordHash: "password-hash",
	}
	if err := repo.CreateUser(ctx, user); err != nil {
		t.Fatalf("CreateUser() failed: %v", err)
	}

	now := time.Now().UTC().Truncate(time.Millisecond)
	oldSession := &model.AuthSession{
		UserID:           user.ID,
		RefreshTokenHash: "5c6f0f2ef50cb495fb3de546f5fb9a517b44c52ab9ae19f9bf4c8df5e86dba6e",
		ExpiresAt:        now.Add(time.Hour),
	}
	if err := repo.CreateSession(ctx, oldSession); err != nil {
		t.Fatalf("CreateSession() failed: %v", err)
	}
	replacement := &model.AuthSession{
		UserID:           user.ID,
		RefreshTokenHash: oldSession.RefreshTokenHash,
		ExpiresAt:        now.Add(2 * time.Hour),
	}

	if err := repo.RotateSession(ctx, oldSession.ID, now, replacement); err == nil {
		t.Fatal("expected duplicate refresh hash to fail replacement insert")
	}
	if _, err := repo.FindActiveSessionByID(ctx, oldSession.ID, now); err != nil {
		t.Fatalf("expected failed rotation to leave old session active: %v", err)
	}
}

func TestAuthRepositoryConcurrentRotationAllowsExactlyOneSuccess(t *testing.T) {
	ctx := context.Background()
	db := setupAuthTestDB(t)
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("failed to get sql.DB: %v", err)
	}
	// A single connection keeps the in-memory SQLite database shared and makes
	// the two transactions wait on the same database rather than seeing two
	// unrelated :memory: databases.
	sqlDB.SetMaxOpenConns(1)
	repo := NewAuthRepository(db)
	user := &model.User{
		Email:        "concurrent@example.com",
		DisplayName:  "Concurrent User",
		PasswordHash: "password-hash",
	}
	if err := repo.CreateUser(ctx, user); err != nil {
		t.Fatalf("CreateUser() failed: %v", err)
	}

	now := time.Now().UTC().Truncate(time.Millisecond)
	oldSession := &model.AuthSession{
		UserID:           user.ID,
		RefreshTokenHash: "6c6f0f2ef50cb495fb3de546f5fb9a517b44c52ab9ae19f9bf4c8df5e86dba6e",
		ExpiresAt:        now.Add(time.Hour),
	}
	if err := repo.CreateSession(ctx, oldSession); err != nil {
		t.Fatalf("CreateSession() failed: %v", err)
	}
	replacements := []*model.AuthSession{
		{UserID: user.ID, RefreshTokenHash: "7c6f0f2ef50cb495fb3de546f5fb9a517b44c52ab9ae19f9bf4c8df5e86dba6e", ExpiresAt: now.Add(2 * time.Hour)},
		{UserID: user.ID, RefreshTokenHash: "8c6f0f2ef50cb495fb3de546f5fb9a517b44c52ab9ae19f9bf4c8df5e86dba6e", ExpiresAt: now.Add(2 * time.Hour)},
	}

	start := make(chan struct{})
	errorsByCall := make(chan error, len(replacements))
	var ready sync.WaitGroup
	ready.Add(len(replacements))
	for _, replacement := range replacements {
		replacement := replacement
		go func() {
			ready.Done()
			<-start
			errorsByCall <- repo.RotateSession(ctx, oldSession.ID, now, replacement)
		}()
	}
	ready.Wait()
	close(start)

	var successes, notFound int
	for range replacements {
		err := <-errorsByCall
		switch {
		case err == nil:
			successes++
		case errors.Is(err, gorm.ErrRecordNotFound):
			notFound++
		default:
			t.Fatalf("unexpected rotation error: %v", err)
		}
	}
	if successes != 1 || notFound != 1 {
		t.Fatalf("expected one success and one not found, got success=%d not_found=%d", successes, notFound)
	}

	var sessionCount int64
	if err := db.Model(&model.AuthSession{}).Count(&sessionCount).Error; err != nil {
		t.Fatalf("failed to count sessions: %v", err)
	}
	if sessionCount != 2 {
		t.Fatalf("expected old session plus one replacement, got %d rows", sessionCount)
	}
}
