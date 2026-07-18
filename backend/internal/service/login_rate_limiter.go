package service

import (
	"context"
	"strings"
	"sync"
	"time"
)

type loginClientIPContextKey struct{}

// WithLoginClientIP attaches the transport-derived client IP to Login. Keeping
// it in context avoids making callers forge a separate identity parameter.
func WithLoginClientIP(ctx context.Context, clientIP string) context.Context {
	return context.WithValue(ctx, loginClientIPContextKey{}, strings.TrimSpace(clientIP))
}

func loginClientIPFromContext(ctx context.Context) string {
	if clientIP, ok := ctx.Value(loginClientIPContextKey{}).(string); ok && clientIP != "" && len(clientIP) <= 64 {
		return clientIP
	}
	return "unknown"
}

type loginFailure struct {
	count   int
	started time.Time
	seen    time.Time
}

// loginFailureLimiter is deliberately small and process-local: it bounds
// expensive password checks before they reach Argon2 while never retaining
// unbounded attacker-controlled account strings.
type loginFailureLimiter struct {
	mu           sync.Mutex
	now          func() time.Time
	window       time.Duration
	ipLimit      int
	accountLimit int
	capacity     int
	ip           map[string]loginFailure
	account      map[string]loginFailure
}

func newLoginFailureLimiter(now func() time.Time, window time.Duration, ipLimit, accountLimit, capacity int) *loginFailureLimiter {
	return &loginFailureLimiter{
		now: now, window: window, ipLimit: ipLimit, accountLimit: accountLimit, capacity: capacity,
		ip: make(map[string]loginFailure), account: make(map[string]loginFailure),
	}
}

func (l *loginFailureLimiter) allow(clientIP, account string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now().UTC()
	l.cleanupLocked(now)
	return !atLimit(l.ip[clientIP], now, l.window, l.ipLimit) && !atLimit(l.account[account], now, l.window, l.accountLimit)
}

func (l *loginFailureLimiter) recordFailure(clientIP, account string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now().UTC()
	l.cleanupLocked(now)
	l.recordLocked(l.ip, clientIP, now)
	l.recordLocked(l.account, account, now)
}

func (l *loginFailureLimiter) clearAccount(account string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.account, account)
}

func atLimit(failure loginFailure, now time.Time, window time.Duration, limit int) bool {
	return failure.count >= limit && now.Sub(failure.started) < window
}

func (l *loginFailureLimiter) recordLocked(entries map[string]loginFailure, key string, now time.Time) {
	failure := entries[key]
	if failure.started.IsZero() || now.Sub(failure.started) >= l.window {
		failure = loginFailure{started: now}
	}
	failure.count++
	failure.seen = now
	entries[key] = failure
	l.evictLocked(entries)
}

func (l *loginFailureLimiter) cleanupLocked(now time.Time) {
	for _, entries := range []map[string]loginFailure{l.ip, l.account} {
		for key, failure := range entries {
			if now.Sub(failure.started) >= l.window {
				delete(entries, key)
			}
		}
	}
}

func (l *loginFailureLimiter) evictLocked(entries map[string]loginFailure) {
	for len(entries) > l.capacity {
		var oldestKey string
		var oldest time.Time
		for key, failure := range entries {
			if oldest.IsZero() || failure.seen.Before(oldest) {
				oldestKey, oldest = key, failure.seen
			}
		}
		delete(entries, oldestKey)
	}
}
