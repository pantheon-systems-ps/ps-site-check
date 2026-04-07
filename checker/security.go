package checker

import (
	"strconv"
	"strings"
)

// AuditSecurity analyzes HTTP response headers for security posture and
// cookies. It returns a scored SecurityAudit with per-header ratings and
// cookie-level findings.
func AuditSecurity(headers map[string]string) *SecurityAudit {
	audit := &SecurityAudit{}

	audit.Headers = auditHeaders(headers)
	audit.Cookies = auditCookies(headers)
	audit.Score = calcScore(audit.Headers)
	audit.Grade = calcGrade(audit.Score)

	return audit
}

// ── Header auditing ──────────────────────────────────────────

func auditHeaders(h map[string]string) []SecurityHeader {
	// Normalise keys to lowercase for consistent lookups.
	lower := make(map[string]string, len(h))
	for k, v := range h {
		lower[strings.ToLower(k)] = v
	}

	return []SecurityHeader{
		checkHSTS(lower),
		checkCSP(lower),
		checkContentTypeOptions(lower),
		checkFrameOptions(lower),
		checkReferrerPolicy(lower),
		checkPermissionsPolicy(lower),
		checkCOOP(lower),
		checkCOEP(lower),
		checkCORP(lower),
		checkXSSProtection(lower),
	}
}

func checkHSTS(h map[string]string) SecurityHeader {
	val, ok := h["strict-transport-security"]
	sh := SecurityHeader{
		Name:        "strict-transport-security",
		Description: "Enforces HTTPS connections. Tells browsers to never load the site over plain HTTP, preventing protocol-downgrade attacks and cookie hijacking.",
	}
	if !ok || val == "" {
		sh.Rating = "missing"
		return sh
	}
	sh.Present = true
	sh.Value = val

	maxAge := parseMaxAge(val)
	switch {
	case maxAge >= 31536000:
		sh.Rating = "good"
	default:
		sh.Rating = "warning"
		sh.Description = "HSTS max-age is below the recommended 1 year (31536000). Short values leave a window where browsers may still connect over HTTP."
	}
	return sh
}

func checkCSP(h map[string]string) SecurityHeader {
	val, ok := h["content-security-policy"]
	sh := SecurityHeader{
		Name:        "content-security-policy",
		Description: "Controls which resources the browser is allowed to load, mitigating cross-site scripting (XSS) and data injection attacks.",
	}
	if !ok || val == "" {
		sh.Rating = "missing"
		return sh
	}
	sh.Present = true
	sh.Value = val
	sh.Rating = "good"
	return sh
}

func checkContentTypeOptions(h map[string]string) SecurityHeader {
	val, ok := h["x-content-type-options"]
	sh := SecurityHeader{
		Name:        "x-content-type-options",
		Description: "Prevents browsers from MIME-sniffing a response away from the declared Content-Type, blocking attacks that exploit type confusion.",
	}
	if !ok || val == "" {
		sh.Rating = "missing"
		return sh
	}
	sh.Present = true
	sh.Value = val
	if strings.EqualFold(strings.TrimSpace(val), "nosniff") {
		sh.Rating = "good"
	} else {
		sh.Rating = "warning"
		sh.Description = "x-content-type-options is set but not to 'nosniff'. The only valid value is 'nosniff'."
	}
	return sh
}

func checkFrameOptions(h map[string]string) SecurityHeader {
	val, ok := h["x-frame-options"]
	sh := SecurityHeader{
		Name:        "x-frame-options",
		Description: "Prevents the page from being embedded in iframes on other sites, defending against clickjacking attacks.",
	}
	if !ok || val == "" {
		sh.Rating = "missing"
		return sh
	}
	sh.Present = true
	sh.Value = val
	upper := strings.ToUpper(strings.TrimSpace(val))
	if upper == "DENY" || upper == "SAMEORIGIN" {
		sh.Rating = "good"
	} else {
		sh.Rating = "warning"
		sh.Description = "x-frame-options has a non-standard value. Use 'DENY' or 'SAMEORIGIN'."
	}
	return sh
}

