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
	var dnsMulti []DNSPathResult
	var httpResult *HTTPResult
	var tlsResult *TLSResult

	var wg sync.WaitGroup
	wg.Add(4)

	go func() {
		defer wg.Done()
		dnsResult = checkDNS(hostname)
	}()

	go func() {
		defer wg.Done()
		dnsMulti = checkDNSMultiPath(hostname)
	}()

	go func() {
		defer wg.Done()
		httpResult = checkHTTP(rawURL, hostname, opts)
	}()

	go func() {
		defer wg.Done()
		tlsResult = checkTLS(hostname, port, opts)
	}()

	wg.Wait()

	result := &Result{
		ID:        generateID(),
		URL:       rawURL,
		ResolveIP: opts.ResolveIP,
		Timestamp: time.Now().UTC(),
		DNS:       dnsResult,
		DNSMulti:  dnsMulti,
		HTTP:      httpResult,
		TLS:       tlsResult,
	}

	// Double-request mode: second request after 2s to compare MISS→HIT
	if opts.DoubleRequest && httpResult != nil && httpResult.Error == "" {
		time.Sleep(2 * time.Second)
		result.SecondHTTP = checkHTTP(rawURL, hostname, opts)
	}

	// Cache warmup test: make N sequential requests and measure hit ratio
	if opts.WarmupRequests >= 2 && httpResult != nil && httpResult.Error == "" {
		result.Warmup = runWarmup(rawURL, hostname, opts)
	}

	// Redirect chain tracing
	if opts.FollowRedirects && httpResult != nil && httpResult.StatusCode >= 300 && httpResult.StatusCode < 400 {
		result.RedirectChain = traceRedirects(rawURL, hostname, opts)
	}

	result.DurationMS = time.Since(start).Milliseconds()
	result.Insights = generateInsights(dnsResult, dnsMulti, httpResult, result.SecondHTTP, result.Warmup, tlsResult, result.RedirectChain, opts.ResolveIP)

	return result
}

// RunBatch checks multiple URLs concurrently (max 10).
func RunBatch(urls []string, opts Options) *BatchResult {
	start := time.Now()

	if len(urls) > 10 {
		urls = urls[:10]
	}

	results := make([]*Result, len(urls))
	var wg sync.WaitGroup

	for i, u := range urls {
		wg.Add(1)
		go func(idx int, rawURL string) {
			defer wg.Done()
			results[idx] = Run(rawURL, opts)
		}(i, u)
	}
	wg.Wait()

	return &BatchResult{
		Results:   results,
		TotalMS:   time.Since(start).Milliseconds(),
		TotalURLs: len(urls),
	}
}

// runWarmup makes N sequential requests and calculates cache hit ratio.
func runWarmup(rawURL, hostname string, opts Options) *WarmupResult {
	result := &WarmupResult{
		TotalRequests: opts.WarmupRequests,
		Requests:      make([]WarmupRequest, 0, opts.WarmupRequests),
	}

	for i := 0; i < opts.WarmupRequests; i++ {
		if i > 0 {
			time.Sleep(500 * time.Millisecond)
		}
		resp := checkHTTP(rawURL, hostname, opts)
		xCache := resp.Headers["x-cache"]

		req := WarmupRequest{
			Sequence:   i + 1,
			XCache:     xCache,
			StatusCode: resp.StatusCode,
			DurationMS: resp.DurationMS,
		}
		result.Requests = append(result.Requests, req)

		if strings.Contains(strings.ToUpper(xCache), "HIT") {
			result.Hits++
		} else {
			result.Misses++
		}
	}

	if result.TotalRequests > 0 {
		result.HitRatio = float64(result.Hits) / float64(result.TotalRequests)
	}

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
