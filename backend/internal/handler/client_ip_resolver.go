package handler

import (
	"fmt"
	"net"
	"net/http"
	"strings"
)

// ClientIPResolver resolves the address used for failed-login throttling.
// It is intentionally separate from CookieConfig because proxy trust is a
// transport concern rather than a Cookie policy.
type ClientIPResolver interface {
	Resolve(*http.Request) string
}

type AuthHandlerOptions struct {
	ClientIPResolver ClientIPResolver
}

type trustedProxyClientIPResolver struct {
	trusted []*net.IPNet
}

// NewTrustedProxyClientIPResolver accepts only CIDRs explicitly operated by
// this deployment. An empty list is safe: it always uses RemoteAddr.
func NewTrustedProxyClientIPResolver(rawCIDRs string) (ClientIPResolver, error) {
	resolver := &trustedProxyClientIPResolver{}
	for _, raw := range strings.Split(rawCIDRs, ",") {
		cidr := strings.TrimSpace(raw)
		if cidr == "" {
			continue
		}
		_, network, err := net.ParseCIDR(cidr)
		if err != nil {
			return nil, fmt.Errorf("invalid trusted proxy CIDR %q: %w", cidr, err)
		}
		resolver.trusted = append(resolver.trusted, network)
	}
	return resolver, nil
}

func (r *trustedProxyClientIPResolver) Resolve(request *http.Request) string {
	peer, fallback := remotePeerIP(request.RemoteAddr)
	if peer == nil || !r.isTrusted(peer) {
		return fallback
	}
	// nginx supplies exactly one X-Real-IP. Do not parse X-Forwarded-For
	// chains, and do not trim this value: net.ParseIP is the strict boundary.
	realIPs := request.Header.Values("X-Real-IP")
	if len(realIPs) == 1 {
		if realIP := net.ParseIP(realIPs[0]); realIP != nil {
			return realIP.String()
		}
	}
	return fallback
}

func (r *trustedProxyClientIPResolver) isTrusted(peer net.IP) bool {
	for _, network := range r.trusted {
		if network.Contains(peer) {
			return true
		}
	}
	return false
}

func remotePeerIP(remoteAddr string) (net.IP, string) {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	if parsed := net.ParseIP(host); parsed != nil {
		return parsed, parsed.String()
	}
	return nil, host
}
