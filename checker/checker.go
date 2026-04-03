package checker

import (
	"net/url"
	"strings"
	"sync"
	"time"
)

// Run executes all checks against the given URL and returns the result.
func Run(rawURL string) *Result {
	rawURL = normalizeURL(rawURL)
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return &Result{
			URL:       rawURL,
			Timestamp: time.Now().UTC(),
			Insights: []Insight{{
				Severity: "error",
				Category: "dns",
				Message:  "Invalid URL: " + err.Error(),
			}},
		}
	}

	hostname := parsed.Hostname()
	port := parsed.Port()
	if port == "" {
		if parsed.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}

	start := time.Now()

	var dnsResult *DNSResult
	var httpResult *HTTPResult
	var tlsResult *TLSResult

	var wg sync.WaitGroup
	wg.Add(3)

	go func() {
		defer wg.Done()
		dnsResult = checkDNS(hostname)
	}()

	go func() {
		defer wg.Done()
		httpResult = checkHTTP(rawURL)
	}()

	go func() {
		defer wg.Done()
		tlsResult = checkTLS(hostname, port)
	}()

	wg.Wait()

	duration := time.Since(start)
	insights := generateInsights(dnsResult, httpResult, tlsResult)

	return &Result{
		URL:        rawURL,
		Timestamp:  time.Now().UTC(),
		DurationMS: duration.Milliseconds(),
		DNS:        dnsResult,
		HTTP:       httpResult,
		TLS:        tlsResult,
		Insights:   insights,
	}
}

// normalizeURL ensures the URL has a scheme.
func normalizeURL(rawURL string) string {
	rawURL = strings.TrimSpace(rawURL)
	if !strings.HasPrefix(rawURL, "http://") && !strings.HasPrefix(rawURL, "https://") {
		rawURL = "https://" + rawURL
	}
	return rawURL
}
