package service_test

import (
	"context"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"

	"backend/internal/database"
	"backend/internal/model"
	"backend/internal/repository"
	"backend/internal/service"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"gorm.io/gorm"
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

type faultingAuthRepository struct {
	*repository.AuthRepository
	countTodosErr         error
	countAgentSessionsErr error
}

func (r *faultingAuthRepository) CountTodos(ctx context.Context) (int64, error) {
	if r.countTodosErr != nil {
		return 0, r.countTodosErr
	}
	return r.AuthRepository.CountTodos(ctx)
}

func (r *faultingAuthRepository) CountAgentSessions(ctx context.Context, ownerID string) (int64, error) {
	if r.countAgentSessionsErr != nil {
		return 0, r.countAgentSessionsErr
	}
	return r.AuthRepository.CountAgentSessions(ctx, ownerID)
}

func newFaultingAuthService(t *testing.T, now time.Time) (*service.AuthService, *faultingAuthRepository, *gorm.DB) {
	t.Helper()
	db, err := database.InitDB(database.Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatalf("InitDB() failed: %v", err)
	}
	repo := &faultingAuthRepository{AuthRepository: repository.NewAuthRepository(db)}
	svc, err := service.NewAuthService(repo, service.AuthConfig{
		JWTSecret: []byte(testJWTSecret), AccessTTL: 15 * time.Minute, RefreshTTL: 24 * time.Hour,
		Now: func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewAuthService() failed: %v", err)
	}
	return svc, repo, db
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

func TestVerifyPasswordRejectsPHCResourceBoundariesBeforeArgon2(t *testing.T) {
	password := "correct horse battery staple"
	valid, err := service.HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword() failed: %v", err)
	}
	parts := strings.Split(valid, "$")
	if len(parts) != 6 {
		t.Fatalf("unexpected PHC string: %q", valid)
	}
	encode := func(n int) string {
		return strings.TrimRight(base64.StdEncoding.EncodeToString(make([]byte, n)), "=")
	}
	for name, mutate := range map[string]func([]string){
		"memory below minimum":  func(p []string) { p[3] = "m=8191,t=3,p=2" },
		"memory above maximum":  func(p []string) { p[3] = "m=131073,t=3,p=2" },
		"iterations zero":       func(p []string) { p[3] = "m=65536,t=0,p=2" },
		"iterations above max":  func(p []string) { p[3] = "m=65536,t=11,p=2" },
		"parallelism zero":      func(p []string) { p[3] = "m=65536,t=3,p=0" },
		"parallelism above max": func(p []string) { p[3] = "m=65536,t=3,p=9" },
		"salt below minimum":    func(p []string) { p[4] = encode(7) },
		"salt above maximum":    func(p []string) { p[4] = encode(65) },
		"key below minimum":     func(p []string) { p[5] = encode(15) },
		"key above maximum":     func(p []string) { p[5] = encode(65) },
	} {
		t.Run(name, func(t *testing.T) {
			mutated := append([]string(nil), parts...)
			mutate(mutated)
			if service.VerifyPassword(strings.Join(mutated, "$"), password) {
				t.Fatal("VerifyPassword() accepted out-of-bounds PHC resources")
			}
		})
	}
}

func TestAuthServiceRejectsShortJWTSecret(t *testing.T) {
	_, err := service.NewAuthService(nil, service.AuthConfig{JWTSecret: []byte("too-short")})
	if !errors.Is(err, service.ErrWeakJWTSecret) {
		t.Fatalf("expected ErrWeakJWTSecret, got %v", err)
	}
}

func TestAuthServiceHandlesDummyHashInitializationFailure(t *testing.T) {
	repo := &faultingAuthRepository{}
	_, err := service.NewAuthService(repo, service.AuthConfig{
		JWTSecret:      []byte(testJWTSecret),
		PasswordHasher: func(string) (string, error) { return "", errors.New("random source failed") },
	})
	if !errors.Is(err, service.ErrAuthenticationStore) {
		t.Fatalf("expected dummy hash initialization failure, got %v", err)
	}
}

func TestUnknownUserAndWrongPasswordEachRunExactlyOneVerification(t *testing.T) {
	now := time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC)
	db, err := database.InitDB(database.Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatalf("InitDB() failed: %v", err)
	}
	repo := repository.NewAuthRepository(db)
	verifyCalls := 0
	svc, err := service.NewAuthService(repo, service.AuthConfig{
		JWTSecret: []byte(testJWTSecret), Now: func() time.Time { return now },
		PasswordVerifier: func(hash, password string) bool {
			verifyCalls++
			return service.VerifyPassword(hash, password)
		},
	})
	if err != nil {
		t.Fatalf("NewAuthService() failed: %v", err)
	}
	if _, err := svc.Register(context.Background(), service.RegisterRequest{Name: "Alice", Email: "alice@example.com", Password: "password8"}); err != nil {
		t.Fatalf("Register() failed: %v", err)
	}

	verifyCalls = 0
	_, _ = svc.Login(context.Background(), "missing@example.com", "password8")
	if verifyCalls != 1 {
		t.Fatalf("unknown user performed %d password verifications, want 1", verifyCalls)
	}
	verifyCalls = 0
	_, _ = svc.Login(context.Background(), "alice@example.com", "wrong-password")
	if verifyCalls != 1 {
		t.Fatalf("wrong password performed %d password verifications, want 1", verifyCalls)
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
	if user.Email != "alice@example.com" || user.Name != "Alice" {
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
	if claims.IssuedAt == nil || !claims.IssuedAt.Time.Equal(now) {
		t.Fatalf("unexpected access issued-at: %v", claims.IssuedAt)
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
	missingIssuedAt := base
	missingIssuedAt.IssuedAt = nil
	futureIssuedAt := base
	futureIssuedAt.IssuedAt = jwt.NewNumericDate(now.Add(time.Minute))
	for name, token := range map[string]string{
		"expired":           sign(jwt.SigningMethodHS256, expired),
		"wrong issuer":      sign(jwt.SigningMethodHS256, wrongIssuer),
		"missing issued-at": sign(jwt.SigningMethodHS256, missingIssuedAt),
		"future issued-at":  sign(jwt.SigningMethodHS256, futureIssuedAt),
		"none alg":          sign(jwt.SigningMethodNone, base),
	} {
		if _, err := svc.ValidateAccess(token); err == nil {
			t.Fatalf("ValidateAccess() accepted %s token", name)
		}
	}
}

func TestAuthLifecycleMutationsAreFailureAtomicWhenAccountEnrichmentFails(t *testing.T) {
	now := time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC)
	ctx := context.Background()
	boom := errors.New("statistics unavailable")

	t.Run("register leaves no user", func(t *testing.T) {
		svc, repo, _ := newFaultingAuthService(t, now)
		repo.countTodosErr = boom
		_, err := svc.Register(ctx, service.RegisterRequest{Name: "Alice", Email: "alice@example.com", Password: "password8"})
		if !errors.Is(err, service.ErrAuthenticationStore) {
			t.Fatalf("Register() error = %v", err)
		}
		if _, err := repo.FindUserByEmail(ctx, "alice@example.com"); !errors.Is(err, gorm.ErrRecordNotFound) {
			t.Fatalf("failed register persisted user: %v", err)
		}
	})

	t.Run("login leaves no auth session", func(t *testing.T) {
		svc, repo, db := newFaultingAuthService(t, now)
		if _, err := svc.Register(ctx, service.RegisterRequest{Name: "Alice", Email: "alice@example.com", Password: "password8"}); err != nil {
			t.Fatalf("Register() failed: %v", err)
		}
		repo.countTodosErr = boom
		if _, err := svc.Login(ctx, "alice@example.com", "password8"); !errors.Is(err, service.ErrAuthenticationStore) {
			t.Fatalf("Login() error = %v", err)
		}
		var sessions int64
		if err := db.Model(&model.AuthSession{}).Count(&sessions).Error; err != nil {
			t.Fatalf("count auth sessions: %v", err)
		}
		if sessions != 0 {
			t.Fatalf("failed login persisted %d auth sessions", sessions)
		}
	})

	t.Run("refresh preserves old session", func(t *testing.T) {
		svc, repo, db := newFaultingAuthService(t, now)
		if _, err := svc.Register(ctx, service.RegisterRequest{Name: "Alice", Email: "alice@example.com", Password: "password8"}); err != nil {
			t.Fatalf("Register() failed: %v", err)
		}
		login, err := svc.Login(ctx, "alice@example.com", "password8")
		if err != nil {
			t.Fatalf("Login() failed: %v", err)
		}
		repo.countAgentSessionsErr = boom
		if _, err := svc.Refresh(ctx, login.RefreshToken); !errors.Is(err, service.ErrAuthenticationStore) {
			t.Fatalf("Refresh() error = %v", err)
		}
		var sessions int64
		if err := db.Model(&model.AuthSession{}).Count(&sessions).Error; err != nil {
			t.Fatalf("count auth sessions: %v", err)
		}
		if sessions != 1 {
			t.Fatalf("failed refresh persisted replacement; session count = %d", sessions)
		}
		repo.countAgentSessionsErr = nil
		if _, err := svc.Refresh(ctx, login.RefreshToken); err != nil {
			t.Fatalf("old refresh was consumed by failed enrichment: %v", err)
		}
	})

	t.Run("profile remains unchanged", func(t *testing.T) {
		svc, repo, _ := newFaultingAuthService(t, now)
		account, err := svc.Register(ctx, service.RegisterRequest{Name: "Alice", Email: "alice@example.com", Password: "password8"})
		if err != nil {
			t.Fatalf("Register() failed: %v", err)
		}
		name := "Changed"
		repo.countTodosErr = boom
		if _, err := svc.UpdateAccount(ctx, account.ID, service.AccountUpdateRequest{Name: &name}); !errors.Is(err, service.ErrAuthenticationStore) {
			t.Fatalf("UpdateAccount() error = %v", err)
		}
		user, err := repo.FindUserByID(ctx, account.ID)
		if err != nil {
			t.Fatalf("FindUserByID() failed: %v", err)
		}
		if user.DisplayName != "Alice" {
			t.Fatalf("failed profile update mutated name to %q", user.DisplayName)
		}
	})
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
