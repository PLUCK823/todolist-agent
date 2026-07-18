package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"backend/internal/database"
	"backend/internal/handler"
	"backend/internal/model"
	"backend/internal/repository"
	"backend/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const handlerJWTSecret = "handler-test-secret-that-is-at-least-32-bytes"

type authFixture struct {
	router      *gin.Engine
	db          *gorm.DB
	accessName  string
	refreshName string
}

func setupAuthFixture(t *testing.T, cookieConfig handler.CookieConfig) authFixture {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := database.InitDB(database.Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatalf("InitDB() failed: %v", err)
	}
	if err := db.Exec(`CREATE TABLE agent_sessions (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL)`).Error; err != nil {
		t.Fatalf("create agent_sessions fixture: %v", err)
	}
	repo := repository.NewAuthRepository(db)
	svc, err := service.NewAuthService(repo, service.AuthConfig{
		JWTSecret: []byte(handlerJWTSecret), AccessTTL: 15 * time.Minute, RefreshTTL: 24 * time.Hour,
	})
	if err != nil {
		t.Fatalf("NewAuthService() failed: %v", err)
	}
	router := gin.New()
	if cookieConfig.AccessName == "" {
		cookieConfig.AccessName = "todolist_access"
	}
	if cookieConfig.RefreshName == "" {
		cookieConfig.RefreshName = "todolist_refresh"
	}
	handler.RegisterAuthRoutes(router, handler.NewAuthHandler(svc, cookieConfig), "http://localhost:3000,https://app.example.com")
	return authFixture{router: router, db: db, accessName: cookieConfig.AccessName, refreshName: cookieConfig.RefreshName}
}

func jsonCall(router http.Handler, method, path, body, origin string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if origin != "" {
		request.Header.Set("Origin", origin)
	}
	for _, cookie := range cookies {
		request.AddCookie(cookie)
	}
	router.ServeHTTP(recorder, request)
	return recorder
}

func responseCookie(t *testing.T, response *httptest.ResponseRecorder, name string) *http.Cookie {
	t.Helper()
	for _, cookie := range response.Result().Cookies() {
		if cookie.Name == name {
			return cookie
		}
	}
	t.Fatalf("response does not contain Cookie %q", name)
	return nil
}

func responseData(t *testing.T, response *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var envelope struct {
		Code int            `json:"code"`
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response %q: %v", response.Body.String(), err)
	}
	if envelope.Code != 0 {
		t.Fatalf("unexpected error envelope: %s", response.Body.String())
	}
	return envelope.Data
}

func registerAndLogin(t *testing.T, fixture authFixture, name, email string) (map[string]any, *http.Cookie, *http.Cookie) {
	t.Helper()
	register := jsonCall(fixture.router, http.MethodPost, "/api/auth/register",
		`{"name":"`+name+`","email":"`+email+`","password":"password8"}`, "http://localhost:3000")
	if register.Code != http.StatusCreated {
		t.Fatalf("register failed: %d %s", register.Code, register.Body.String())
	}
	if len(register.Result().Cookies()) != 0 {
		t.Fatal("register unexpectedly authenticated the account")
	}
	login := jsonCall(fixture.router, http.MethodPost, "/api/auth/login",
		`{"email":"`+email+`","password":"password8"}`, "http://localhost:3000")
	if login.Code != http.StatusOK {
		t.Fatalf("login failed: %d %s", login.Code, login.Body.String())
	}
	return responseData(t, login), responseCookie(t, login, fixture.accessName), responseCookie(t, login, fixture.refreshName)
}

