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
	ErrPasswordBusy        = errors.New("password work is busy")
	ErrPasswordCancelled   = errors.New("password work cancelled")
	ErrLoginRateLimited    = errors.New("login rate limited")
)

const defaultIssuer = "todolist-backend"

const (
	defaultPasswordConcurrency = 4
	defaultPasswordQueueLimit  = 32
	defaultLoginIPLimit        = 30
	defaultLoginAccountLimit   = 10
	defaultLoginRateCapacity   = 4096
	maxPHCLength               = 512
	maxPHCSaltEncodingLength   = 128
	maxPHCDigestEncodingLength = 128
)

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
	UpdateUserProfile(context.Context, string, model.ProfilePatch) error
	CountTodos(context.Context) (int64, error)
	CountAgentSessions(context.Context, string) (int64, error)
	CreateSession(context.Context, *model.AuthSession) error
	FindActiveSessionByID(context.Context, string, time.Time) (*model.AuthSession, error)
	RotateSession(context.Context, string, time.Time, *model.AuthSession) error
	RevokeSession(context.Context, string, time.Time) error
}

type AuthConfig struct {
	JWTSecret           []byte
	AccessTTL           time.Duration
	RefreshTTL          time.Duration
	Issuer              string
	Now                 func() time.Time
	PasswordHasher      func(string) (string, error)
	PasswordVerifier    func(string, string) bool
	PasswordConcurrency int
	PasswordQueueLimit  int
	LoginIPLimit        int
	LoginAccountLimit   int
	LoginRateWindow     time.Duration
	LoginRateCapacity   int
}

type AuthService struct {
	repo           AuthRepository
	jwtSecret      []byte
	accessTTL      time.Duration
	refreshTTL     time.Duration
	issuer         string
	now            func() time.Time
	hashPassword   func(string) (string, error)
	verifyPassword func(string, string) bool
	dummyHash      string
	passwordSem    chan struct{}
	passwordQueue  chan struct{}
	loginLimiter   *loginFailureLimiter
}

type RegisterRequest struct {
	Name     string
	Email    string
	Password string
}

type AccountUpdateRequest struct {
	Name     *string
	Email    *string
	Timezone *string
}

type AvatarPreset struct {
	Kind  string `json:"kind"`
	Value string `json:"value"`
}

type Account struct {
	ID                string       `json:"id"`
	Name              string       `json:"name"`
	Email             string       `json:"email"`
	Timezone          string       `json:"timezone"`
	Avatar            AvatarPreset `json:"avatar"`
	TaskCount         int64        `json:"taskCount"`
	AgentSessionCount int64        `json:"agentSessionCount"`
}

