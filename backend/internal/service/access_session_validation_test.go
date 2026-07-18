package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"backend/internal/model"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

const accessValidationTestJWTSecret = "access-validation-test-secret-at-least-32-bytes"

type accessSessionRepository struct {
	session *model.AuthSession
	err     error
}

func (r accessSessionRepository) CreateUser(context.Context, *model.User) error { return nil }
func (r accessSessionRepository) FindUserByEmail(context.Context, string) (*model.User, error) {
	return nil, gorm.ErrRecordNotFound
}
func (r accessSessionRepository) FindUserByID(context.Context, string) (*model.User, error) {
	return nil, gorm.ErrRecordNotFound
}
func (r accessSessionRepository) UpdateUserProfile(context.Context, string, model.ProfilePatch) error {
	return nil
}
func (r accessSessionRepository) CountTodos(context.Context) (int64, error) { return 0, nil }
func (r accessSessionRepository) CountAgentSessions(context.Context, string) (int64, error) {
	return 0, nil
}
func (r accessSessionRepository) CreateSession(context.Context, *model.AuthSession) error { return nil }
func (r accessSessionRepository) FindActiveSessionByID(context.Context, string, time.Time) (*model.AuthSession, error) {
	return r.session, r.err
}
func (r accessSessionRepository) RotateSession(context.Context, string, time.Time, *model.AuthSession) error {
	return nil
}
func (r accessSessionRepository) RevokeSession(context.Context, string, time.Time) error { return nil }

func TestValidateAccessRequiresAnActiveSessionOwnedByTokenSubject(t *testing.T) {
	now := time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC)
	userID, sessionID := uuid.NewString(), uuid.NewString()
	base := &AuthService{jwtSecret: []byte(accessValidationTestJWTSecret), issuer: defaultIssuer, accessTTL: time.Hour, now: func() time.Time { return now }}
	token, _, err := base.signAccess(userID, sessionID, now)
	if err != nil {
		t.Fatalf("signAccess() failed: %v", err)
	}
	for name, repo := range map[string]accessSessionRepository{
		"revoked session":        {err: gorm.ErrRecordNotFound},
		"expired session":        {err: gorm.ErrRecordNotFound},
		"session owner mismatch": {session: &model.AuthSession{ID: sessionID, UserID: uuid.NewString()}},
	} {
		t.Run(name, func(t *testing.T) {
			svc := *base
			svc.repo = repo
			if _, err := svc.ValidateAccess(context.Background(), token); !errors.Is(err, ErrInvalidAccessToken) {
				t.Fatalf("ValidateAccess() error = %v, want ErrInvalidAccessToken", err)
			}
		})
	}
}

func TestValidateAccessReturnsTypedStoreErrorForSessionLookupFailure(t *testing.T) {
	now := time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC)
	userID, sessionID := uuid.NewString(), uuid.NewString()
	base := &AuthService{jwtSecret: []byte(accessValidationTestJWTSecret), issuer: defaultIssuer, accessTTL: time.Hour, now: func() time.Time { return now }}
	token, _, err := base.signAccess(userID, sessionID, now)
	if err != nil {
		t.Fatalf("signAccess() failed: %v", err)
	}
	svc := *base
	svc.repo = accessSessionRepository{err: errors.New("database unavailable")}
	if _, err := svc.ValidateAccess(context.Background(), token); !errors.Is(err, ErrAuthenticationStore) {
		t.Fatalf("ValidateAccess() error = %v, want ErrAuthenticationStore", err)
	}
}
