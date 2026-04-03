package checker

import (
	"crypto/rand"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Run executes all checks against the given URL and returns the result.
func Run(rawURL string, opts Options) *Result {
	rawURL = normalizeURL(rawURL)
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return &Result{
			ID:        generateID(),
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

	result := &Result{
		ID:        generateID(),
		URL:       rawURL,
		Timestamp: time.Now().UTC(),
		DNS:       dnsResult,
		HTTP:      httpResult,
		TLS:       tlsResult,
	}

	// Double-request mode: second request after 2s to compare MISS→HIT
	if opts.DoubleRequest && httpResult != nil && httpResult.Error == "" {
		time.Sleep(2 * time.Second)
		result.SecondHTTP = checkHTTP(rawURL)
	}

	// Redirect chain tracing
	if opts.FollowRedirects && httpResult != nil && httpResult.StatusCode >= 300 && httpResult.StatusCode < 400 {
		result.RedirectChain = traceRedirects(rawURL)
	}

	result.DurationMS = time.Since(start).Milliseconds()
	result.Insights = generateInsights(dnsResult, httpResult, result.SecondHTTP, tlsResult, result.RedirectChain)

	return result
}

// normalizeURL ensures the URL has a scheme.
func normalizeURL(rawURL string) string {
	rawURL = strings.TrimSpace(rawURL)
	if !strings.HasPrefix(rawURL, "http://") && !strings.HasPrefix(rawURL, "https://") {
		rawURL = "https://" + rawURL
	}
	return rawURL
}

// generateID creates a short unique ID for result permalinks.
func generateID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return fmt.Sprintf("%x", b)
}
