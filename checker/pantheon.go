package checker

import (
	"regexp"
	"strings"
)

// Known Pantheon IP ranges by CDN tier.
var (
	globalCDNIPs = map[string]bool{
		"23.185.0.1": true,
		"23.185.0.2": true,
		"23.185.0.3": true,
		"23.185.0.4": true,
	}

	agcdnLegacyIPs = map[string]bool{
		"151.101.2.133":   true,
		"151.101.66.133":  true,
		"151.101.130.133": true,
		"151.101.194.133": true,
	}

	agcdn2CustomCertIPs = map[string]bool{
		"151.101.2.228":   true,
		"151.101.66.228":  true,
		"151.101.130.228": true,
		"151.101.194.228": true,
	}

	globalCDNCanaryIPs = map[string]bool{
		"23.185.0.252": true,
		"23.185.0.253": true,
		"23.185.0.254": true,
	}

	multidevPattern  = regexp.MustCompile(`^pr-\d+$`)
	standardEnvs     = map[string]bool{"live": true, "dev": true, "test": true}
	versionExtractor = regexp.MustCompile(`[\d]+(?:\.[\d]+)*`)
)

// DetectPantheon performs deep Pantheon platform detection from HTTP response
// headers and DNS records. It returns nil-safe PantheonDetails with all
// detected fields populated.
func DetectPantheon(headers map[string]string, dnsA []string, dnsCNAME []string) *PantheonDetails {
	pd := &PantheonDetails{}

	// ── 1. Platform detection ───────────────────────────────────
	pd.Detected = detectPantheonPresence(headers, dnsA, dnsCNAME)
	if !pd.Detected {
		return pd
	}

	// ── 2. CDN tier from DNS A records and headers ──────────────
	pd.CDNTier = detectCDNTier(headers, dnsA)

	// ── 3. CMS and version detection ────────────────────────────
	pd.CMS, pd.CMSVersion = detectCMS(headers)

	// ── 4. PHP version ──────────────────────────────────────────
	pd.PHPVersion = detectPHPVersion(headers)

	// ── 5. Environment and multidev ─────────────────────────────
	pd.Environment, pd.IsMultidev = detectEnvironment(headers)

	// ── 6. Site UUID ────────────────────────────────────────────
	if uuid, ok := headers["x-pantheon-site"]; ok {
		pd.SiteUUID = strings.TrimSpace(uuid)
	}

	// ── 7. Redis / object cache ─────────────────────────────────
	pd.Redis = detectRedis(headers)

	// ── 8. New Relic ────────────────────────────────────────────
	pd.NewRelic = detectNewRelic(headers)

	// ── 9. Plan tier inference ──────────────────────────────────
	pd.PlanTier = inferPlanTier(pd, headers)

	return pd
}

// detectPantheonPresence returns true if any signal indicates the site is
// hosted on Pantheon.
func detectPantheonPresence(headers map[string]string, dnsA []string, dnsCNAME []string) bool {
	// Check for Pantheon-specific headers.
	for key := range headers {
		lower := strings.ToLower(key)
		if strings.HasPrefix(lower, "x-pantheon-") ||
			strings.HasPrefix(lower, "x-styx-") ||
			strings.HasPrefix(lower, "pcontext-") ||
			lower == "x-drupal-cache" {
			return true
		}
	}

	// Check DNS A records against known Pantheon IPs.
	for _, ip := range dnsA {
		if globalCDNIPs[ip] || agcdnLegacyIPs[ip] || agcdn2CustomCertIPs[ip] || globalCDNCanaryIPs[ip] {
			return true
		}
	}

	// Check CNAME records for Pantheon domains.
	for _, cname := range dnsCNAME {
		lower := strings.ToLower(cname)
		if strings.Contains(lower, "pantheon.io") || strings.Contains(lower, "edge.pantheon.io") {
			return true
		}
	}

	return false
}