func TestAuthLifecycleUsesHttpOnlySecureCookiesAndPublicAccountShape(t *testing.T) {
	fixture := setupAuthFixture(t, handler.CookieConfig{
		AccessName: "todolist_access", RefreshName: "todolist_refresh", Secure: true, Domain: "example.com",
	})
	account, access, refresh := registerAndLogin(t, fixture, "Alice", "alice@example.com")
	for _, cookie := range []*http.Cookie{access, refresh} {
		if !cookie.HttpOnly || !cookie.Secure || cookie.Path != "/" || cookie.Domain != "example.com" || cookie.SameSite != http.SameSiteLaxMode || cookie.MaxAge <= 0 || cookie.Expires.IsZero() {
			t.Fatalf("unsafe Cookie policy for %s: %#v", cookie.Name, cookie)
		}
	}
	for _, key := range []string{"id", "name", "email", "timezone", "avatar", "taskCount", "agentSessionCount"} {
		if _, ok := account[key]; !ok {
			t.Fatalf("account response missing %q: %#v", key, account)
		}
	}
	for _, forbidden := range []string{"password", "hash", "token", "secret"} {
		if strings.Contains(strings.ToLower(string(responseDataJSON(t, account))), forbidden) {
			t.Fatalf("public account leaked %q: %#v", forbidden, account)
		}
	}
	avatar, ok := account["avatar"].(map[string]any)
	if !ok || avatar["kind"] != "preset" || avatar["value"] != "amber" {
		t.Fatalf("unexpected stable avatar preset: %#v", account["avatar"])
	}

	me := jsonCall(fixture.router, http.MethodGet, "/api/auth/me", "", "", access)
	if me.Code != http.StatusOK {
		t.Fatalf("GET /me failed: %d %s", me.Code, me.Body.String())
	}
	if responseData(t, me)["id"] != account["id"] {
		t.Fatal("GET /me returned another account")
	}
}

func responseDataJSON(t *testing.T, value any) []byte {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal value: %v", err)
	}
	return encoded
}

func TestAuthRegisterDuplicateAndLoginBadPasswordUseSafeErrors(t *testing.T) {
	fixture := setupAuthFixture(t, handler.CookieConfig{AccessName: "access", RefreshName: "refresh"})
	register := `{"name":"Alice","email":"alice@example.com","password":"password8"}`
	if got := jsonCall(fixture.router, http.MethodPost, "/api/auth/register", register, "http://localhost:3000"); got.Code != http.StatusCreated {
		t.Fatalf("first register failed: %d %s", got.Code, got.Body.String())
	}
	duplicate := jsonCall(fixture.router, http.MethodPost, "/api/auth/register", register, "http://localhost:3000")
	if duplicate.Code != http.StatusConflict {
		t.Fatalf("duplicate register: expected 409, got %d %s", duplicate.Code, duplicate.Body.String())
	}
	for _, email := range []string{"alice@example.com", "missing@example.com"} {
		bad := jsonCall(fixture.router, http.MethodPost, "/api/auth/login",
			`{"email":"`+email+`","password":"wrong-password"}`, "http://localhost:3000")
		if bad.Code != http.StatusUnauthorized || !strings.Contains(bad.Body.String(), `"code":40102`) {
			t.Fatalf("unsafe login error for %s: %d %s", email, bad.Code, bad.Body.String())
		}
	}
}

func TestAuthRefreshRotatesAtomicallyAndOldCookieCannotBeReused(t *testing.T) {
	fixture := setupAuthFixture(t, handler.CookieConfig{AccessName: "todolist_access", RefreshName: "todolist_refresh"})
	_, _, oldRefresh := registerAndLogin(t, fixture, "Alice", "alice@example.com")
	rotated := jsonCall(fixture.router, http.MethodPost, "/api/auth/refresh", "", "http://localhost:3000", oldRefresh)
	if rotated.Code != http.StatusOK {
		t.Fatalf("refresh failed: %d %s", rotated.Code, rotated.Body.String())
	}
	newAccess := responseCookie(t, rotated, "todolist_access")
	newRefresh := responseCookie(t, rotated, "todolist_refresh")
	if newRefresh.Value == oldRefresh.Value {
		t.Fatal("refresh endpoint reused the old credential")
	}
	if reused := jsonCall(fixture.router, http.MethodPost, "/api/auth/refresh", "", "http://localhost:3000", oldRefresh); reused.Code != http.StatusUnauthorized {
		t.Fatalf("old refresh Cookie was reusable: %d %s", reused.Code, reused.Body.String())
	}
	if me := jsonCall(fixture.router, http.MethodGet, "/api/auth/me", "", "", newAccess); me.Code != http.StatusOK {
		t.Fatalf("rotated access Cookie was invalid: %d %s", me.Code, me.Body.String())
	}
}

