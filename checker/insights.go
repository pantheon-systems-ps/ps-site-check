package checker

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// generateInsights produces curated observations from the check results.
func generateInsights(dns *DNSResult, dnsMulti []DNSPathResult, http *HTTPResult, secondHTTP *HTTPResult, warmup *WarmupResult, tls *TLSResult, redirectChain []RedirectHop, resolveIP string) []Insight {
	var insights []Insight

	if resolveIP != "" {
		insights = append(insights, Insight{
			Severity: "info",
			Category: "cdn",
			Message:  "Resolve override active — HTTP and TLS requests directed to " + resolveIP + " (DNS results show actual resolution)",
		})
	}

	insights = append(insights, dnsInsights(dns)...)
	insights = append(insights, dnsMultiInsights(dnsMulti)...)
	insights = append(insights, httpInsights(http)...)
	insights = append(insights, doubleRequestInsights(http, secondHTTP)...)
	insights = append(insights, warmupInsights(warmup)...)
	insights = append(insights, redirectChainInsights(redirectChain)...)
	insights = append(insights, tlsInsights(tls)...)
	insights = append(insights, crossCheckInsights(dns, http, tls)...)

	return insights
}

func dnsMultiInsights(results []DNSPathResult) []Insight {
	if len(results) < 2 {
		return nil
	}

	var insights []Insight

	firstA := ""
	consistent := true
	for _, r := range results {
		if r.Error != "" {
			insights = append(insights, Insight{
				Severity: "warning",
				Category: "dns",
				Message:  fmt.Sprintf("DNS resolution failed via %s: %s", r.Label, r.Error),
			})
			continue
		}
		joined := strings.Join(r.A, ",")
		if firstA == "" {
			firstA = joined
		} else if joined != firstA {
			consistent = false
		}
	}

	if !consistent {
		insights = append(insights, Insight{
			Severity: "warning",
			Category: "dns",
			Message:  "DNS results differ across resolvers — may indicate recent DNS change or geo-routing",
		})
	}

	return insights
}

func doubleRequestInsights(first *HTTPResult, second *HTTPResult) []Insight {
	if first == nil || second == nil || first.Error != "" || second.Error != "" {
		return nil
	}

	var insights []Insight

	firstCache := first.Headers["x-cache"]
	secondCache := second.Headers["x-cache"]

	if firstCache != "" && secondCache != "" {
		firstHasHit := strings.Contains(strings.ToUpper(firstCache), "HIT")
		secondHasHit := strings.Contains(strings.ToUpper(secondCache), "HIT")

		if !firstHasHit && secondHasHit {
			insights = append(insights, Insight{
				Severity: "info",
				Category: "cache",
				Message:  "Cache is working: first request was MISS, second request was HIT after 2s delay",
			})
		} else if !firstHasHit && !secondHasHit {
			insights = append(insights, Insight{
				Severity: "warning",
				Category: "cache",
				Message:  "Cache may not be working: both requests returned MISS — content is not being cached",
			})
		} else if firstHasHit && secondHasHit {
			insights = append(insights, Insight{
				Severity: "info",
				Category: "cache",
				Message:  "Both requests returned HIT — content is well-cached",
			})
		}
	}

	// Compare response times
	if second.DurationMS > 0 && first.DurationMS > 0 {
		if first.DurationMS > 500 && second.DurationMS < first.DurationMS/2 {
			insights = append(insights, Insight{
				Severity: "info",
				Category: "cache",
				Message:  fmt.Sprintf("Second request was %dx faster (%dms vs %dms) — cache acceleration confirmed", first.DurationMS/second.DurationMS, second.DurationMS, first.DurationMS),
			})
		}
	}

	return insights
}