type AuthResult struct {
	Account       *Account
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
	if cfg.PasswordHasher == nil {
		cfg.PasswordHasher = HashPassword
	}
	if cfg.PasswordVerifier == nil {
		cfg.PasswordVerifier = VerifyPassword
	}
	if cfg.PasswordConcurrency <= 0 {
		cfg.PasswordConcurrency = defaultPasswordConcurrency
	}
	if cfg.PasswordQueueLimit <= 0 {
		cfg.PasswordQueueLimit = defaultPasswordQueueLimit
	}
	if cfg.PasswordQueueLimit < cfg.PasswordConcurrency {
		cfg.PasswordQueueLimit = cfg.PasswordConcurrency
	}
	if cfg.LoginIPLimit <= 0 {
		cfg.LoginIPLimit = defaultLoginIPLimit
	}
	if cfg.LoginAccountLimit <= 0 {
		cfg.LoginAccountLimit = defaultLoginAccountLimit
	}
	if cfg.LoginRateWindow <= 0 {
		cfg.LoginRateWindow = time.Minute
	}
	if cfg.LoginRateCapacity <= 0 {
		cfg.LoginRateCapacity = defaultLoginRateCapacity
	}
	dummyHash, err := cfg.PasswordHasher("authentication-timing-dummy-password")
	if err != nil {
		return nil, fmt.Errorf("%w: initialize password verifier: %v", ErrAuthenticationStore, err)
	}
	return &AuthService{
		repo: repo, jwtSecret: append([]byte(nil), cfg.JWTSecret...),
		accessTTL: cfg.AccessTTL, refreshTTL: cfg.RefreshTTL, issuer: cfg.Issuer, now: cfg.Now,
		hashPassword: cfg.PasswordHasher, verifyPassword: cfg.PasswordVerifier, dummyHash: dummyHash,
		passwordSem:   make(chan struct{}, cfg.PasswordConcurrency),
		passwordQueue: make(chan struct{}, cfg.PasswordQueueLimit),
		loginLimiter:  newLoginFailureLimiter(cfg.Now, cfg.LoginRateWindow, cfg.LoginIPLimit, cfg.LoginAccountLimit, cfg.LoginRateCapacity),
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
	if len(encoded) == 0 || len(encoded) > maxPHCLength {
		return params, nil, nil, false
	}
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" || parts[2] != "v="+strconv.Itoa(argon2.Version) {
		return params, nil, nil, false
	}
	if len(parts[4]) > maxPHCSaltEncodingLength || len(parts[5]) > maxPHCDigestEncodingLength {
		return params, nil, nil, false
	}
	var memory, iterations uint32
	var parallelism uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &parallelism); err != nil {
		return params, nil, nil, false
	}
	if parts[3] != fmt.Sprintf("m=%d,t=%d,p=%d", memory, iterations, parallelism) {
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

func (s *AuthService) Register(ctx context.Context, req RegisterRequest) (*Account, error) {
	name := strings.TrimSpace(req.Name)
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if len([]rune(name)) < 1 || len([]rune(name)) > 120 || !validEmail(email) || !validPasswordLength(req.Password) {
		return nil, ErrInvalidInput
	}
	if _, err := s.repo.FindUserByEmail(ctx, email); err == nil {
		return nil, ErrEmailExists
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("%w: find email: %v", ErrAuthenticationStore, err)
	}
	hash, err := s.hash(ctx, req.Password)
	if err != nil {
		return nil, err
	}
	user := &model.User{ID: uuid.NewString(), Email: email, DisplayName: name, Timezone: "Asia/Shanghai (UTC+8)", PasswordHash: hash}
	account, err := s.accountFromUser(ctx, user)
	if err != nil {
		return nil, err
	}
	if err := s.repo.CreateUser(ctx, user); err != nil {
		if isDuplicateError(err) {
			return nil, ErrEmailExists
		}
		return nil, fmt.Errorf("%w: create user: %v", ErrAuthenticationStore, err)
	}
	return account, nil
}

func (s *AuthService) GetAccount(ctx context.Context, userID string) (*Account, error) {
	user, err := s.repo.FindUserByID(ctx, userID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInvalidCredentials
		}
		return nil, fmt.Errorf("%w: find account: %v", ErrAuthenticationStore, err)
	}
	return s.accountFromUser(ctx, user)
}