func TestAuthLogoutRevokesRefreshAndClearsMatchingCookieAttributes(t *testing.T) {
	fixture := setupAuthFixture(t, handler.CookieConfig{AccessName: "access", RefreshName: "refresh", Secure: true, Domain: "example.com"})
	_, access, refresh := registerAndLogin(t, fixture, "Alice", "alice@example.com")
	logout := jsonCall(fixture.router, http.MethodPost, "/api/auth/logout", "", "http://localhost:3000", access, refresh)
	if logout.Code != http.StatusNoContent {
		t.Fatalf("logout failed: %d %s", logout.Code, logout.Body.String())
	}
	for _, name := range []string{"access", "refresh"} {
		cookie := responseCookie(t, logout, name)
		if cookie.MaxAge >= 0 || cookie.Value != "" || !cookie.HttpOnly || !cookie.Secure || cookie.Domain != "example.com" || cookie.Path != "/" || cookie.SameSite != http.SameSiteLaxMode {
			t.Fatalf("Cookie %s was not safely cleared: %#v", name, cookie)
		}
	}
	if me := jsonCall(fixture.router, http.MethodGet, "/api/auth/me", "", ""); me.Code != http.StatusUnauthorized {
		t.Fatalf("client after Cookie deletion remained authenticated: %d %s", me.Code, me.Body.String())
	}
	if reused := jsonCall(fixture.router, http.MethodPost, "/api/auth/refresh", "", "http://localhost:3000", refresh); reused.Code != http.StatusUnauthorized {
		t.Fatalf("logout did not revoke refresh: %d %s", reused.Code, reused.Body.String())
	}
}

func TestAuthLogoutClearsBothCookiesForInvalidRefreshCredential(t *testing.T) {
	fixture := setupAuthFixture(t, handler.CookieConfig{AccessName: "access", RefreshName: "refresh", Secure: true, Domain: "example.com"})
	response := jsonCall(fixture.router, http.MethodPost, "/api/auth/logout", "", "http://localhost:3000",
		&http.Cookie{Name: "access", Value: "stale"}, &http.Cookie{Name: "refresh", Value: "malformed"})
	if response.Code != http.StatusNoContent {
		t.Fatalf("invalid logout expected 204, got %d: %s", response.Code, response.Body.String())
	}
	for _, name := range []string{"access", "refresh"} {
		cookie := responseCookie(t, response, name)
		if cookie.Value != "" || cookie.MaxAge >= 0 || !cookie.HttpOnly || !cookie.Secure || cookie.Domain != "example.com" || cookie.Path != "/" || cookie.SameSite != http.SameSiteLaxMode {
			t.Fatalf("Cookie %s was not cleared for invalid refresh: %#v", name, cookie)
		}
	}
}

