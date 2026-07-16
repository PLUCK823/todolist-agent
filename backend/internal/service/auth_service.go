package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/mail"
	"strconv"
	"strings"
	"time"

	"backend/internal/model"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/argon2"
	"gorm.io/gorm"
)

var (
	ErrWeakJWTSecret       = errors.New("JWT secret must be at least 32 bytes")
	ErrInvalidInput        = errors.New("invalid authentication input")
	ErrEmailExists         = errors.New("email already exists")
	ErrInvalidCredentials  = errors.New("invalid credentials")
	ErrInvalidAccessToken  = errors.New("invalid access token")
	ErrAuthenticationStore = errors.New("authentication store failure")
)

const defaultIssuer = "todolist-backend"

type PasswordParams struct {
	Memory      uint32
	Iterations  uint32
	Parallelism uint8
	SaltLength  uint32
	KeyLength   uint32
}

var DefaultPasswordParams = PasswordParams{
	Memory: 64 * 1024, Iterations: 3, Parallelism: 2, SaltLength: 16, KeyLength: 32,
}

type AuthRepository interface {
	CreateUser(context.Context, *model.User) error
	FindUserByEmail(context.Context, string) (*model.User, error)
	FindUserByID(context.Context, string) (*model.User, error)
	CreateSession(context.Context, *model.AuthSession) error
	FindActiveSessionByID(context.Context, string, time.Time) (*model.AuthSession, error)
	RotateSession(context.Context, string, time.Time, *model.AuthSession) error
	RevokeSession(context.Context, string, time.Time) error
}

type AuthConfig struct {
	JWTSecret  []byte
	AccessTTL  time.Duration
	RefreshTTL time.Duration
	Issuer     string
	Now        func() time.Time
}

type AuthService struct {
	repo       AuthRepository
	jwtSecret  []byte
	accessTTL  time.Duration
	refreshTTL time.Duration
	issuer     string
	now        func() time.Time
}

type RegisterRequest struct {
	Name     string
	Email    string
	Password string
}

type AuthResult struct {
	User          *model.User
	AccessToken   string
	RefreshToken  string
	AccessExpiry  time.Time
	RefreshExpiry time.Time
}

type AccessClaims struct {
	SessionID string `json:"sid"`
	jwt.RegisteredClaims
}

func NewAuthService(repo AuthRepository, cfg AuthConfig) (*AuthService, error) {
	if len(cfg.JWTSecret) < 32 {
		return nil, ErrWeakJWTSecret
	}
	if repo == nil {
		return nil, fmt.Errorf("%w: repository is required", ErrAuthenticationStore)
	}
	if cfg.AccessTTL <= 0 {
		cfg.AccessTTL = 15 * time.Minute
	}
	if cfg.RefreshTTL <= 0 {
		cfg.RefreshTTL = 30 * 24 * time.Hour
	}
	if cfg.Issuer == "" {
		cfg.Issuer = defaultIssuer
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return &AuthService{
		repo: repo, jwtSecret: append([]byte(nil), cfg.JWTSecret...),
		accessTTL: cfg.AccessTTL, refreshTTL: cfg.RefreshTTL, issuer: cfg.Issuer, now: cfg.Now,
	}, nil
}

func HashPassword(password string) (string, error) {
	return hashPassword(password, DefaultPasswordParams)
}

func hashPassword(password string, params PasswordParams) (string, error) {
	if password == "" || !validPasswordParams(params) {
		return "", ErrInvalidInput
	}
	salt := make([]byte, params.SaltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate password salt: %w", err)
	}
	digest := argon2.IDKey([]byte(password), salt, params.Iterations, params.Memory, params.Parallelism, params.KeyLength)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, params.Memory, params.Iterations, params.Parallelism,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(digest)), nil
}

func VerifyPassword(encodedHash, password string) bool {
	params, salt, expected, ok := parsePasswordHash(encodedHash)
	if !ok {
		return false
	}
	actual := argon2.IDKey([]byte(password), salt, params.Iterations, params.Memory, params.Parallelism, params.KeyLength)
	return subtle.ConstantTimeCompare(actual, expected) == 1
}

