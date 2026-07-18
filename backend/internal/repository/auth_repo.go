package repository

import (
	"context"
	"strings"
	"time"

	"backend/internal/model"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type AuthRepository struct {
	db *gorm.DB
}

func NewAuthRepository(db *gorm.DB) *AuthRepository {
	return &AuthRepository{db: db}
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func (r *AuthRepository) CreateUser(ctx context.Context, user *model.User) error {
	if user.ID == "" {
		user.ID = uuid.NewString()
	}
	user.Email = normalizeEmail(user.Email)
	return r.db.WithContext(ctx).Create(user).Error
}

func (r *AuthRepository) FindUserByEmail(ctx context.Context, email string) (*model.User, error) {
	var user model.User
	err := r.db.WithContext(ctx).
		Where("email = ?", normalizeEmail(email)).
		First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *AuthRepository) FindUserByID(ctx context.Context, id string) (*model.User, error) {
	var user model.User
	if err := r.db.WithContext(ctx).First(&user, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *AuthRepository) UpdateUserProfile(
	ctx context.Context,
	id string,
	patch model.ProfilePatch,
) error {
	updates := patch.Updates()
	if len(updates) == 0 {
		return nil
	}
	if email, ok := updates["email"].(string); ok {
		updates["email"] = normalizeEmail(email)
	}
	updates["updated_at"] = time.Now().UTC()
	result := r.db.WithContext(ctx).
		Model(&model.User{}).
		Where("id = ?", id).
		Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *AuthRepository) CountTodos(ctx context.Context) (int64, error) {
	var count int64
	if err := r.db.WithContext(ctx).Model(&model.Todo{}).Count(&count).Error; err != nil {
		return 0, err
	}
	return count, nil
}

func (r *AuthRepository) CountAgentSessions(ctx context.Context, ownerID string) (int64, error) {
	var count int64
	if err := r.db.WithContext(ctx).Table("agent_sessions").Where("owner_id = ?", ownerID).Count(&count).Error; err != nil {
		return 0, err
	}
	return count, nil
}

func (r *AuthRepository) CreateSession(ctx context.Context, session *model.AuthSession) error {
	prepareAuthSession(session, time.Now().UTC())
	return r.db.WithContext(ctx).Create(session).Error
}

func prepareAuthSession(session *model.AuthSession, now time.Time) {
	if session.ID == "" {
		session.ID = uuid.NewString()
	}
	if session.LastUsedAt.IsZero() {
		session.LastUsedAt = now
	}
}

// FindActiveSessionByID returns only a non-revoked, unexpired refresh session.
// GORM's ErrRecordNotFound is intentionally returned unchanged.
func (r *AuthRepository) FindActiveSessionByID(
	ctx context.Context,
	id string,
	now time.Time,
) (*model.AuthSession, error) {
	var session model.AuthSession
	err := r.db.WithContext(ctx).
		Where("id = ? AND revoked_at IS NULL AND expires_at > ?", id, now).
		First(&session).Error
	if err != nil {
		return nil, err
	}
	return &session, nil
}

func (r *AuthRepository) RevokeSession(ctx context.Context, id string, revokedAt time.Time) error {
	result := r.db.WithContext(ctx).
		Model(&model.AuthSession{}).
		Where("id = ? AND revoked_at IS NULL", id).
		Update("revoked_at", revokedAt)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// RotateSession atomically consumes one active refresh session and creates its
// replacement. A failed replacement insert rolls back the old-session revoke.
// Concurrent consumers cannot both pass the guarded update.
func (r *AuthRepository) RotateSession(
	ctx context.Context,
	currentSessionID string,
	now time.Time,
	replacement *model.AuthSession,
) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.AuthSession{}).
			Where("id = ? AND revoked_at IS NULL AND expires_at > ?", currentSessionID, now).
			Updates(map[string]any{
				"revoked_at":   now,
				"last_used_at": now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}

		prepareAuthSession(replacement, now)
		return tx.Create(replacement).Error
	})
}

func (r *AuthRepository) DeleteExpiredSessions(ctx context.Context, now time.Time) (int64, error) {
	result := r.db.WithContext(ctx).
		Where("expires_at <= ?", now).
		Delete(&model.AuthSession{})
	return result.RowsAffected, result.Error
}