func TestAuthPatchPersistsProfileCountsAndRejectsDuplicateEmail(t *testing.T) {
	fixture := setupAuthFixture(t, handler.CookieConfig{AccessName: "access", RefreshName: "refresh"})
	first, firstAccess, _ := registerAndLogin(t, fixture, "Alice", "alice@example.com")
	_, _, _ = registerAndLogin(t, fixture, "Bob", "bob@example.com")
	if err := fixture.db.Create(&model.Todo{Title: "Task"}).Error; err != nil {
		t.Fatalf("create todo fixture: %v", err)
	}
	if err := fixture.db.Exec("INSERT INTO agent_sessions (id, owner_id, title) VALUES (?, ?, ?)", uuid.NewString(), first["id"], "Session").Error; err != nil {
		t.Fatalf("create agent session fixture: %v", err)
	}

	patch := jsonCall(fixture.router, http.MethodPatch, "/api/auth/me",
		`{"name":" Alice Updated ","email":"alice2@example.com","timezone":" Europe/Paris ","password":"attacker","id":"other"}`,
		"https://app.example.com", firstAccess)
	if patch.Code != http.StatusOK {
		t.Fatalf("PATCH /me failed: %d %s", patch.Code, patch.Body.String())
	}
	updated := responseData(t, patch)
	if updated["name"] != "Alice Updated" || updated["email"] != "alice2@example.com" || updated["timezone"] != "Europe/Paris" || updated["id"] != first["id"] {
		t.Fatalf("unexpected profile update: %#v", updated)
	}
	if updated["taskCount"] != float64(1) || updated["agentSessionCount"] != float64(1) {
		t.Fatalf("unexpected account counts: %#v", updated)
	}

	duplicate := jsonCall(fixture.router, http.MethodPatch, "/api/auth/me", `{"email":"bob@example.com"}`, "http://localhost:3000", firstAccess)
	if duplicate.Code != http.StatusConflict {
		t.Fatalf("duplicate profile email: expected 409, got %d %s", duplicate.Code, duplicate.Body.String())
	}
	me := jsonCall(fixture.router, http.MethodGet, "/api/auth/me", "", "", firstAccess)
	if responseData(t, me)["email"] != "alice2@example.com" {
		t.Fatal("failed PATCH partially changed profile")
	}
}

func TestAuthStateChangesRejectUntrustedOrigin(t *testing.T) {
	fixture := setupAuthFixture(t, handler.CookieConfig{AccessName: "access", RefreshName: "refresh"})
	for _, path := range []string{"/api/auth/register", "/api/auth/login", "/api/auth/refresh", "/api/auth/logout"} {
		response := jsonCall(fixture.router, http.MethodPost, path, `{}`, "https://app.example.com.attacker.test")
		if response.Code != http.StatusForbidden {
			t.Fatalf("%s accepted untrusted Origin: %d %s", path, response.Code, response.Body.String())
		}
	}
	response := jsonCall(fixture.router, http.MethodPatch, "/api/auth/me", `{}`, "https://evil.example")
	if response.Code != http.StatusForbidden {
		t.Fatalf("PATCH /me accepted untrusted Origin: %d %s", response.Code, response.Body.String())
	}
}

func TestAuthJSONBodiesHaveAStrictSizeLimit(t *testing.T) {
	fixture := setupAuthFixture(t, handler.CookieConfig{AccessName: "access", RefreshName: "refresh"})
	_, access, _ := registerAndLogin(t, fixture, "Alice", "alice@example.com")
	oversized := `{"name":"` + strings.Repeat("x", 16*1024) + `"}`
	for _, tc := range []struct {
		method, path string
		cookies      []*http.Cookie
	}{
		{http.MethodPost, "/api/auth/register", nil},
		{http.MethodPost, "/api/auth/login", nil},
		{http.MethodPatch, "/api/auth/me", []*http.Cookie{access}},
	} {
		response := jsonCall(fixture.router, tc.method, tc.path, oversized, "http://localhost:3000", tc.cookies...)
		if response.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("%s %s: expected 413, got %d: %s", tc.method, tc.path, response.Code, response.Body.String())
		}
	}
}

