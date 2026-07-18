package handler

import (
	"context"
	"errors"
	"net"
	"net/http"
	"time"

	"backend/internal/middleware"
	"backend/internal/service"

	"github.com/gin-gonic/gin"
)

const maxAuthJSONBodyBytes int64 = 16 * 1024

type AuthServiceInterface interface {
	Register(ctx context.Context, req service.RegisterRequest) (*service.Account, error)
	Login(ctx context.Context, email, password string) (*service.AuthResult, error)
	Refresh(ctx context.Context, refreshToken string) (*service.AuthResult, error)
	Logout(ctx context.Context, refreshToken string) error
	GetAccount(ctx context.Context, userID string) (*service.Account, error)
	UpdateAccount(ctx context.Context, userID string, req service.AccountUpdateRequest) (*service.Account, error)
	middleware.AccessValidator
}

type CookieConfig struct {
	AccessName  string
	RefreshName string
	Secure      bool
	Domain      string
}

type AuthHandler struct {
	svc     AuthServiceInterface
	cookies CookieConfig
}

func NewAuthHandler(svc AuthServiceInterface, cookies CookieConfig) *AuthHandler {
	if cookies.AccessName == "" {
		cookies.AccessName = "todolist_access"
	}
	if cookies.RefreshName == "" {
		cookies.RefreshName = "todolist_refresh"
	}
	return &AuthHandler{svc: svc, cookies: cookies}
}

func RegisterAuthRoutes(router *gin.Engine, h *AuthHandler, allowedOrigins string) {
	group := router.Group("/api/auth")
	group.Use(middleware.OriginGuard(allowedOrigins))
	group.POST("/register", h.Register)
	group.POST("/login", h.Login)
	group.POST("/refresh", h.Refresh)
	group.POST("/logout", h.Logout)
	group.GET("/me", middleware.Authenticate(h.cookies.AccessName, h.svc), h.Me)
	group.PATCH("/me", middleware.Authenticate(h.cookies.AccessName, h.svc), h.UpdateMe)
}

type registerRequest struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *AuthHandler) Register(c *gin.Context) {
	var request registerRequest
	if !bindAuthJSON(c, &request) {
		return
	}
	account, err := h.svc.Register(c.Request.Context(), service.RegisterRequest{Name: request.Name, Email: request.Email, Password: request.Password})
	if err != nil {
		h.writeServiceError(c, err)
		return
	}
	success(c, http.StatusCreated, account)
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *AuthHandler) Login(c *gin.Context) {
	var request loginRequest
	if !bindAuthJSON(c, &request) {
		return
	}
	result, err := h.svc.Login(service.WithLoginClientIP(c.Request.Context(), requestClientIP(c.Request)), request.Email, request.Password)
	if err != nil {
		h.writeServiceError(c, err)
		return
	}
	h.setCredentials(c, result)
	success(c, http.StatusOK, result.Account)
}

func (h *AuthHandler) Refresh(c *gin.Context) {
	refresh, err := c.Cookie(h.cookies.RefreshName)
	if err != nil || refresh == "" {
		errorResponse(c, http.StatusUnauthorized, 40102, "邮箱或密码不正确或登录已失效")
		return
	}
	result, err := h.svc.Refresh(c.Request.Context(), refresh)
	if err != nil {
		h.writeServiceError(c, err)
		return
	}
	h.setCredentials(c, result)
	success(c, http.StatusOK, result.Account)
}

func (h *AuthHandler) Logout(c *gin.Context) {
	// Clear browser credentials before calling the store. A failed revoke must
	// never leave a usable Cookie in the response merely because persistence is
	// temporarily unavailable.
	h.clearCredentials(c)
	if refresh, err := c.Cookie(h.cookies.RefreshName); err == nil && refresh != "" {
		if err := h.svc.Logout(c.Request.Context(), refresh); err != nil && !errors.Is(err, service.ErrInvalidCredentials) {
			h.writeServiceError(c, err)
			return
		}
	}
	c.Status(http.StatusNoContent)
}