func warmupInsights(warmup *WarmupResult) []Insight {
	if warmup == nil || len(warmup.Requests) == 0 {
		return nil
	}

	var insights []Insight

	ratio := warmup.HitRatio * 100
	switch {
	case ratio == 0:
		insights = append(insights, Insight{
			Severity: "warning",
			Category: "cache",
			Message:  fmt.Sprintf("Cache warmup: 0%% hit ratio across %d requests — content is not being cached", warmup.TotalRequests),
		})
	case ratio < 50:
		insights = append(insights, Insight{
			Severity: "warning",
			Category: "cache",
			Message:  fmt.Sprintf("Cache warmup: %.0f%% hit ratio (%d/%d) — low cache effectiveness", ratio, warmup.Hits, warmup.TotalRequests),
		})
	case ratio >= 80:
		insights = append(insights, Insight{
			Severity: "info",
			Category: "cache",
			Message:  fmt.Sprintf("Cache warmup: %.0f%% hit ratio (%d/%d) — good cache effectiveness", ratio, warmup.Hits, warmup.TotalRequests),
		})
	default:
		insights = append(insights, Insight{
			Severity: "info",
			Category: "cache",
			Message:  fmt.Sprintf("Cache warmup: %.0f%% hit ratio (%d/%d requests)", ratio, warmup.Hits, warmup.TotalRequests),
		})
	}

	// Compare first vs last request timing
	if len(warmup.Requests) >= 2 {
		first := warmup.Requests[0]
		last := warmup.Requests[len(warmup.Requests)-1]
		if first.DurationMS > 500 && last.DurationMS > 0 && last.DurationMS < first.DurationMS/2 {
			insights = append(insights, Insight{
				Severity: "info",
				Category: "cache",
				Message:  fmt.Sprintf("Cache acceleration confirmed: first request %dms → last request %dms", first.DurationMS, last.DurationMS),
			})
		}
	}

	return insights
}

func redirectChainInsights(chain []RedirectHop) []Insight {
	if len(chain) == 0 {
		return nil
	}

	var insights []Insight

	if len(chain) > 5 {
		insights = append(insights, Insight{
			Severity: "warning",
			Category: "cdn",
			Message:  fmt.Sprintf("Long redirect chain (%d hops) — may impact performance", len(chain)),
		})
	}

	// Check for HTTP→HTTPS redirect
	if len(chain) >= 2 && strings.HasPrefix(chain[0].URL, "http://") {
		for _, hop := range chain[1:] {
			if strings.HasPrefix(hop.URL, "https://") {
				insights = append(insights, Insight{
					Severity: "info",
					Category: "security",
					Message:  "HTTP→HTTPS redirect detected in chain",
				})
				break
			}
		}
	}

	// Check for redirect loop indicators
	seen := make(map[string]bool)
	for _, hop := range chain {
		if seen[hop.URL] {
			insights = append(insights, Insight{
				Severity: "error",
				Category: "cdn",
				Message:  "Redirect loop detected: " + hop.URL + " appears multiple times",
			})
			break
		}
		seen[hop.URL] = true
	}

	// Show final destination
	last := chain[len(chain)-1]
	if last.StatusCode >= 200 && last.StatusCode < 300 {
		insights = append(insights, Insight{
			Severity: "info",
			Category: "cdn",
			Message:  fmt.Sprintf("Redirect chain resolved to %s (HTTP %d) after %d hops", last.URL, last.StatusCode, len(chain)-1),
		})
	}

	return insights
}