func TestAuthRegistrationReturnsServerErrorWhenAgentSessionStoreIsMissing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := database.InitDB(database.Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatalf("InitDB() failed: %v", err)
	}
	svc, err := service.NewAuthService(repository.NewAuthRepository(db), service.AuthConfig{JWTSecret: []byte(handlerJWTSecret)})
	if err != nil {
		t.Fatalf("NewAuthService() failed: %v", err)
	}
	router := gin.New()
	handler.RegisterAuthRoutes(router, handler.NewAuthHandler(svc, handler.CookieConfig{}), "http://localhost:3000")
	response := jsonCall(router, http.MethodPost, "/api/auth/register", `{"name":"Alice","email":"alice@example.com","password":"password8"}`, "http://localhost:3000")
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("missing agent_sessions expected 500, got %d: %s", response.Code, response.Body.String())
	}
}

type logoutFailureService struct{}

func (logoutFailureService) Register(context.Context, service.RegisterRequest) (*service.Account, error) {
	return nil, service.ErrAuthenticationStore
}
func (logoutFailureService) Login(context.Context, string, string) (*service.AuthResult, error) {
	return nil, service.ErrAuthenticationStore
}
func (logoutFailureService) Refresh(context.Context, string) (*service.AuthResult, error) {
	return nil, service.ErrAuthenticationStore
}
func (logoutFailureService) Logout(context.Context, string) error {
	return service.ErrAuthenticationStore
}
func (logoutFailureService) GetAccount(context.Context, string) (*service.Account, error) {
	return nil, service.ErrAuthenticationStore
}
func (logoutFailureService) UpdateAccount(context.Context, string, service.AccountUpdateRequest) (*service.Account, error) {
	return nil, service.ErrAuthenticationStore
}
func (logoutFailureService) ValidateAccess(string) (*service.AccessClaims, error) {
	return nil, service.ErrInvalidAccessToken
}

type loginErrorService struct {
	logoutFailureService
	err error
}

func (s loginErrorService) Login(context.Context, string, string) (*service.AuthResult, error) {
	return nil, s.err
}

func TestAuthLoginMapsBoundedPasswordErrorsWithoutCredentialDisclosure(t *testing.T) {
	for name, tc := range map[string]struct {
		err    error
		status int
	}{
		"rate limited": {service.ErrLoginRateLimited, http.StatusTooManyRequests},
		"busy":         {service.ErrPasswordBusy, http.StatusTooManyRequests},
		"cancelled":    {service.ErrPasswordCancelled, http.StatusServiceUnavailable},
	} {
		t.Run(name, func(t *testing.T) {
			gin.SetMode(gin.TestMode)
			router := gin.New()
			handler.RegisterAuthRoutes(router, handler.NewAuthHandler(loginErrorService{err: tc.err}, handler.CookieConfig{}), "http://localhost:3000")
			response := jsonCall(router, http.MethodPost, "/api/auth/login", `{"email":"alice@example.com","password":"password8"}`, "http://localhost:3000")
			if response.Code != tc.status || strings.Contains(strings.ToLower(response.Body.String()), "alice") {
				t.Fatalf("Login() error mapping unsafe: %d %s", response.Code, response.Body.String())
			}
		})
	}
}

func TestAuthLogoutClearsBothCookiesWhenSessionStoreFails(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	handler.RegisterAuthRoutes(router, handler.NewAuthHandler(logoutFailureService{}, handler.CookieConfig{
		AccessName: "access", RefreshName: "refresh", Secure: true, Domain: "example.com",
	}), "http://localhost:3000")
	response := jsonCall(router, http.MethodPost, "/api/auth/logout", "", "http://localhost:3000",
		&http.Cookie{Name: "access", Value: "access-value"}, &http.Cookie{Name: "refresh", Value: "refresh-value"})
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("logout store error expected 500, got %d: %s", response.Code, response.Body.String())
	}
	for _, name := range []string{"access", "refresh"} {
		cookie := responseCookie(t, response, name)
		if cookie.Value != "" || cookie.MaxAge >= 0 || !cookie.HttpOnly || !cookie.Secure || cookie.Domain != "example.com" || cookie.Path != "/" || cookie.SameSite != http.SameSiteLaxMode {
			t.Fatalf("Cookie %s was not cleared after logout store failure: %#v", name, cookie)
		}
	}
}
