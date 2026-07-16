package service_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"backend/internal/database"
	"backend/internal/repository"
	"backend/internal/service"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const testJWTSecret = "test-jwt-secret-that-is-at-least-32-bytes-long"

func newAuthService(t *testing.T, now time.Time) (*service.AuthService, *repository.AuthRepository) {
	t.Helper()
	db, err := database.InitDB(database.Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatalf("InitDB() failed: %v", err)
	}
	repo := repository.NewAuthRepository(db)
	svc, err := service.NewAuthService(repo, service.AuthConfig{
		JWTSecret:  []byte(testJWTSecret),
		AccessTTL:  15 * time.Minute,
		RefreshTTL: 24 * time.Hour,
		Now:        func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewAuthService() failed: %v", err)
	}
	return svc, repo
}

func TestPasswordRoundTripAndMalformedHash(t *testing.T) {
	password := "correct horse battery staple"
	hash, err := service.HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword() failed: %v", err)
	}
	if strings.Contains(hash, password) {
		t.Fatal("password hash contains plaintext password")
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$m=65536,t=3,p=2$") {
		t.Fatalf("unexpected Argon2id PHC parameters: %q", hash)
	}
	if !service.VerifyPassword(hash, password) {
		t.Fatal("VerifyPassword() rejected the correct password")
	}
	if service.VerifyPassword(hash, "wrong password") {
		t.Fatal("VerifyPassword() accepted the wrong password")
	}
	for _, malformed := range []string{"", "not-phc", "$argon2id$v=19$m=x,t=3,p=2$bad$bad", "$argon2i$v=19$m=65536,t=3,p=2$bad$bad"} {
		if service.VerifyPassword(malformed, password) {
			t.Fatalf("VerifyPassword() accepted malformed hash %q", malformed)
		}
	}
	tamperedParameters := strings.Replace(hash, "$m=65536,t=3,p=2$", "$m=65536,t=3,p=2garbage$", 1)
	if service.VerifyPassword(tamperedParameters, password) {
		t.Fatal("VerifyPassword() accepted a PHC string with trailing parameter garbage")
	}
}

func TestAuthServiceRejectsShortJWTSecret(t *testing.T) {
	_, err := service.NewAuthService(nil, service.AuthConfig{JWTSecret: []byte("too-short")})
	if !errors.Is(err, service.ErrWeakJWTSecret) {
		t.Fatalf("expected ErrWeakJWTSecret, got %v", err)
	}
}

func TestAuthServiceRegisterLoginClaimsAndRefreshRotation(t *testing.T) {
	now := time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC)
	svc, repo := newAuthService(t, now)
	ctx := context.Background()

	user, err := svc.Register(ctx, service.RegisterRequest{
		Name: " Alice ", Email: " Alice@Example.COM ", Password: "password8",
	})
	if err != nil {
		t.Fatalf("Register() failed: %v", err)
	}
	if user.Email != "alice@example.com" || user.DisplayName != "Alice" {
		t.Fatalf("registration was not normalized: %#v", user)
	}

	result, err := svc.Login(ctx, "ALICE@example.com", "password8")
	if err != nil {
		t.Fatalf("Login() failed: %v", err)
	}
	if result.AccessToken == "" || result.RefreshToken == "" {
		t.Fatal("Login() did not issue both credentials")
	}
	parts := strings.Split(result.RefreshToken, ".")
	if len(parts) != 2 {
		t.Fatalf("refresh token must be <session_uuid>.<secret>, got %q", result.RefreshToken)
	}
	if _, err := uuid.Parse(parts[0]); err != nil {
		t.Fatalf("refresh token session ID is not a UUID: %v", err)
	}
	persisted, err := repo.FindActiveSessionByID(ctx, parts[0], now)
	if err != nil {
		t.Fatalf("FindActiveSessionByID() failed: %v", err)
	}
	if len(persisted.RefreshTokenHash) != 64 || strings.Contains(result.RefreshToken, persisted.RefreshTokenHash) || strings.Contains(persisted.RefreshTokenHash, parts[1]) {
		t.Fatalf("refresh credential was not persisted as an isolated SHA-256 digest")
	}
	wrongSecret := parts[0] + "." + strings.Repeat("A", 43)
	if _, err := svc.Refresh(ctx, wrongSecret); !errors.Is(err, service.ErrInvalidCredentials) {
		t.Fatalf("Refresh() accepted a wrong secret for a valid session UUID: %v", err)
	}

	claims, err := svc.ValidateAccess(result.AccessToken)
	if err != nil {
		t.Fatalf("ValidateAccess() failed: %v", err)
	}
	if claims.Subject != user.ID || claims.SessionID != parts[0] || claims.Issuer != "todolist-backend" {
		t.Fatalf("unexpected access claims: %#v", claims)
	}
	if !claims.ExpiresAt.Time.Equal(now.Add(15 * time.Minute)) {
		t.Fatalf("unexpected access expiry: %s", claims.ExpiresAt.Time)
	}

	rotated, err := svc.Refresh(ctx, result.RefreshToken)
	if err != nil {
		t.Fatalf("Refresh() failed: %v", err)
	}
	if rotated.RefreshToken == result.RefreshToken {
		t.Fatal("Refresh() reused the old opaque credential")
	}
	if _, err := svc.Refresh(ctx, result.RefreshToken); !errors.Is(err, service.ErrInvalidCredentials) {
		t.Fatalf("old refresh credential was reusable: %v", err)
	}
	if _, err := svc.ValidateAccess(rotated.AccessToken); err != nil {
		t.Fatalf("rotated access token failed validation: %v", err)
	}
}