func parsePasswordHash(encoded string) (PasswordParams, []byte, []byte, bool) {
	var params PasswordParams
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" || parts[2] != "v="+strconv.Itoa(argon2.Version) {
		return params, nil, nil, false
	}
	var memory, iterations uint32
	var parallelism uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &parallelism); err != nil {
		return params, nil, nil, false
	}
	salt, err := base64.RawStdEncoding.Strict().DecodeString(parts[4])
	if err != nil {
		return params, nil, nil, false
	}
	expected, err := base64.RawStdEncoding.Strict().DecodeString(parts[5])
	if err != nil {
		return params, nil, nil, false
	}
	params = PasswordParams{Memory: memory, Iterations: iterations, Parallelism: parallelism, SaltLength: uint32(len(salt)), KeyLength: uint32(len(expected))}
	if !validPasswordParams(params) {
		return PasswordParams{}, nil, nil, false
	}
	return params, salt, expected, true
}

func validPasswordParams(params PasswordParams) bool {
	return params.Memory >= 8*1024 && params.Memory <= 128*1024 &&
		params.Iterations >= 1 && params.Iterations <= 10 &&
		params.Parallelism >= 1 && params.Parallelism <= 8 &&
		params.SaltLength >= 8 && params.SaltLength <= 64 &&
		params.KeyLength >= 16 && params.KeyLength <= 64
}

func (s *AuthService) Register(ctx context.Context, req RegisterRequest) (*model.User, error) {
	name := strings.TrimSpace(req.Name)
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if len([]rune(name)) < 1 || len([]rune(name)) > 120 || !validEmail(email) || len(req.Password) < 8 || len(req.Password) > 128 {
		return nil, ErrInvalidInput
	}
	if _, err := s.repo.FindUserByEmail(ctx, email); err == nil {
		return nil, ErrEmailExists
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("%w: find email: %v", ErrAuthenticationStore, err)
	}
	hash, err := HashPassword(req.Password)
	if err != nil {
		return nil, err
	}
	user := &model.User{ID: uuid.NewString(), Email: email, DisplayName: name, PasswordHash: hash}
	if err := s.repo.CreateUser(ctx, user); err != nil {
		if isDuplicateError(err) {
			return nil, ErrEmailExists
		}
		return nil, fmt.Errorf("%w: create user: %v", ErrAuthenticationStore, err)
	}
	return user, nil
}

func (s *AuthService) Login(ctx context.Context, email, password string) (*AuthResult, error) {
	user, err := s.repo.FindUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// Keep an unknown account on the same expensive password-verification path.
			dummy, hashErr := HashPassword("unknown-account-dummy-password")
			if hashErr == nil {
				_ = VerifyPassword(dummy, password)
			}
			return nil, ErrInvalidCredentials
		}
		return nil, fmt.Errorf("%w: find user: %v", ErrAuthenticationStore, err)
	}
	if !VerifyPassword(user.PasswordHash, password) {
		return nil, ErrInvalidCredentials
	}
	return s.createLoginSession(ctx, user)
}

func (s *AuthService) createLoginSession(ctx context.Context, user *model.User) (*AuthResult, error) {
	now := s.now().UTC()
	sessionID := uuid.NewString()
	secret, refresh, hash, err := generateRefreshCredential(sessionID)
	if err != nil {
		return nil, err
	}
	_ = secret // raw secret exists only long enough to construct the Cookie value.
	session := &model.AuthSession{ID: sessionID, UserID: user.ID, RefreshTokenHash: hash, ExpiresAt: now.Add(s.refreshTTL), LastUsedAt: now}
	if err := s.repo.CreateSession(ctx, session); err != nil {
		return nil, fmt.Errorf("%w: create session: %v", ErrAuthenticationStore, err)
	}
	access, expiry, err := s.signAccess(user.ID, session.ID, now)
	if err != nil {
		_ = s.repo.RevokeSession(ctx, session.ID, now)
		return nil, err
	}
	return &AuthResult{User: user, AccessToken: access, RefreshToken: refresh, AccessExpiry: expiry, RefreshExpiry: session.ExpiresAt}, nil
}

