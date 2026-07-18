package service

import (
	"testing"
	"time"
)

func TestLoginFailureLimiterExpiresAndBoundsBothKeySpaces(t *testing.T) {
	now := time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC)
	limiter := newLoginFailureLimiter(func() time.Time { return now }, time.Minute, 1, 1, 1)
	limiter.recordFailure("203.0.113.1", "first@example.com")
	limiter.recordFailure("203.0.113.2", "second@example.com")
	if len(limiter.ip) > 1 || len(limiter.account) > 1 {
		t.Fatalf("limiter exceeded its bounded capacity: ips=%d accounts=%d", len(limiter.ip), len(limiter.account))
	}
	now = now.Add(time.Minute)
	if !limiter.allow("203.0.113.2", "second@example.com") {
		t.Fatal("expired failures still throttled login")
	}
	if len(limiter.ip) != 0 || len(limiter.account) != 0 {
		t.Fatalf("expired failures were not cleaned: ips=%d accounts=%d", len(limiter.ip), len(limiter.account))
	}
}