func TestAuthServiceDoesNotRevealUnknownUserOrWrongPassword(t *testing.T) {
	now := time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC)
	svc, _ := newAuthService(t, now)
	ctx := context.Background()
	if _, err := svc.Register(ctx, service.RegisterRequest{Name: "Alice", Email: "alice@example.com", Password: "password8"}); err != nil {
		t.Fatalf("Register() failed: %v", err)
	}
	_, missingErr := svc.Login(ctx, "missing@example.com", "password8")
	_, wrongErr := svc.Login(ctx, "alice@example.com", "wrong-password")
	if !errors.Is(missingErr, service.ErrInvalidCredentials) || !errors.Is(wrongErr, service.ErrInvalidCredentials) {
		t.Fatalf("expected indistinguishable credential failures, got missing=%v wrong=%v", missingErr, wrongErr)
	}
}

func TestAuthServiceRejectsExpiredWrongIssuerAndNonHS256AccessTokens(t *testing.T) {
	now := time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC)
	svc, _ := newAuthService(t, now)
	sign := func(method jwt.SigningMethod, claims service.AccessClaims) string {
		t.Helper()
		token := jwt.NewWithClaims(method, claims)
		key := any([]byte(testJWTSecret))
		if method.Alg() == jwt.SigningMethodNone.Alg() {
			key = jwt.UnsafeAllowNoneSignatureType
		}
		signed, err := token.SignedString(key)
		if err != nil {
			t.Fatalf("SignedString() failed: %v", err)
		}
		return signed
	}
	base := service.AccessClaims{SessionID: uuid.NewString(), RegisteredClaims: jwt.RegisteredClaims{
		Subject: uuid.NewString(), Issuer: "todolist-backend",
		IssuedAt: jwt.NewNumericDate(now.Add(-time.Hour)), ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
	}}
	expired := base
	expired.ExpiresAt = jwt.NewNumericDate(now.Add(-time.Second))
	wrongIssuer := base
	wrongIssuer.Issuer = "attacker"
	for name, token := range map[string]string{
		"expired":      sign(jwt.SigningMethodHS256, expired),
		"wrong issuer": sign(jwt.SigningMethodHS256, wrongIssuer),
		"none alg":     sign(jwt.SigningMethodNone, base),
	} {
		if _, err := svc.ValidateAccess(token); err == nil {
			t.Fatalf("ValidateAccess() accepted %s token", name)
		}
	}
}

func TestAuthServiceLogoutRevokesRefreshCredential(t *testing.T) {
	now := time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC)
	svc, _ := newAuthService(t, now)
	ctx := context.Background()
	if _, err := svc.Register(ctx, service.RegisterRequest{Name: "Alice", Email: "alice@example.com", Password: "password8"}); err != nil {
		t.Fatalf("Register() failed: %v", err)
	}
	result, err := svc.Login(ctx, "alice@example.com", "password8")
	if err != nil {
		t.Fatalf("Login() failed: %v", err)
	}
	if err := svc.Logout(ctx, result.RefreshToken); err != nil {
		t.Fatalf("Logout() failed: %v", err)
	}
	if _, err := svc.Refresh(ctx, result.RefreshToken); !errors.Is(err, service.ErrInvalidCredentials) {
		t.Fatalf("revoked refresh credential was accepted: %v", err)
	}
}

func TestAuthServiceValidatesRegistrationInput(t *testing.T) {
	now := time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC)
	svc, _ := newAuthService(t, now)
	for name, req := range map[string]service.RegisterRequest{
		"blank name":     {Name: "  ", Email: "a@example.com", Password: "password8"},
		"bad email":      {Name: "A", Email: "not-email", Password: "password8"},
		"short password": {Name: "A", Email: "a@example.com", Password: "short"},
		"long password":  {Name: "A", Email: "a@example.com", Password: strings.Repeat("a", 129)},
	} {
		if _, err := svc.Register(context.Background(), req); !errors.Is(err, service.ErrInvalidInput) {
			t.Fatalf("%s: expected ErrInvalidInput, got %v", name, err)
		}
	}
}