func (s *AuthService) UpdateAccount(ctx context.Context, userID string, req AccountUpdateRequest) (*Account, error) {
	user, err := s.repo.FindUserByID(ctx, userID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInvalidCredentials
		}
		return nil, fmt.Errorf("%w: find account: %v", ErrAuthenticationStore, err)
	}
	if req.Name == nil && req.Email == nil && req.Timezone == nil {
		return nil, ErrInvalidInput
	}
	name, email, timezone := user.DisplayName, user.Email, user.Timezone
	if req.Name != nil {
		name = strings.TrimSpace(*req.Name)
	}
	if req.Email != nil {
		email = strings.ToLower(strings.TrimSpace(*req.Email))
	}
	if req.Timezone != nil {
		timezone = strings.TrimSpace(*req.Timezone)
	}
	if len([]rune(name)) < 1 || len([]rune(name)) > 120 || !validEmail(email) || len([]rune(timezone)) < 1 || len([]rune(timezone)) > 100 {
		return nil, ErrInvalidInput
	}
	if email != user.Email {
		existing, findErr := s.repo.FindUserByEmail(ctx, email)
		if findErr == nil && existing.ID != user.ID {
			return nil, ErrEmailExists
		}
		if findErr != nil && !errors.Is(findErr, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("%w: check email: %v", ErrAuthenticationStore, findErr)
		}
	}
	proposed := *user
	proposed.DisplayName = name
	proposed.Email = email
	proposed.Timezone = timezone
	account, err := s.accountFromUser(ctx, &proposed)
	if err != nil {
		return nil, err
	}
	patch := model.ProfilePatch{}
	if req.Name != nil {
		patch.DisplayName = &name
	}
	if req.Email != nil {
		patch.Email = &email
	}
	if req.Timezone != nil {
		patch.Timezone = &timezone
	}
	if err := s.repo.UpdateUserProfile(ctx, user.ID, patch); err != nil {
		if isDuplicateError(err) {
			return nil, ErrEmailExists
		}
		return nil, fmt.Errorf("%w: update account: %v", ErrAuthenticationStore, err)
	}
	return account, nil
}

func (s *AuthService) accountFromUser(ctx context.Context, user *model.User) (*Account, error) {
	taskCount, err := s.repo.CountTodos(ctx)
	if err != nil {
		return nil, fmt.Errorf("%w: count todos: %v", ErrAuthenticationStore, err)
	}
	agentSessionCount, err := s.repo.CountAgentSessions(ctx, user.ID)
	if err != nil {
		return nil, fmt.Errorf("%w: count agent sessions: %v", ErrAuthenticationStore, err)
	}
	return &Account{
		ID: user.ID, Name: user.DisplayName, Email: user.Email, Timezone: user.Timezone,
		Avatar:    AvatarPreset{Kind: "preset", Value: "amber"},
		TaskCount: taskCount, AgentSessionCount: agentSessionCount,
	}, nil
}

func (s *AuthService) Login(ctx context.Context, email, password string) (*AuthResult, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if !validEmail(email) || !validPasswordLength(password) {
		return nil, ErrInvalidCredentials
	}
	clientIP := loginClientIPFromContext(ctx)
	if !s.loginLimiter.allow(clientIP, email) {
		return nil, ErrLoginRateLimited
	}
	user, err := s.repo.FindUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// Keep an unknown account on the same single password-verification path.
			if _, err := s.verify(ctx, s.dummyHash, password); err != nil {
				return nil, err
			}
			s.loginLimiter.recordFailure(clientIP, email)
			return nil, ErrInvalidCredentials
		}
		return nil, fmt.Errorf("%w: find user: %v", ErrAuthenticationStore, err)
	}
	valid, err := s.verify(ctx, user.PasswordHash, password)
	if err != nil {
		return nil, err
	}
	if !valid {
		s.loginLimiter.recordFailure(clientIP, email)
		return nil, ErrInvalidCredentials
	}
	account, err := s.accountFromUser(ctx, user)
	if err != nil {
		return nil, err
	}
	result, err := s.createLoginSession(ctx, user, account)
	if err == nil {
		s.loginLimiter.clearAccount(email)
	}
	return result, err
}

func validPasswordLength(password string) bool {
	return len(password) >= 8 && len(password) <= 128
}

func (s *AuthService) hash(ctx context.Context, password string) (string, error) {
	if err := s.acquirePasswordSlot(ctx); err != nil {
		return "", err
	}
	defer s.releasePasswordSlot()
	return s.hashPassword(password)
}

func (s *AuthService) verify(ctx context.Context, encodedHash, password string) (bool, error) {
	if err := s.acquirePasswordSlot(ctx); err != nil {
		return false, err
	}
	defer s.releasePasswordSlot()
	return s.verifyPassword(encodedHash, password), nil
}

