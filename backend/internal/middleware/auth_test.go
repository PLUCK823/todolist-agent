package middleware_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"backend/internal/middleware"
	"backend/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

type accessValidatorFunc func(context.Context, string) (*service.AccessClaims, error)

func (fn accessValidatorFunc) ValidateAccess(ctx context.Context, token string) (*service.AccessClaims, error) {
	return fn(ctx, token)
}

func TestAuthMiddlewareRequiresValidAccessCookieAndStoresPrincipal(t *testing.T) {
	gin.SetMode(gin.TestMode)
	validator := accessValidatorFunc(func(_ context.Context, token string) (*service.AccessClaims, error) {
		if token != "valid-access" {
			return nil, service.ErrInvalidAccessToken
		}
		return &service.AccessClaims{SessionID: "session-id", RegisteredClaims: jwt.RegisteredClaims{
			Subject: "user-id", ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		}}, nil
	})
	router := gin.New()
	router.Use(middleware.Authenticate("todolist_access", validator))
	router.GET("/private", func(c *gin.Context) {
		principal, ok := middleware.PrincipalFromContext(c)
		if !ok {
			c.Status(http.StatusInternalServerError)
			return
		}
		c.JSON(http.StatusOK, principal)
	})

	for name, cookie := range map[string]*http.Cookie{"missing": nil, "invalid": {Name: "todolist_access", Value: "bad"}} {
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/private", nil)
		if cookie != nil {
			req.AddCookie(cookie)
		}
		router.ServeHTTP(recorder, req)
		if recorder.Code != http.StatusUnauthorized || recorder.Body.String() != `{"code":40101,"data":null,"message":"未登录或登录已失效"}` {
			t.Fatalf("%s: unexpected response %d %s", name, recorder.Code, recorder.Body.String())
		}
	}

	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/private", nil)
	req.AddCookie(&http.Cookie{Name: "todolist_access", Value: "valid-access"})
	router.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusOK || recorder.Body.String() != `{"userID":"user-id","sessionID":"session-id"}` {
		t.Fatalf("unexpected authenticated response %d %s", recorder.Code, recorder.Body.String())
	}
}

func TestAuthMiddlewareMapsSessionStoreFailuresToServiceUnavailable(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(middleware.Authenticate("access", accessValidatorFunc(func(context.Context, string) (*service.AccessClaims, error) {
		return nil, service.ErrAuthenticationStore
	})))
	router.GET("/private", func(c *gin.Context) { c.Status(http.StatusNoContent) })
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/private", nil)
	req.AddCookie(&http.Cookie{Name: "access", Value: "validly-shaped-token"})
	router.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusServiceUnavailable || recorder.Body.String() != `{"code":50301,"data":null,"message":"认证服务暂时不可用"}` {
		t.Fatalf("unexpected store failure response %d %s", recorder.Code, recorder.Body.String())
	}
}

func TestOriginGuardFailsClosedAndUsesExactAllowedOrigins(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(middleware.OriginGuard(" http://localhost:3000, https://app.example.com "))
	router.POST("/state", func(c *gin.Context) { c.Status(http.StatusNoContent) })
	router.GET("/read", func(c *gin.Context) { c.Status(http.StatusNoContent) })

	for _, tc := range []struct {
		name, method, origin string
		expected             int
	}{
		{"exact", http.MethodPost, "https://app.example.com", http.StatusNoContent},
		{"prefix attack", http.MethodPost, "https://app.example.com.attacker.test", http.StatusForbidden},
		{"unknown", http.MethodPost, "https://evil.example", http.StatusForbidden},
		{"missing origin", http.MethodPost, "", http.StatusForbidden},
		{"safe method", http.MethodGet, "https://evil.example", http.StatusNoContent},
	} {
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(tc.method, map[bool]string{true: "/read", false: "/state"}[tc.method == http.MethodGet], nil)
		if tc.origin != "" {
			req.Header.Set("Origin", tc.origin)
		}
		router.ServeHTTP(recorder, req)
		if recorder.Code != tc.expected {
			t.Fatalf("%s: expected %d, got %d (%s)", tc.name, tc.expected, recorder.Code, recorder.Body.String())
		}
	}
}