func (h *AuthHandler) Me(c *gin.Context) {
	principal, ok := middleware.PrincipalFromContext(c)
	if !ok {
		errorResponse(c, http.StatusUnauthorized, 40101, "未登录或登录已失效")
		return
	}
	account, err := h.svc.GetAccount(c.Request.Context(), principal.UserID)
	if err != nil {
		h.writeServiceError(c, err)
		return
	}
	success(c, http.StatusOK, account)
}

type updateAccountRequest struct {
	Name     *string `json:"name"`
	Email    *string `json:"email"`
	Timezone *string `json:"timezone"`
}

func (h *AuthHandler) UpdateMe(c *gin.Context) {
	principal, ok := middleware.PrincipalFromContext(c)
	if !ok {
		errorResponse(c, http.StatusUnauthorized, 40101, "未登录或登录已失效")
		return
	}
	var request updateAccountRequest
	if !bindAuthJSON(c, &request) {
		return
	}
	account, err := h.svc.UpdateAccount(c.Request.Context(), principal.UserID, service.AccountUpdateRequest{
		Name: request.Name, Email: request.Email, Timezone: request.Timezone,
	})
	if err != nil {
		h.writeServiceError(c, err)
		return
	}
	success(c, http.StatusOK, account)
}

func (h *AuthHandler) setCredentials(c *gin.Context, result *service.AuthResult) {
	h.setCookie(c, h.cookies.AccessName, result.AccessToken, result.AccessExpiry)
	h.setCookie(c, h.cookies.RefreshName, result.RefreshToken, result.RefreshExpiry)
}

func (h *AuthHandler) setCookie(c *gin.Context, name, value string, expiry time.Time) {
	maxAge := int(time.Until(expiry).Seconds())
	if maxAge < 1 {
		maxAge = 1
	}
	http.SetCookie(c.Writer, &http.Cookie{
		Name: name, Value: value, Path: "/", Domain: h.cookies.Domain,
		Expires: expiry, MaxAge: maxAge, HttpOnly: true, Secure: h.cookies.Secure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (h *AuthHandler) clearCredentials(c *gin.Context) {
	for _, name := range []string{h.cookies.AccessName, h.cookies.RefreshName} {
		http.SetCookie(c.Writer, &http.Cookie{
			Name: name, Value: "", Path: "/", Domain: h.cookies.Domain,
			Expires: time.Unix(1, 0).UTC(), MaxAge: -1, HttpOnly: true, Secure: h.cookies.Secure,
			SameSite: http.SameSiteLaxMode,
		})
	}
}

func (h *AuthHandler) writeServiceError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrLoginRateLimited), errors.Is(err, service.ErrPasswordBusy):
		errorResponse(c, http.StatusTooManyRequests, 42901, "请求过于频繁，请稍后重试")
	case errors.Is(err, service.ErrPasswordCancelled):
		errorResponse(c, http.StatusServiceUnavailable, 50301, "服务暂时不可用，请稍后重试")
	case errors.Is(err, service.ErrInvalidInput):
		errorResponse(c, http.StatusBadRequest, 40001, "请求参数不合法")
	case errors.Is(err, service.ErrEmailExists):
		errorResponse(c, http.StatusConflict, 40901, "邮箱已被使用")
	case errors.Is(err, service.ErrInvalidCredentials), errors.Is(err, service.ErrInvalidAccessToken):
		errorResponse(c, http.StatusUnauthorized, 40102, "邮箱或密码不正确或登录已失效")
	default:
		errorResponse(c, http.StatusInternalServerError, 50001, "服务器内部错误")
	}
}

func bindAuthJSON(c *gin.Context, target any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxAuthJSONBodyBytes)
	if err := c.ShouldBindJSON(target); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			errorResponse(c, http.StatusRequestEntityTooLarge, 41301, "请求体过大")
		} else {
			errorResponse(c, http.StatusBadRequest, 40001, "请求参数格式错误")
		}
		return false
	}
	return true
}

// requestClientIP deliberately uses the direct transport peer. Trusting
// X-Forwarded-For without an explicitly configured trusted-proxy boundary
// would let callers rotate headers to evade failed-login throttling.
func requestClientIP(request *http.Request) string {
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	return request.RemoteAddr
}