func (s *AuthService) Refresh(ctx context.Context, refreshToken string) (*AuthResult, error) {
	sessionID, secret, ok := parseRefreshCredential(refreshToken)
	if !ok {
		return nil, ErrInvalidCredentials
	}
	now := s.now().UTC()
	current, err := s.repo.FindActiveSessionByID(ctx, sessionID, now)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInvalidCredentials
		}
		return nil, fmt.Errorf("%w: find session: %v", ErrAuthenticationStore, err)
	}
	providedHash := hashRefreshSecret(secret)
	if subtle.ConstantTimeCompare([]byte(providedHash), []byte(current.RefreshTokenHash)) != 1 {
		return nil, ErrInvalidCredentials
	}
	user, err := s.repo.FindUserByID(ctx, current.UserID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInvalidCredentials
		}
		return nil, fmt.Errorf("%w: find session user: %v", ErrAuthenticationStore, err)
	}
	replacementID := uuid.NewString()
	_, replacementToken, replacementHash, err := generateRefreshCredential(replacementID)
	if err != nil {
		return nil, err
	}
	replacement := &model.AuthSession{ID: replacementID, UserID: user.ID, RefreshTokenHash: replacementHash, ExpiresAt: now.Add(s.refreshTTL), LastUsedAt: now}
	if err := s.repo.RotateSession(ctx, current.ID, now, replacement); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInvalidCredentials
		}
		return nil, fmt.Errorf("%w: rotate session: %v", ErrAuthenticationStore, err)
	}
	access, expiry, err := s.signAccess(user.ID, replacement.ID, now)
	if err != nil {
		return nil, err
	}
	return &AuthResult{User: user, AccessToken: access, RefreshToken: replacementToken, AccessExpiry: expiry, RefreshExpiry: replacement.ExpiresAt}, nil
}

func (s *AuthService) Logout(ctx context.Context, refreshToken string) error {
	sessionID, secret, ok := parseRefreshCredential(refreshToken)
	if !ok {
		return ErrInvalidCredentials
	}
	now := s.now().UTC()
	session, err := s.repo.FindActiveSessionByID(ctx, sessionID, now)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrInvalidCredentials
		}
		return fmt.Errorf("%w: find session: %v", ErrAuthenticationStore, err)
	}
	providedHash := hashRefreshSecret(secret)
	if subtle.ConstantTimeCompare([]byte(providedHash), []byte(session.RefreshTokenHash)) != 1 {
		return ErrInvalidCredentials
	}
	if err := s.repo.RevokeSession(ctx, session.ID, now); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrInvalidCredentials
		}
		return fmt.Errorf("%w: revoke session: %v", ErrAuthenticationStore, err)
	}
	return nil
}

func (s *AuthService) ValidateAccess(raw string) (*AccessClaims, error) {
	claims := &AccessClaims{}
	token, err := jwt.ParseWithClaims(raw, claims, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, ErrInvalidAccessToken
		}
		return s.jwtSecret, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithIssuer(s.issuer), jwt.WithExpirationRequired(), jwt.WithTimeFunc(s.now))
	if err != nil || !token.Valid || claims.Subject == "" || claims.SessionID == "" {
		return nil, ErrInvalidAccessToken
	}
	if _, err := uuid.Parse(claims.Subject); err != nil {
		return nil, ErrInvalidAccessToken
	}
	if _, err := uuid.Parse(claims.SessionID); err != nil {
		return nil, ErrInvalidAccessToken
	}
	return claims, nil
}

func (s *AuthService) signAccess(userID, sessionID string, now time.Time) (string, time.Time, error) {
	expires := now.Add(s.accessTTL)
	claims := AccessClaims{SessionID: sessionID, RegisteredClaims: jwt.RegisteredClaims{
		Subject: userID, Issuer: s.issuer, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(expires),
	}}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.jwtSecret)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("sign access token: %w", err)
	}
	return signed, expires, nil
}

func generateRefreshCredential(sessionID string) ([]byte, string, string, error) {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return nil, "", "", fmt.Errorf("generate refresh secret: %w", err)
	}
	encoded := base64.RawURLEncoding.EncodeToString(secret)
	return secret, sessionID + "." + encoded, hashRefreshSecret(secret), nil
}

func parseRefreshCredential(raw string) (string, []byte, bool) {
	parts := strings.Split(raw, ".")
	if len(parts) != 2 {
		return "", nil, false
	}
	if _, err := uuid.Parse(parts[0]); err != nil {
		return "", nil, false
	}
	secret, err := base64.RawURLEncoding.Strict().DecodeString(parts[1])
	if err != nil || len(secret) != 32 {
		return "", nil, false
	}
	return parts[0], secret, true
}

func hashRefreshSecret(secret []byte) string {
	digest := sha256.Sum256(secret)
	return hex.EncodeToString(digest[:])
}

func validEmail(value string) bool {
	if value == "" || len(value) > 254 || strings.ContainsAny(value, "\r\n") {
		return false
	}
	address, err := mail.ParseAddress(value)
	return err == nil && address.Address == value && strings.Contains(value, "@")
}

func isDuplicateError(err error) bool {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "unique constraint") || strings.Contains(message, "duplicate key")
}