func dnsInsights(dns *DNSResult) []Insight {
	if dns == nil || dns.Error != "" {
		if dns != nil && dns.Error != "" {
			return []Insight{{
				Severity: "error",
				Category: "dns",
				Message:  "DNS resolution failed: " + dns.Error,
			}}
		}
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

	if len(dns.CNAME) > 0 {
		cname := dns.CNAME[0]
		switch {
		case strings.HasSuffix(cname, ".fastly.net.") || strings.HasSuffix(cname, ".fastly.net"):
			insights = append(insights, Insight{
				Severity: "info",
				Category: "dns",
				Message:  "CNAME points to Fastly (" + cname + ")",
			})
		case strings.HasSuffix(cname, ".pantheonsite.io.") || strings.HasSuffix(cname, ".pantheonsite.io"):
			insights = append(insights, Insight{
				Severity: "info",
				Category: "dns",
				Message:  "CNAME points to Pantheon platform (" + cname + ")",
			})
		}
	}

	// NS record insights
	if len(dns.NS) > 0 {
		for _, ns := range dns.NS {
			nsLower := strings.ToLower(ns)
			switch {
			case strings.Contains(nsLower, "awsdns"):
				insights = append(insights, Insight{
					Severity: "info",
					Category: "dns",
					Message:  "DNS hosted on AWS Route 53 (" + ns + ")",
				})
				break
			case strings.Contains(nsLower, "cloudflare"):
				insights = append(insights, Insight{
					Severity: "info",
					Category: "dns",
					Message:  "DNS hosted on Cloudflare (" + ns + ")",
				})
				break
			case strings.Contains(nsLower, "google"):
				insights = append(insights, Insight{
					Severity: "info",
					Category: "dns",
					Message:  "DNS hosted on Google Cloud DNS (" + ns + ")",
				})
				break
			case strings.Contains(nsLower, "domaincontrol"):
				insights = append(insights, Insight{
					Severity: "info",
					Category: "dns",
					Message:  "DNS hosted on GoDaddy (" + ns + ")",
				})
				break
			}
			break // Only report the first NS provider match
		}
	}

	// TXT record insights
	for _, txt := range dns.TXT {
		txtLower := strings.ToLower(txt)
		switch {
		case strings.HasPrefix(txtLower, "v=spf1"):
			insights = append(insights, Insight{
				Severity: "info",
				Category: "dns",
				Message:  "SPF record configured for email authentication",
			})
		case strings.Contains(txtLower, "_dmarc"):
			insights = append(insights, Insight{
				Severity: "info",
				Category: "dns",
				Message:  "DMARC policy configured",
			})
		case strings.HasPrefix(txt, "google-site-verification") || strings.HasPrefix(txt, "MS=") || strings.HasPrefix(txt, "facebook-domain-verification"):
			insights = append(insights, Insight{
				Severity: "info",
				Category: "dns",
				Message:  "Domain verification TXT record present: " + txt[:min(len(txt), 60)],
			})
		}
	}

	if dns.DurationMS > 1000 {
		insights = append(insights, Insight{
			Severity: "warning",
			Category: "dns",
			Message:  fmt.Sprintf("DNS resolution is slow (%dms) — may indicate DNS configuration issues", dns.DurationMS),
		})
	}

	return insights
}

func httpInsights(http *HTTPResult) []Insight {
	if http == nil || http.Error != "" {
		if http != nil && http.Error != "" {
			return []Insight{{
				Severity: "error",
				Category: "cdn",
				Message:  "HTTP request failed: " + http.Error,
			}}
		}
		return nil
	}

	var insights []Insight

	// Status code
	if http.StatusCode >= 500 {
		insights = append(insights, Insight{
			Severity: "error",
			Category: "cdn",
			Message:  "HTTP " + statusText(http.StatusCode) + " — server error",
		})
	} else if http.StatusCode >= 400 {
		insights = append(insights, Insight{
			Severity: "error",
			Category: "cdn",
			Message:  "HTTP " + statusText(http.StatusCode) + " — client error",
		})
	} else if http.StatusCode >= 300 {
		location := http.Headers["location"]
		msg := "HTTP " + statusText(http.StatusCode) + " — redirect detected"
		if location != "" {
			msg += " → " + location
		}
		insights = append(insights, Insight{
			Severity: "info",
			Category: "cdn",
			Message:  msg,
		})
	}

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

	// Pantheon platform detection
	if backend, ok := http.Headers["pcontext-backend"]; ok {
		insights = append(insights, Insight{
			Severity: "info",
			Category: "cdn",
			Message:  "Pantheon platform detected — backend: " + backend,
		})
	}

	// Fastly Image Optimization
	if _, ok := http.Headers["fastly-io-info"]; ok {
		insights = append(insights, Insight{
			Severity: "info",
			Category: "cdn",
			Message:  "Fastly Image Optimization (IO) is enabled",
		})
	}

	// Cache effectiveness
	if xCache, ok := http.Headers["x-cache"]; ok {
		parts := strings.Split(xCache, ",")
		allMiss := true
		allHit := true
		for _, p := range parts {
			trimmed := strings.TrimSpace(strings.ToUpper(p))
			if trimmed == "HIT" {
				allMiss = false
			} else {
				allHit = false
			}
		}
		if allMiss {
			insights = append(insights, Insight{
				Severity: "warning",
				Category: "cache",
				Message:  "All cache layers report MISS — content is not being served from cache",
			})
		} else if allHit {
			insights = append(insights, Insight{
				Severity: "info",
				Category: "cache",
				Message:  "Full cache HIT across all layers — optimal caching",
			})
		}
	}

	// Cache-Control analysis
	if cc, ok := http.Headers["cache-control"]; ok {
		lower := strings.ToLower(cc)
		if strings.Contains(lower, "no-store") {
			insights = append(insights, Insight{
				Severity: "warning",
				Category: "cache",
				Message:  "Cache-Control: no-store — content will never be cached",
			})
		} else if strings.Contains(lower, "private") {
			insights = append(insights, Insight{
				Severity: "warning",
				Category: "cache",
				Message:  "Cache-Control: private — CDN cannot cache this response",
			})
		} else if strings.Contains(lower, "no-cache") {
			insights = append(insights, Insight{
				Severity: "info",
				Category: "cache",
				Message:  "Cache-Control: no-cache — CDN must revalidate before serving cached copy",
			})
		}
		if strings.Contains(lower, "max-age=0") {
			insights = append(insights, Insight{
				Severity: "warning",
				Category: "cache",
				Message:  "max-age=0 — forces revalidation on every request",
			})
		}
		if strings.Contains(lower, "s-maxage") {
			insights = append(insights, Insight{
				Severity: "info",
				Category: "cache",
				Message:  "s-maxage present — CDN has a separate TTL from browser cache",
			})
		}
	} else {
		insights = append(insights, Insight{
			Severity: "warning",
			Category: "cache",
			Message:  "No Cache-Control header — caching behavior depends on CDN defaults",
		})
	}

	// Age header analysis
	if ageStr, ok := http.Headers["age"]; ok {
		if age, err := strconv.Atoi(ageStr); err == nil && age > 86400 {
			insights = append(insights, Insight{
				Severity: "info",
				Category: "cache",
				Message:  fmt.Sprintf("Object has been cached for %s — long-lived cache entry", humanDuration(age)),
			})
		}
	}

	// Vary: Cookie concern
	if vary, ok := http.Headers["vary"]; ok {
		if strings.Contains(strings.ToLower(vary), "cookie") {
			insights = append(insights, Insight{
				Severity: "warning",
				Category: "cache",
				Message:  "Vary includes Cookie — requests with different cookies are cached separately, reducing hit ratio",
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

	// Surrogate-Key / cache tags
	if sk, ok := http.Headers["surrogate-key"]; ok {
		count := len(strings.Fields(sk))
		insights = append(insights, Insight{
			Severity: "info",
			Category: "cache",
			Message:  fmt.Sprintf("Surrogate-Key present with %d cache tags — supports targeted purging", count),
		})
	}

	// Security headers
	if _, ok := http.Headers["strict-transport-security"]; !ok {
		insights = append(insights, Insight{
			Severity: "warning",
			Category: "security",
			Message:  "No Strict-Transport-Security (HSTS) header — browsers may allow HTTP connections",
		})
	} else if hsts := http.Headers["strict-transport-security"]; strings.Contains(hsts, "max-age=300") {
		insights = append(insights, Insight{
			Severity: "warning",
			Category: "security",
			Message:  "HSTS max-age is only 300s (5 min) — too short for production, consider 31536000 (1 year)",
		})
	}

	if _, ok := http.Headers["x-frame-options"]; !ok {
		if _, ok2 := http.Headers["content-security-policy"]; !ok2 {
			insights = append(insights, Insight{
				Severity: "info",
				Category: "security",
				Message:  "No X-Frame-Options or CSP frame-ancestors — page may be embeddable in iframes",
			})
		}
	}

	if _, ok := http.Headers["x-content-type-options"]; !ok {
		insights = append(insights, Insight{
			Severity: "info",
			Category: "security",
			Message:  "No X-Content-Type-Options header — consider adding 'nosniff'",
		})
	}

	// Slow response
	if http.DurationMS > 3000 {
		insights = append(insights, Insight{
			Severity: "warning",
			Category: "cdn",
			Message:  fmt.Sprintf("Slow HTTP response (%dms) — may indicate origin performance issues", http.DurationMS),
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

	// Certificate expiry
	if tls.ValidTo != "" {
		expiry, err := time.Parse(time.RFC3339, tls.ValidTo)
		if err == nil {
			daysUntilExpiry := int(time.Until(expiry).Hours() / 24)
			if daysUntilExpiry < 0 {
				insights = append(insights, Insight{
					Severity: "error",
					Category: "tls",
					Message:  "TLS certificate has EXPIRED",
				})
			} else if daysUntilExpiry < 7 {
				insights = append(insights, Insight{
					Severity: "error",
					Category: "tls",
					Message:  fmt.Sprintf("TLS certificate expires in %d days — renewal is critical", daysUntilExpiry),
				})
			} else if daysUntilExpiry < 30 {
				insights = append(insights, Insight{
					Severity: "warning",
					Category: "tls",
					Message:  fmt.Sprintf("TLS certificate expires in %d days — renewal should happen soon", daysUntilExpiry),
				})
			} else {
				insights = append(insights, Insight{
					Severity: "info",
					Category: "tls",
					Message:  fmt.Sprintf("TLS certificate valid for %d more days", daysUntilExpiry),
				})
			}
		}
	}

	// TLS version
	switch tls.Protocol {
	case "TLS 1.0", "TLS 1.1":
		insights = append(insights, Insight{
			Severity: "error",
			Category: "tls",
			Message:  "Using deprecated " + tls.Protocol + " — must upgrade to TLS 1.2+",
		})
	case "TLS 1.3":
		insights = append(insights, Insight{
			Severity: "info",
			Category: "tls",
			Message:  "TLS 1.3 — latest protocol with best performance and security",
		})
	}

	// Cipher suite analysis
	if tls.CipherSuite != "" {
		switch tls.CipherSecurity {
		case "insecure":
			insights = append(insights, Insight{
				Severity: "error",
				Category: "tls",
				Message:  "Insecure cipher suite negotiated: " + tls.CipherSuite + " — uses broken or deprecated algorithms",
			})
		case "weak":
			insights = append(insights, Insight{
				Severity: "warning",
				Category: "tls",
				Message:  "Weak cipher suite negotiated: " + tls.CipherSuite + " — lacks forward secrecy",
			})
		case "recommended":
			insights = append(insights, Insight{
				Severity: "info",
				Category: "tls",
				Message:  "Strong cipher suite: " + tls.CipherSuite,
			})
		}
	}

	// Certificate issuer analysis
	if tls.Issuer != "" {
		issuerLower := strings.ToLower(tls.Issuer)
		switch {
		case strings.Contains(issuerLower, "let's encrypt"):
			insights = append(insights, Insight{
				Severity: "info",
				Category: "tls",
				Message:  "Certificate issued by Let's Encrypt (auto-renewable, 90-day validity)",
			})
		case strings.Contains(issuerLower, "globalsign"):
			insights = append(insights, Insight{
				Severity: "info",
				Category: "tls",
				Message:  "Certificate issued by GlobalSign (Fastly managed TLS)",
			})
		case strings.Contains(issuerLower, "certainly"):
			insights = append(insights, Insight{
				Severity: "info",
				Category: "tls",
				Message:  "Certificate issued by Certainly (Fastly's CA)",
			})
		}
	}

	return insights
}

// crossCheckInsights detects patterns across DNS, HTTP, and TLS results.
func crossCheckInsights(dns *DNSResult, http *HTTPResult, tls *TLSResult) []Insight {
	var insights []Insight

	// Check if site is on Pantheon but not using AGCDN
	if http != nil && http.Error == "" {
		_, hasStyx := http.Headers["x-pantheon-styx-hostname"]
		_, hasAGCDN := http.Headers["agcdn-info"]
		if hasStyx && !hasAGCDN {
			insights = append(insights, Insight{
				Severity: "info",
				Category: "cdn",
				Message:  "Site is on Pantheon (Styx edge detected) but not using AGCDN — using GCDN",
			})
		}
	}

	// Check for HTTPS enforcement
	if http != nil && http.Error == "" {
		if enforce, ok := http.Headers["pcontext-enforce-https"]; ok {
			if enforce == "transitional" {
				insights = append(insights, Insight{
					Severity: "info",
					Category: "security",
					Message:  "HTTPS enforcement is transitional — consider switching to full enforcement",
				})
			}
		}
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
	case 307:
		return "307 Temporary Redirect"
	case 308:
		return "308 Permanent Redirect"
	case 400:
		return "400 Bad Request"
	case 401:
		return "401 Unauthorized"
	case 403:
		return "403 Forbidden"
	case 404:
		return "404 Not Found"
	case 429:
		return "429 Too Many Requests"
	case 500:
		return "500 Internal Server Error"
	case 502:
		return "502 Bad Gateway"
	case 503:
		return "503 Service Unavailable"
	case 504:
		return "504 Gateway Timeout"
	default:
		return fmt.Sprintf("%d", code)
	}
}

func humanDuration(seconds int) string {
	if seconds < 3600 {
		return fmt.Sprintf("%d minutes", seconds/60)
	}
	if seconds < 86400 {
		return fmt.Sprintf("%.1f hours", float64(seconds)/3600)
	}
	return fmt.Sprintf("%.1f days", float64(seconds)/86400)
}