func (s *AuthService) acquirePasswordSlot(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return fmt.Errorf("%w: %v", ErrPasswordCancelled, ctx.Err())
	case s.passwordQueue <- struct{}{}:
	default:
		return ErrPasswordBusy
	}
	select {
	case s.passwordSem <- struct{}{}:
		select {
		case <-ctx.Done():
			<-s.passwordSem
			<-s.passwordQueue
			return fmt.Errorf("%w: %v", ErrPasswordCancelled, ctx.Err())
		default:
			return nil
		}
	case <-ctx.Done():
		<-s.passwordQueue
		return fmt.Errorf("%w: %v", ErrPasswordCancelled, ctx.Err())
	}
}

func (s *AuthService) releasePasswordSlot() {
	<-s.passwordSem
	<-s.passwordQueue
}

func (s *AuthService) createLoginSession(ctx context.Context, user *model.User, account *Account) (*AuthResult, error) {
	now := s.now().UTC()
	sessionID := uuid.NewString()
	_, refresh, hash, err := generateRefreshCredential(sessionID)
	if err != nil {
		return nil, err
	}
	session := &model.AuthSession{ID: sessionID, UserID: user.ID, RefreshTokenHash: hash, ExpiresAt: now.Add(s.refreshTTL), LastUsedAt: now}
	access, expiry, err := s.signAccess(user.ID, session.ID, now)
	if err != nil {
		return nil, err
	}
	if err := s.repo.CreateSession(ctx, session); err != nil {
		return nil, fmt.Errorf("%w: create session: %v", ErrAuthenticationStore, err)
	}
	return &AuthResult{Account: account, AccessToken: access, RefreshToken: refresh, AccessExpiry: expiry, RefreshExpiry: session.ExpiresAt}, nil
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
	account, err := s.accountFromUser(ctx, user)
	if err != nil {
		return nil, err
	}
	replacementID := uuid.NewString()
	_, replacementToken, replacementHash, err := generateRefreshCredential(replacementID)
	if err != nil {
		return nil, err
	}
	replacement := &model.AuthSession{ID: replacementID, UserID: user.ID, RefreshTokenHash: replacementHash, ExpiresAt: now.Add(s.refreshTTL), LastUsedAt: now}
	access, expiry, err := s.signAccess(user.ID, replacement.ID, now)
	if err != nil {
		return nil, err
	}
	if err := s.repo.RotateSession(ctx, current.ID, now, replacement); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInvalidCredentials
		}
		return nil, fmt.Errorf("%w: rotate session: %v", ErrAuthenticationStore, err)
	}
	return &AuthResult{Account: account, AccessToken: access, RefreshToken: replacementToken, AccessExpiry: expiry, RefreshExpiry: replacement.ExpiresAt}, nil
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

func (s *AuthService) ValidateAccess(ctx context.Context, raw string) (*AccessClaims, error) {
	claims := &AccessClaims{}
	token, err := jwt.ParseWithClaims(raw, claims, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, ErrInvalidAccessToken
		}
		return s.jwtSecret, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithIssuer(s.issuer), jwt.WithExpirationRequired(), jwt.WithIssuedAt(), jwt.WithTimeFunc(s.now))
	if err != nil || !token.Valid || claims.Subject == "" || claims.SessionID == "" || claims.IssuedAt == nil {
		return nil, ErrInvalidAccessToken
	}
	if _, err := uuid.Parse(claims.Subject); err != nil {
		return nil, ErrInvalidAccessToken
	}
	if _, err := uuid.Parse(claims.SessionID); err != nil {
		return nil, ErrInvalidAccessToken
	}
	// Session state is part of access-token validity. The Agent's Task 6
	// authentication path must perform this same active-session/owner lookup
	// after validating the JWT signature before it accepts a browser Cookie.
	session, err := s.repo.FindActiveSessionByID(ctx, claims.SessionID, s.now().UTC())
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInvalidAccessToken
		}
		return nil, fmt.Errorf("%w: find access session: %v", ErrAuthenticationStore, err)
	}
	if session.UserID != claims.Subject {
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