func checkReferrerPolicy(h map[string]string) SecurityHeader {
	val, ok := h["referrer-policy"]
	sh := SecurityHeader{
		Name:        "referrer-policy",
		Description: "Controls how much referrer information is sent with requests, protecting user privacy and preventing URL-based data leaks.",
	}
	if !ok || val == "" {
		sh.Rating = "missing"
		return sh
	}
	sh.Present = true
	sh.Value = val
	lower := strings.ToLower(strings.TrimSpace(val))
	switch lower {
	case "strict-origin-when-cross-origin", "no-referrer", "same-origin":
		sh.Rating = "good"
	default:
		sh.Rating = "warning"
		sh.Description = "Referrer-Policy is set but not to a strict value. Consider 'strict-origin-when-cross-origin', 'no-referrer', or 'same-origin' for better privacy."
	}
	return sh
}

func checkPermissionsPolicy(h map[string]string) SecurityHeader {
	val, ok := h["permissions-policy"]
	sh := SecurityHeader{
		Name:        "permissions-policy",
		Description: "Restricts which browser features (camera, microphone, geolocation, etc.) the page and its iframes can use, reducing the attack surface.",
	}
	if !ok || val == "" {
		sh.Rating = "missing"
		return sh
	}
	sh.Present = true
	sh.Value = val
	sh.Rating = "good"
	return sh
}

func checkCOOP(h map[string]string) SecurityHeader {
	val, ok := h["cross-origin-opener-policy"]
	sh := SecurityHeader{
		Name:        "cross-origin-opener-policy",
		Description: "Isolates the browsing context from cross-origin windows, preventing Spectre-class side-channel attacks and cross-origin information leaks.",
	}
	if !ok || val == "" {
		sh.Rating = "missing"
		return sh
	}
	sh.Present = true
	sh.Value = val
	if strings.EqualFold(strings.TrimSpace(val), "same-origin") {
		sh.Rating = "good"
	} else {
		sh.Rating = "warning"
		sh.Description = "Cross-Origin-Opener-Policy is set but not to 'same-origin'. Consider 'same-origin' for full cross-origin isolation."
	}
	return sh
}

func checkCOEP(h map[string]string) SecurityHeader {
	val, ok := h["cross-origin-embedder-policy"]
	sh := SecurityHeader{
		Name:        "cross-origin-embedder-policy",
		Description: "Ensures all cross-origin resources are loaded with explicit permission (CORS or CORP), enabling SharedArrayBuffer and high-resolution timers safely.",
	}
	if !ok || val == "" {
		sh.Rating = "missing"
		return sh
	}
	sh.Present = true
	sh.Value = val
	lower := strings.ToLower(strings.TrimSpace(val))
	if lower == "require-corp" || lower == "credentialless" {
		sh.Rating = "good"
	} else {
		sh.Rating = "warning"
		sh.Description = "Cross-Origin-Embedder-Policy is set but not to 'require-corp' or 'credentialless'."
	}
	return sh
}

func checkCORP(h map[string]string) SecurityHeader {
	val, ok := h["cross-origin-resource-policy"]
	sh := SecurityHeader{
		Name:        "cross-origin-resource-policy",
		Description: "Declares whether the resource can be loaded by cross-origin or cross-site requests, protecting against speculative execution side-channel attacks.",
	}
	if !ok || val == "" {
		sh.Rating = "missing"
		return sh
	}
	sh.Present = true
	sh.Value = val
	sh.Rating = "good"
	return sh
}

func checkXSSProtection(h map[string]string) SecurityHeader {
	val, ok := h["x-xss-protection"]
	sh := SecurityHeader{
		Name:        "x-xss-protection",
		Description: "Legacy XSS filter built into older browsers. Modern best practice is to set it to '0' (disabled) and rely on Content-Security-Policy instead, as the filter itself can introduce vulnerabilities.",
	}
	if !ok || val == "" {
		sh.Rating = "missing"
		return sh
	}
	sh.Present = true
	sh.Value = val
	trimmed := strings.TrimSpace(val)
	switch {
	case trimmed == "0":
		sh.Rating = "good"
		sh.Description = "X-XSS-Protection correctly disabled. The browser's built-in XSS filter is turned off; CSP should be used instead."
	case strings.HasPrefix(trimmed, "1"):
		sh.Rating = "warning"
		sh.Description = "X-XSS-Protection is enabled ('1') but the browser XSS filter is deprecated and can introduce vulnerabilities. Set to '0' and use Content-Security-Policy instead."
	default:
		sh.Rating = "warning"
		sh.Description = "X-XSS-Protection has an unrecognized value. Use '0' to disable (recommended) or remove the header."
	}
	return sh
}

// ── Cookie auditing ──────────────────────────────────────────

