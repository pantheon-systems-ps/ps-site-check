package checker

import (
	"crypto/tls"
	"net/http"
	"strings"
	"time"
)

// agcdnHeaders is the curated list of AGCDN-relevant headers to extract.
var agcdnHeaders = []string{
	"date",
	"server",
	"cache-control",
	"x-served-by",
	"x-cache",
	"x-cache-hits",
	"set-cookie",
	"vary",
	"agcdn-info",
	"fastly-io-info",
	"x-var-req-md-key",
	"x-var-req-md-payload",
	"x-timer",
	"x-pantheon-styx-hostname",
	"x-styx-req-id",
	"x-drupal-dynamic-cache",
	"x-generator",
	"age",
	"surrogate-key",
	"surrogate-control",
	"x-frame-options",
	"strict-transport-security",
	"content-security-policy",
}

// checkHTTP performs an HTTP GET with debug headers and extracts response data.
func checkHTTP(url string) *HTTPResult {
	start := time.Now()

	client := &http.Client{
		Timeout: 15 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				MinVersion: tls.VersionTLS12,
			},
		},
		// Don't follow redirects — we want to see the first response
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return &HTTPResult{Error: "failed to create request: " + err.Error()}
	}

	// Debug headers for Pantheon/Fastly
	req.Header.Set("Pantheon-Debug", "1")
	req.Header.Set("Fastly-Debug", "1")
	req.Header.Set("User-Agent", "ps-site-check/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return &HTTPResult{
			Error:      "request failed: " + err.Error(),
			DurationMS: time.Since(start).Milliseconds(),
		}
	}
	defer resp.Body.Close()

	// Collect all response headers
	allHeaders := make(map[string]string)
	for key := range resp.Header {
		allHeaders[strings.ToLower(key)] = resp.Header.Get(key)
	}

	// Extract AGCDN-specific headers with insights
	agcdn := extractAGCDNHeaders(allHeaders)

	return &HTTPResult{
		StatusCode:   resp.StatusCode,
		Headers:      allHeaders,
		AGCDNHeaders: agcdn,
		DurationMS:   time.Since(start).Milliseconds(),
	}
}

// extractAGCDNHeaders filters and annotates AGCDN-relevant headers.
func extractAGCDNHeaders(headers map[string]string) []AGCDNHeader {
	var result []AGCDNHeader

	for _, name := range agcdnHeaders {
		value, ok := headers[name]
		if !ok {
			continue
		}
		result = append(result, AGCDNHeader{
			Header:  name,
			Value:   value,
			Insight: headerInsight(name, value),
		})
	}

	return result
}

// headerInsight provides curated commentary for known header values.
func headerInsight(header, value string) string {
	lower := strings.ToLower(value)

	switch header {
	case "x-cache":
		return xCacheInsight(value)
	case "cache-control":
		return cacheControlInsight(lower)
	case "age":
		return ageInsight(value)
	case "vary":
		return varyInsight(lower)
	case "server":
		return serverInsight(lower)
	case "x-served-by":
		return "Fastly cache nodes that handled the request"
	case "x-cache-hits":
		return "Cache hit counts per node in the serving chain"
	case "agcdn-info":
		return "AGCDN is active on this domain"
	case "fastly-io-info":
		return "Fastly Image Optimization is active"
	case "x-pantheon-styx-hostname":
		return "Request was routed through Pantheon Styx edge"
	case "x-drupal-dynamic-cache":
		if lower == "miss" {
			return "Drupal dynamic page cache missed — page was rendered on this request"
		}
		return "Drupal dynamic page cache: " + value
	case "x-generator":
		return "CMS identified: " + value
	case "strict-transport-security":
		return hSTSInsight(lower)
	case "surrogate-control":
		return "CDN-level cache control directive"
	case "surrogate-key":
		return "Cache tags for targeted purging"
	}

	return ""
}

func xCacheInsight(value string) string {
	parts := strings.Split(value, ",")
	var segments []string
	for i, part := range parts {
		part = strings.TrimSpace(part)
		switch {
		case strings.EqualFold(part, "HIT"):
			segments = append(segments, nodeLabel(i)+": cache hit")
		case strings.EqualFold(part, "MISS"):
			segments = append(segments, nodeLabel(i)+": cache miss")
		default:
			segments = append(segments, nodeLabel(i)+": "+part)
		}
	}
	return strings.Join(segments, "; ")
}

func nodeLabel(i int) string {
	switch i {
	case 0:
		return "Edge"
	case 1:
		return "Shield"
	default:
		return "Origin"
	}
}

func cacheControlInsight(value string) string {
	if strings.Contains(value, "no-cache") || strings.Contains(value, "no-store") {
		return "Content is not cacheable at the CDN"
	}
	if strings.Contains(value, "private") {
		return "Content is private — CDN should not cache"
	}
	if strings.Contains(value, "public") && strings.Contains(value, "max-age") {
		return "Content is publicly cacheable"
	}
	if strings.Contains(value, "max-age=0") {
		return "max-age=0 — cache must revalidate on every request"
	}
	return ""
}

func ageInsight(value string) string {
	return "Object has been in cache for " + value + " seconds"
}

func varyInsight(value string) string {
	if strings.Contains(value, "cookie") {
		return "Vary includes Cookie — reduces cache hit ratio; requests with different cookies are cached separately"
	}
	return ""
}

func serverInsight(value string) string {
	switch {
	case strings.Contains(value, "nginx"):
		return "Origin server is nginx (typical for Pantheon)"
	case strings.Contains(value, "apache"):
		return "Origin server is Apache"
	default:
		return ""
	}
}

func hSTSInsight(value string) string {
	if strings.Contains(value, "max-age=300") {
		return "HSTS max-age is only 300s (5 min) — consider increasing for production"
	}
	if strings.Contains(value, "includesubdomains") {
		return "HSTS covers subdomains"
	}
	return ""
}
