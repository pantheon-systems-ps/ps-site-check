package checker

import (
	"context"
	"crypto/tls"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	resourceMaxCheck   = 50 // max resources to check per page
	resourceConcurrent = 10
	resourceTimeout    = 8 * time.Second
)

var (
	reLinkHref   = regexp.MustCompile(`(?is)<link\s[^>]*?href\s*=\s*["']([^"']+)["']`)
	reScriptSrc  = regexp.MustCompile(`(?is)<script\s[^>]*?src\s*=\s*["']([^"']+)["']`)
	reImgSrc     = regexp.MustCompile(`(?is)<img\s[^>]*?src\s*=\s*["']([^"']+)["']`)
	reSourceSrc  = regexp.MustCompile(`(?is)<source\s[^>]*?src\s*=\s*["']([^"']+)["']`)
	reLinkRel    = regexp.MustCompile(`(?is)rel\s*=\s*["']([^"']+)["']`)
)

// AuditResources fetches a page and checks all linked CSS, JS, and image resources.
func AuditResources(rawURL string, opts Options) *ResourceAudit {
	start := time.Now()

	rawURL = normalizeURL(rawURL)
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return &ResourceAudit{URL: rawURL, Error: "invalid URL: " + err.Error(), DurationMS: time.Since(start).Milliseconds()}
	}

	hostname := parsed.Hostname()
	origin := parsed.Scheme + "://" + parsed.Host

	client := seoHTTPClient(hostname, opts)

	// Fetch the page HTML
	body, fetchErr := seoFetchBody(client, rawURL, opts, seoMaxBodySize)
	if fetchErr != "" {
		return &ResourceAudit{URL: rawURL, Error: fetchErr, DurationMS: time.Since(start).Milliseconds()}
	}

	// Extract resource URLs
	resources := extractResources(body, origin, parsed)

	// Limit to max
	if len(resources) > resourceMaxCheck {
		resources = resources[:resourceMaxCheck]
	}

	// HEAD-check each resource concurrently
	headClient := &http.Client{
		Timeout: resourceTimeout,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12},
			MaxIdleConnsPerHost: resourceConcurrent,
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return http.ErrUseLastResponse
			}
			return nil
		},
	}

	if opts.ResolveIP != "" {
		headClient.Transport = &http.Transport{
			TLSClientConfig: &tls.Config{
				MinVersion: tls.VersionTLS12,
				ServerName: hostname,
				InsecureSkipVerify: true,
			},
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				_, port, _ := net.SplitHostPort(addr)
				return (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, network, net.JoinHostPort(opts.ResolveIP, port))
			},
			MaxIdleConnsPerHost: resourceConcurrent,
		}
	}

	checked := make([]ResourceCheck, len(resources))
	sem := make(chan struct{}, resourceConcurrent)
	var wg sync.WaitGroup

	for i, res := range resources {
		wg.Add(1)
		sem <- struct{}{}

		go func(idx int, r resourceEntry) {
			defer wg.Done()
			defer func() { <-sem }()

			checked[idx] = checkResource(headClient, r, opts)
		}(i, res)
	}
	wg.Wait()

	// Tally results
	audit := &ResourceAudit{
		URL:            rawURL,
		TotalResources: len(checked),
		Resources:      checked,
		DurationMS:     time.Since(start).Milliseconds(),
	}

	for _, r := range checked {
		switch r.Status {
		case "ok":
			audit.Healthy++
		case "broken":
			audit.Broken++
		case "error":
			audit.Errors++
		}
	}

	return audit
}

type resourceEntry struct {
	url      string
	resType  string
}

// extractResources parses HTML to find CSS, JS, and image resource URLs.
func extractResources(html, origin string, base *url.URL) []resourceEntry {
	seen := make(map[string]bool)
	var resources []resourceEntry

	add := func(rawHref, resType string) {
		href := strings.TrimSpace(rawHref)
		if href == "" || strings.HasPrefix(href, "data:") || strings.HasPrefix(href, "javascript:") {
			return
		}
		absURL := resolveResourceURL(href, origin, base)
		if absURL == "" {
			return
		}
		if seen[absURL] {
			return
		}
		seen[absURL] = true
		resources = append(resources, resourceEntry{url: absURL, resType: resType})
	}

	// CSS: <link rel="stylesheet" href="...">
	linkMatches := reLinkHref.FindAllStringSubmatch(html, -1)
	for _, m := range linkMatches {
		fullTag := m[0]
		href := m[1]
		// Only include stylesheet links
		relMatch := reLinkRel.FindStringSubmatch(fullTag)
		if relMatch != nil {
			rel := strings.ToLower(relMatch[1])
			if strings.Contains(rel, "stylesheet") {
				add(href, "css")
			}
			// Skip non-resource links (canonical, alternate, preconnect, etc.)
			continue
		}
		// If no rel attribute and href ends in .css, include it
		if strings.HasSuffix(strings.ToLower(href), ".css") {
			add(href, "css")
		}
	}

	// JS: <script src="...">
	for _, m := range reScriptSrc.FindAllStringSubmatch(html, -1) {
		add(m[1], "js")
	}

	// Images: <img src="...">
	for _, m := range reImgSrc.FindAllStringSubmatch(html, -1) {
		add(m[1], "image")
	}

	// Media: <source src="...">
	for _, m := range reSourceSrc.FindAllStringSubmatch(html, -1) {
		add(m[1], "other")
	}

	return resources
}

// resolveResourceURL resolves a resource URL to absolute.
func resolveResourceURL(href, origin string, base *url.URL) string {
	if strings.HasPrefix(href, "http://") || strings.HasPrefix(href, "https://") {
		return href
	}
	if strings.HasPrefix(href, "//") {
		return base.Scheme + ":" + href
	}
	if strings.HasPrefix(href, "/") {
		return origin + href
	}
	ref, err := url.Parse(href)
	if err != nil {
		return ""
	}
	return base.ResolveReference(ref).String()
}

// checkResource performs a HEAD request to verify a resource loads.
func checkResource(client *http.Client, res resourceEntry, opts Options) ResourceCheck {
	start := time.Now()

	rc := ResourceCheck{
		URL:  res.url,
		Type: res.resType,
	}

	req, err := http.NewRequest("HEAD", res.url, nil)
	if err != nil {
		rc.Status = "error"
		rc.Error = err.Error()
		rc.DurationMS = time.Since(start).Milliseconds()
		return rc
	}

	ua := opts.UserAgent
	if ua == "" {
		ua = "ps-site-check/1.0"
	}
	req.Header.Set("User-Agent", ua)

	resp, err := client.Do(req)
	if err != nil {
		rc.Status = "error"
		rc.Error = err.Error()
		rc.DurationMS = time.Since(start).Milliseconds()
		return rc
	}
	defer resp.Body.Close()

	rc.StatusCode = resp.StatusCode
	rc.DurationMS = time.Since(start).Milliseconds()

	if resp.StatusCode >= 200 && resp.StatusCode < 400 {
		rc.Status = "ok"
	} else {
		rc.Status = "broken"
	}

	return rc
}
