package middleware

import (
	"net/http"
	"net/url"
	"strings"

	"backend/internal/service"

	"github.com/gin-gonic/gin"
)

const PrincipalKey = "auth.principal"

type Principal struct {
	UserID    string `json:"userID"`
	SessionID string `json:"sessionID"`
}

type AccessValidator interface {
	ValidateAccess(string) (*service.AccessClaims, error)
}

func Authenticate(accessCookieName string, validator AccessValidator) gin.HandlerFunc {
	return func(c *gin.Context) {
		raw, err := c.Cookie(accessCookieName)
		if err != nil || raw == "" {
			unauthorized(c)
			return
		}
		claims, err := validator.ValidateAccess(raw)
		if err != nil {
			unauthorized(c)
			return
		}
		c.Set(PrincipalKey, Principal{UserID: claims.Subject, SessionID: claims.SessionID})
		c.Next()
	}
}

func PrincipalFromContext(c *gin.Context) (Principal, bool) {
	value, exists := c.Get(PrincipalKey)
	if !exists {
		return Principal{}, false
	}
	principal, ok := value.(Principal)
	return principal, ok
}

func unauthorized(c *gin.Context) {
	c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
		"code": 40101, "message": "未登录或登录已失效", "data": nil,
	})
}

// OriginGuard protects Cookie-authenticated state-changing routes from CSRF.
// Browsers that send Origin must match an explicitly configured origin.
// Requests without Origin remain supported for non-browser clients; SameSite=Lax
// Cookies provide the browser fallback for those requests.
func OriginGuard(rawAllowedOrigins string) gin.HandlerFunc {
	allowed := parseAllowedOrigins(rawAllowedOrigins)
	return func(c *gin.Context) {
		if !stateChanging(c.Request.Method) {
			c.Next()
			return
		}
		origin := c.GetHeader("Origin")
		if origin == "" {
			c.Next()
			return
		}
		normalized, ok := normalizeOrigin(origin)
		if !ok {
			forbidden(c)
			return
		}
		if _, ok := allowed[normalized]; !ok {
			forbidden(c)
			return
		}
		c.Next()
	}
}

func parseAllowedOrigins(raw string) map[string]struct{} {
	allowed := make(map[string]struct{})
	for _, item := range strings.Split(raw, ",") {
		if normalized, ok := normalizeOrigin(strings.TrimSpace(item)); ok {
			allowed[normalized] = struct{}{}
		}
	}
	return allowed
}

func normalizeOrigin(raw string) (string, bool) {
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", false
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return "", false
	}
	return strings.ToLower(parsed.Scheme) + "://" + strings.ToLower(parsed.Host), true
}

func stateChanging(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

func forbidden(c *gin.Context) {
	c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
		"code": 40301, "message": "请求来源不受信任", "data": nil,
	})
}