// detectCDNTier determines the CDN tier from DNS A records and HTTP headers.
func detectCDNTier(headers map[string]string, dnsA []string) string {
	// Check A records against known IP ranges (most specific first).
	for _, ip := range dnsA {
		if agcdn2CustomCertIPs[ip] {
			return "AGCDN2 Custom Cert"
		}
		if agcdnLegacyIPs[ip] {
			return "AGCDN Legacy"
		}
		if globalCDNCanaryIPs[ip] {
			return "Global CDN (Canary)"
		}
		if globalCDNIPs[ip] {
			return "Global CDN"
		}
	}

	// Fall back to header-based detection.
	if _, ok := headers["agcdn-info"]; ok {
		return "AGCDN"
	}

	servedBy := headers["x-served-by"]
	if strings.Contains(servedBy, "cache-") {
		// Fastly POP detected but no AGCDN header — likely Global CDN.
		return "Global CDN"
	}

	return ""
}

// detectCMS identifies the CMS and its version from HTTP headers.
func detectCMS(headers map[string]string) (cms, version string) {
	if gen, ok := headers["x-generator"]; ok {
		genLower := strings.ToLower(gen)

		if strings.Contains(genLower, "wordpress") {
			cms = "WordPress"
			if v := versionExtractor.FindString(gen); v != "" {
				version = v
			}
			return cms, version
		}

		if strings.Contains(genLower, "drupal") {
			cms = "Drupal"
			if v := versionExtractor.FindString(gen); v != "" {
				version = v
			}
			return cms, version
		}
	}

	// Drupal cache headers as fallback when x-generator is absent.
	if _, ok := headers["x-drupal-cache"]; ok {
		return "Drupal", ""
	}
	if _, ok := headers["x-drupal-dynamic-cache"]; ok {
		return "Drupal", ""
	}

	return "", ""
}

// detectPHPVersion extracts the PHP version from x-powered-by.
func detectPHPVersion(headers map[string]string) string {
	powered, ok := headers["x-powered-by"]
	if !ok {
		return ""
	}
	lower := strings.ToLower(powered)
	idx := strings.Index(lower, "php")
	if idx < 0 {
		return ""
	}
	// Extract version number after "PHP" (e.g. "PHP/8.2.13").
	rest := powered[idx+3:]
	rest = strings.TrimLeft(rest, "/ ")
	if v := versionExtractor.FindString(rest); v != "" {
		return v
	}
	return ""
}

// detectEnvironment determines the Pantheon environment and whether it is a
// Multidev environment.
func detectEnvironment(headers map[string]string) (env string, isMultidev bool) {
	env, ok := headers["x-pantheon-environment"]
	if !ok || env == "" {
		return "", false
	}
	env = strings.TrimSpace(env)

	if multidevPattern.MatchString(env) || !standardEnvs[env] {
		return env, true
	}
	return env, false
}

// detectRedis checks for indicators that Redis / object caching is active.
func detectRedis(headers map[string]string) bool {
	// Explicit Redis headers.
	if _, ok := headers["x-redis"]; ok {
		return true
	}
	if _, ok := headers["x-object-cache"]; ok {
		return true
	}

	// x-pantheon-cache HIT can indicate a fast object-cache layer.
	if cache, ok := headers["x-pantheon-cache"]; ok {
		if strings.Contains(strings.ToUpper(cache), "HIT") {
			return true
		}
	}

	return false
}

// detectNewRelic checks for New Relic APM headers.
func detectNewRelic(headers map[string]string) bool {
	if _, ok := headers["x-newrelic-app-data"]; ok {
		return true
	}
	if _, ok := headers["x-newrelic-id"]; ok {
		return true
	}
	return false
}

// inferPlanTier attempts to determine the Pantheon plan level from the
// available signals. This is best-effort; many sites will return "".
func inferPlanTier(pd *PantheonDetails, headers map[string]string) string {
	if pd.NewRelic {
		// New Relic APM is included in Performance plans and above.
		return "Performance"
	}

	if _, ok := headers["agcdn-info"]; ok {
		return "AGCDN add-on"
	}

	switch pd.CDNTier {
	case "AGCDN Legacy", "AGCDN2 Custom Cert", "AGCDN":
		return "AGCDN add-on"
	}

	return ""
}