func auditCookies(h map[string]string) []CookieAudit {
	raw, ok := h["set-cookie"]
	if !ok {
		// Also check the original-case variant.
		raw, ok = h["Set-Cookie"]
		if !ok {
			return nil
		}
	}
	if raw == "" {
		return nil
	}

	// HTTP responses may contain multiple Set-Cookie headers; when stored in a
	// flat map they are typically joined with a literal "\n" or ", " delimiter.
	// We split on newlines first, then on ", " only when we detect a cookie name
	// (contains "=") to avoid splitting on commas inside cookie values.
	lines := splitSetCookieHeader(raw)

	var cookies []CookieAudit
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		cookies = append(cookies, parseCookie(line))
	}
	return cookies
}

// splitSetCookieHeader splits a raw set-cookie value that may contain multiple
// cookies concatenated with newlines or ", " (common when headers are merged).
func splitSetCookieHeader(raw string) []string {
	// First try newline splitting (most common in merged headers).
	if strings.Contains(raw, "\n") {
		return strings.Split(raw, "\n")
	}
	// If no newlines, the header is likely a single cookie value.
	return []string{raw}
}

// parseCookie extracts the cookie name and analyses its attributes.
func parseCookie(raw string) CookieAudit {
	parts := strings.Split(raw, ";")

	ca := CookieAudit{}

	// The first segment is "name=value".
	if len(parts) > 0 {
		nv := strings.TrimSpace(parts[0])
		if eqIdx := strings.Index(nv, "="); eqIdx > 0 {
			ca.Name = nv[:eqIdx]
		} else {
			ca.Name = nv
		}
	}

	// Scan attributes.
	for _, part := range parts[1:] {
		attr := strings.TrimSpace(part)
		attrLower := strings.ToLower(attr)

		switch {
		case attrLower == "secure":
			ca.Secure = true
		case attrLower == "httponly":
			ca.HttpOnly = true
		case strings.HasPrefix(attrLower, "samesite"):
			if eqIdx := strings.Index(attr, "="); eqIdx >= 0 {
				ca.SameSite = strings.TrimSpace(attr[eqIdx+1:])
			}
		}
	}

	// Flag issues.
	if !ca.Secure {
		ca.Issues = append(ca.Issues, "Missing Secure flag: cookie may be sent over unencrypted HTTP connections")
	}
	if !ca.HttpOnly {
		ca.Issues = append(ca.Issues, "Missing HttpOnly flag: cookie is accessible to JavaScript, increasing XSS risk")
	}
	sameLower := strings.ToLower(ca.SameSite)
	switch {
	case ca.SameSite == "":
		ca.Issues = append(ca.Issues, "Missing SameSite attribute: browser defaults vary, explicitly set to 'Lax' or 'Strict'")
	case sameLower == "none" && !ca.Secure:
		ca.Issues = append(ca.Issues, "SameSite=None without Secure flag: cookie will be rejected by modern browsers")
	}

	return ca
}

// ── Scoring ──────────────────────────────────────────────────

// calcScore produces a 0-100 score. Each of the 10 headers is worth 10 points.
func calcScore(headers []SecurityHeader) int {
	score := 0
	for _, h := range headers {
		switch h.Rating {
		case "good":
			score += 10
		case "warning":
			score += 5
		}
		// "missing" and "bad" contribute 0 points.
	}
	return score
}

// calcGrade maps a numeric score to a letter grade.
func calcGrade(score int) string {
	switch {
	case score >= 95:
		return "A+"
	case score >= 85:
		return "A"
	case score >= 70:
		return "B"
	case score >= 55:
		return "C"
	case score >= 40:
		return "D"
	default:
		return "F"
	}
}

// ── Helpers ──────────────────────────────────────────────────

// parseMaxAge extracts the max-age numeric value from an HSTS header value.
// Returns -1 if max-age is not found or cannot be parsed.
func parseMaxAge(hsts string) int {
	lower := strings.ToLower(hsts)
	idx := strings.Index(lower, "max-age=")
	if idx < 0 {
		return -1
	}
	rest := hsts[idx+len("max-age="):]
	// Trim up to the next delimiter or end of string.
	end := strings.IndexAny(rest, "; ,")
	if end >= 0 {
		rest = rest[:end]
	}
	rest = strings.TrimSpace(rest)
	val, err := strconv.Atoi(rest)
	if err != nil {
		return -1
	}
	return val
}
