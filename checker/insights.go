package checker

import (
	"strings"
	"time"
)

// generateInsights produces curated observations from the check results.
func generateInsights(dns *DNSResult, http *HTTPResult, tls *TLSResult) []Insight {
	var insights []Insight

	insights = append(insights, dnsInsights(dns)...)
	insights = append(insights, httpInsights(http)...)
	insights = append(insights, tlsInsights(tls)...)

	return insights
}

func dnsInsights(dns *DNSResult) []Insight {
	if dns == nil || dns.Error != "" {
		return nil
	}

	var insights []Insight

	if len(dns.A) == 0 && len(dns.AAAA) == 0 {
		insights = append(insights, Insight{
			Severity: "error",
			Category: "dns",
			Message:  "No A or AAAA records found — domain may not resolve",
		})
	}

	if len(dns.AAAA) == 0 && len(dns.A) > 0 {
		insights = append(insights, Insight{
			Severity: "info",
			Category: "dns",
			Message:  "No AAAA records — IPv6 is not configured",
		})
	}

	return insights
}

func httpInsights(http *HTTPResult) []Insight {
	if http == nil || http.Error != "" {
		return nil
	}

	var insights []Insight

	// AGCDN detection
	if _, ok := http.Headers["agcdn-info"]; ok {
		insights = append(insights, Insight{
			Severity: "info",
			Category: "cdn",
			Message:  "AGCDN is active (agcdn-info header present)",
		})
	} else if xServedBy, ok := http.Headers["x-served-by"]; ok && strings.Contains(xServedBy, "cache-") {
		insights = append(insights, Insight{
			Severity: "info",
			Category: "cdn",
			Message:  "Fastly CDN detected via x-served-by but no agcdn-info header — may be GCDN or non-AGCDN Fastly",
		})
	}

	// Cache effectiveness
	if xCache, ok := http.Headers["x-cache"]; ok {
		parts := strings.Split(xCache, ",")
		allMiss := true
		for _, p := range parts {
			if strings.TrimSpace(strings.ToUpper(p)) == "HIT" {
				allMiss = false
				break
			}
		}
		if allMiss {
			insights = append(insights, Insight{
				Severity: "warning",
				Category: "cache",
				Message:  "All cache layers report MISS — content is not being served from cache",
			})
		}
	}

	// Cache-Control issues
	if cc, ok := http.Headers["cache-control"]; ok {
		lower := strings.ToLower(cc)
		if strings.Contains(lower, "no-store") || strings.Contains(lower, "private") {
			insights = append(insights, Insight{
				Severity: "warning",
				Category: "cache",
				Message:  "Cache-Control prevents CDN caching (" + cc + ")",
			})
		}
		if strings.Contains(lower, "max-age=0") {
			insights = append(insights, Insight{
				Severity: "warning",
				Category: "cache",
				Message:  "max-age=0 forces revalidation on every request",
			})
		}
	}

	// Vary: Cookie concern
	if vary, ok := http.Headers["vary"]; ok {
		if strings.Contains(strings.ToLower(vary), "cookie") {
			insights = append(insights, Insight{
				Severity: "warning",
				Category: "cache",
				Message:  "Vary includes Cookie — may significantly reduce cache hit ratio",
			})
		}
	}

	// Set-Cookie concern
	if _, ok := http.Headers["set-cookie"]; ok {
		insights = append(insights, Insight{
			Severity: "warning",
			Category: "cache",
			Message:  "Set-Cookie header present — may prevent caching depending on CDN configuration",
		})
	}

	// Security headers
	if _, ok := http.Headers["strict-transport-security"]; !ok {
		insights = append(insights, Insight{
			Severity: "info",
			Category: "security",
			Message:  "No Strict-Transport-Security header — consider adding HSTS",
		})
	}

	// Status code
	if http.StatusCode >= 400 {
		insights = append(insights, Insight{
			Severity: "error",
			Category: "cdn",
			Message:  "HTTP " + strings.TrimSpace(statusText(http.StatusCode)) + " — site returned an error",
		})
	} else if http.StatusCode >= 300 {
		insights = append(insights, Insight{
			Severity: "info",
			Category: "cdn",
			Message:  "HTTP " + strings.TrimSpace(statusText(http.StatusCode)) + " — redirect detected",
		})
	}

	return insights
}

func tlsInsights(tls *TLSResult) []Insight {
	if tls == nil || tls.Error != "" {
		if tls != nil && tls.Error != "" {
			return []Insight{{
				Severity: "error",
				Category: "tls",
				Message:  "TLS check failed: " + tls.Error,
			}}
		}
		return nil
	}

	var insights []Insight

	// Check certificate expiry
	if tls.ValidTo != "" {
		expiry, err := time.Parse(time.RFC3339, tls.ValidTo)
		if err == nil {
			daysUntilExpiry := int(time.Until(expiry).Hours() / 24)
			if daysUntilExpiry < 0 {
				insights = append(insights, Insight{
					Severity: "error",
					Category: "tls",
					Message:  "TLS certificate has expired",
				})
			} else if daysUntilExpiry < 14 {
				insights = append(insights, Insight{
					Severity: "warning",
					Category: "tls",
					Message:  "TLS certificate expires in " + strings.TrimSpace(pluralize(daysUntilExpiry, "day")),
				})
			}
		}
	}

	// TLS version
	if tls.Protocol == "TLS 1.0" || tls.Protocol == "TLS 1.1" {
		insights = append(insights, Insight{
			Severity: "warning",
			Category: "tls",
			Message:  "Using deprecated " + tls.Protocol + " — should be TLS 1.2 or higher",
		})
	}

	return insights
}

func statusText(code int) string {
	switch code {
	case 200:
		return "200 OK"
	case 301:
		return "301 Moved Permanently"
	case 302:
		return "302 Found"
	case 304:
		return "304 Not Modified"
	case 403:
		return "403 Forbidden"
	case 404:
		return "404 Not Found"
	case 500:
		return "500 Internal Server Error"
	case 502:
		return "502 Bad Gateway"
	case 503:
		return "503 Service Unavailable"
	default:
		return string(rune(code/100+'0')) + "xx"
	}
}

func pluralize(n int, word string) string {
	if n == 1 {
		return "1 " + word
	}
	return strings.TrimSpace(intToStr(n)) + " " + word + "s"
}

func intToStr(n int) string {
	if n == 0 {
		return "0"
	}
	s := ""
	neg := false
	if n < 0 {
		neg = true
		n = -n
	}
	for n > 0 {
		s = string(rune('0'+n%10)) + s
		n /= 10
	}
	if neg {
		s = "-" + s
	}
	return s
}
