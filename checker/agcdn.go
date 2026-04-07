package checker

import (
	"crypto/tls"
	"io"
	"net/http"
	"strings"
	"time"
)

// ProbeAGCDN actively tests AGCDN features (WAF, IO, rate limiting) on a domain.
func ProbeAGCDN(domain string) *AGCDNProbe {
	start := time.Now()
	domain = strings.TrimSpace(domain)

	probe := &AGCDNProbe{
		Domain: domain,
		WAF:    &AGCDNFeature{},
		IO:     &AGCDNIOProbe{},
		RateLimit: &AGCDNFeature{},
	}

	origin := "https://" + domain
	client := &http.Client{
		Timeout: 10 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12},
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return http.ErrUseLastResponse
			}
			return nil
		},
	}

	// 1. Baseline request to detect AGCDN presence
	baseReq, err := http.NewRequest("GET", origin, nil)
	if err != nil {
		probe.DurationMS = time.Since(start).Milliseconds()
		return probe
	}
	baseReq.Header.Set("User-Agent", "ps-site-check/1.0")
	baseReq.Header.Set("Fastly-Debug", "1")

	baseResp, err := client.Do(baseReq)
	if err != nil {
		probe.DurationMS = time.Since(start).Milliseconds()
		return probe
	}
	defer baseResp.Body.Close()
	io.Copy(io.Discard, baseResp.Body)

	// Check AGCDN presence
	if baseResp.Header.Get("agcdn-info") != "" ||
		strings.Contains(baseResp.Header.Get("x-served-by"), "cache-") {
		probe.IsAGCDN = true
	}
	if baseResp.Header.Get("x-pantheon-styx-hostname") != "" {
		probe.IsAGCDN = true // Pantheon CDN at minimum
	}

	// 2. WAF detection — probe with suspicious patterns in headers
	probe.WAF = probeWAF(client, origin)

	// 3. IO detection — check for Fastly IO headers and test transform
	probe.IO = probeIO(client, origin, baseResp)

	// 4. Rate limiting detection — check for rate limit headers
	probe.RateLimit = probeRateLimit(client, origin, baseResp)

	probe.DurationMS = time.Since(start).Milliseconds()
	return probe
}

// probeWAF tests for WAF presence by sending a request with a suspicious query string.
func probeWAF(client *http.Client, origin string) *AGCDNFeature {
	feature := &AGCDNFeature{}

	// Test with a common SQLi pattern in the query string that WAFs typically block.
	testURL := origin + "/?test=1%27%20OR%201%3D1--"
	req, err := http.NewRequest("GET", testURL, nil)
	if err != nil {
		return feature
	}
	req.Header.Set("User-Agent", "ps-site-check/1.0 (waf-probe)")

	resp, err := client.Do(req)
	if err != nil {
		return feature
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	bodyStr := string(body)

	// WAF indicators: 403 with Fastly, specific WAF headers, or WAF body content
	if resp.StatusCode == 403 {
		if strings.Contains(resp.Header.Get("server"), "Varnish") ||
			strings.Contains(resp.Header.Get("x-served-by"), "cache-") {
			feature.Detected = true
			feature.Evidence = "403 response to SQLi probe pattern via Fastly edge"
			return feature
		}
	}

	// Check for WAF-specific headers
	for key := range resp.Header {
		lower := strings.ToLower(key)
		if strings.Contains(lower, "waf") || strings.Contains(lower, "x-sigsci") {
			feature.Detected = true
			feature.Evidence = "WAF header detected: " + key
			return feature
		}
	}

	// Check body for WAF block page indicators
	if resp.StatusCode == 403 || resp.StatusCode == 406 {
		lowerBody := strings.ToLower(bodyStr)
		if strings.Contains(lowerBody, "blocked") ||
			strings.Contains(lowerBody, "firewall") ||
			strings.Contains(lowerBody, "waf") ||
			strings.Contains(lowerBody, "access denied") {
			feature.Detected = true
			feature.Evidence = "WAF block page detected (HTTP " + http.StatusText(resp.StatusCode) + ")"
			return feature
		}
	}

	return feature
}

// probeIO tests Fastly Image Optimization by checking headers and attempting a transform.
func probeIO(client *http.Client, origin string, baseResp *http.Response) *AGCDNIOProbe {
	probe := &AGCDNIOProbe{}

	// Check if IO header was present in the baseline response
	ioInfo := baseResp.Header.Get("fastly-io-info")
	if ioInfo != "" {
		probe.Detected = true
		probe.Evidence = "fastly-io-info: " + ioInfo
	}

	// Try to fetch an common image path with IO transform params
	// Look for favicon or common image paths
	testPaths := []string{
		"/favicon.ico?width=32&format=auto",
		"/wp-content/uploads/?width=100",
		"/sites/default/files/?width=100",
	}

	for _, path := range testPaths {
		req, err := http.NewRequest("HEAD", origin+path, nil)
		if err != nil {
			continue
		}
		req.Header.Set("User-Agent", "ps-site-check/1.0")
		req.Header.Set("Accept", "image/*")

		resp, err := client.Do(req)
		if err != nil {
			continue
		}
		resp.Body.Close()

		if resp.Header.Get("fastly-io-info") != "" {
			probe.Detected = true
			probe.Transforms = true
			probe.Evidence = "IO transform confirmed via " + path + " (fastly-io-info: " + resp.Header.Get("fastly-io-info") + ")"
			return probe
		}

		// Check for content-type change indicating IO processing
		ct := resp.Header.Get("content-type")
		if strings.Contains(ct, "webp") || strings.Contains(ct, "avif") {
			probe.Detected = true
			probe.Transforms = true
			probe.Evidence = "IO transform detected: response served as " + ct
			return probe
		}
	}

	return probe
}

// probeRateLimit checks for rate limiting indicators.
func probeRateLimit(client *http.Client, origin string, baseResp *http.Response) *AGCDNFeature {
	feature := &AGCDNFeature{}

	// Check baseline response for rate-limit headers
	rlHeaders := []string{
		"x-ratelimit-limit",
		"x-ratelimit-remaining",
		"x-ratelimit-reset",
		"ratelimit-limit",
		"ratelimit-remaining",
		"ratelimit-reset",
		"retry-after",
	}

	for _, h := range rlHeaders {
		if v := baseResp.Header.Get(h); v != "" {
			feature.Detected = true
			feature.Evidence = h + ": " + v
			return feature
		}
	}

	// Check for Fastly rate-limiting VCL indicators in response headers
	for key, values := range baseResp.Header {
		lower := strings.ToLower(key)
		if strings.Contains(lower, "rate") && strings.Contains(lower, "limit") {
			feature.Detected = true
			feature.Evidence = key + ": " + strings.Join(values, ", ")
			return feature
		}
	}

	return feature
}
