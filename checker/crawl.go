package checker

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	crawlMaxPages   = 100 // max pages per crawl
	crawlMaxBody    = 2 * 1024 * 1024
	crawlTimeout    = 10 * time.Second
	crawlConcurrent = 10
)

var reAnchorHref = regexp.MustCompile(`(?is)<a\s[^>]*?href\s*=\s*["']([^"'#]+)["']`)

// CrawlSite crawls a site starting from rawURL up to the given depth (1-3).
// Depth 1 = only the start URL, depth 2 = start + discovered links, depth 3 = two levels deep.
func CrawlSite(rawURL string, depth int) *CrawlResult {
	start := time.Now()

	rawURL = normalizeURL(rawURL)
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return &CrawlResult{URL: rawURL, Error: "invalid URL: " + err.Error(), DurationMS: time.Since(start).Milliseconds()}
	}

	if depth < 1 {
		depth = 1
	}
	if depth > 3 {
		depth = 3
	}

	origin := parsed.Scheme + "://" + parsed.Host
	hostname := parsed.Hostname()

	client := &http.Client{
		Timeout: crawlTimeout,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12},
			MaxIdleConnsPerHost: crawlConcurrent,
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return fmt.Errorf("too many redirects")
			}
			return nil
		},
	}

	visited := &sync.Map{}
	var pages []CrawlPage
	var mu sync.Mutex

	addPage := func(p CrawlPage) {
		mu.Lock()
		pages = append(pages, p)
		mu.Unlock()
	}

	pageCount := func() int {
		mu.Lock()
		defer mu.Unlock()
		return len(pages)
	}

	// BFS crawl
	type crawlItem struct {
		url   string
		depth int
	}

	queue := []crawlItem{{url: rawURL, depth: 0}}
	visited.Store(normalizeForVisit(rawURL), true)

	for currentDepth := 0; currentDepth < depth; currentDepth++ {
		// Collect items at this depth level
		var batch []crawlItem
		for _, item := range queue {
			if item.depth == currentDepth {
				batch = append(batch, item)
			}
		}

		if len(batch) == 0 {
			break
		}

		// Process batch concurrently
		sem := make(chan struct{}, crawlConcurrent)
		var wg sync.WaitGroup

		for _, item := range batch {
			if pageCount() >= crawlMaxPages {
				break
			}

			wg.Add(1)
			sem <- struct{}{}

			go func(ci crawlItem) {
				defer wg.Done()
				defer func() { <-sem }()

				page, links := crawlPage(client, ci.url, hostname, ci.depth)
				addPage(page)

				// Queue discovered links for next depth
				if ci.depth+1 < depth {
					for _, link := range links {
						absURL := resolveLink(link, origin, parsed)
						if absURL == "" {
							continue
						}
						// Only crawl same-host URLs
						linkParsed, err := url.Parse(absURL)
						if err != nil || linkParsed.Host != parsed.Host {
							continue
						}
						key := normalizeForVisit(absURL)
						if _, loaded := visited.LoadOrStore(key, true); !loaded {
							mu.Lock()
							queue = append(queue, crawlItem{url: absURL, depth: ci.depth + 1})
							mu.Unlock()
						}
					}
				}
			}(item)
		}
		wg.Wait()
	}

	errors := 0
	for _, p := range pages {
		if p.Error != "" || p.StatusCode >= 400 {
			errors++
		}
	}

	return &CrawlResult{
		URL:        rawURL,
		Depth:      depth,
		TotalPages: len(pages),
		Pages:      pages,
		Errors:     errors,
		DurationMS: time.Since(start).Milliseconds(),
	}
}

// CompareSites crawls two sites and produces a diff report.
func CompareSites(urlA, urlB string, depth int) *CompareResult {
	start := time.Now()

	var siteA, siteB *CrawlResult
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		siteA = CrawlSite(urlA, depth)
	}()
	go func() {
		defer wg.Done()
		siteB = CrawlSite(urlB, depth)
	}()
	wg.Wait()

	parsedA, _ := url.Parse(normalizeURL(urlA))
	parsedB, _ := url.Parse(normalizeURL(urlB))

	// Index pages by path
	indexA := indexByPath(siteA.Pages, parsedA)
	indexB := indexByPath(siteB.Pages, parsedB)

	var matches []CompareMatch
	var statusDiffs []CompareMatch
	var onlyInA, onlyInB []string

	allPaths := make(map[string]bool)
	for p := range indexA {
		allPaths[p] = true
	}
	for p := range indexB {
		allPaths[p] = true
	}

	for path := range allPaths {
		pageA, inA := indexA[path]
		pageB, inB := indexB[path]

		if inA && inB {
			match := pageA.StatusCode == pageB.StatusCode
			cm := CompareMatch{
				Path:        path,
				StatusCodeA: pageA.StatusCode,
				StatusCodeB: pageB.StatusCode,
				Match:       match,
			}
			matches = append(matches, cm)
			if !match {
				statusDiffs = append(statusDiffs, cm)
			}
		} else if inA {
			onlyInA = append(onlyInA, path)
		} else {
			onlyInB = append(onlyInB, path)
		}
	}

	matchRate := 0.0
	if len(allPaths) > 0 {
		matched := 0
		for _, m := range matches {
			if m.Match {
				matched++
			}
		}
		matchRate = float64(matched) / float64(len(allPaths))
	}

	return &CompareResult{
		SiteA:       siteA,
		SiteB:       siteB,
		Matches:     matches,
		OnlyInA:     onlyInA,
		OnlyInB:     onlyInB,
		StatusDiffs: statusDiffs,
		MatchRate:   matchRate,
		DurationMS:  time.Since(start).Milliseconds(),
	}
}

// crawlPage fetches a single page and extracts links.
func crawlPage(client *http.Client, pageURL, hostname string, depth int) (CrawlPage, []string) {
	start := time.Now()

	ctx, cancel := context.WithTimeout(context.Background(), crawlTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", pageURL, nil)
	if err != nil {
		return CrawlPage{URL: pageURL, Depth: depth, Error: err.Error(), DurationMS: time.Since(start).Milliseconds()}, nil
	}
	req.Header.Set("User-Agent", "ps-site-check/1.0 (crawler)")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")

	resp, err := client.Do(req)
	if err != nil {
		return CrawlPage{URL: pageURL, Depth: depth, Error: err.Error(), DurationMS: time.Since(start).Milliseconds()}, nil
	}
	defer resp.Body.Close()

	page := CrawlPage{
		URL:        pageURL,
		StatusCode: resp.StatusCode,
		Depth:      depth,
		DurationMS: time.Since(start).Milliseconds(),
	}

	// Only parse HTML for links
	ct := resp.Header.Get("Content-Type")
	if !strings.Contains(ct, "text/html") && !strings.Contains(ct, "application/xhtml") {
		return page, nil
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, int64(crawlMaxBody)))
	if err != nil {
		return page, nil
	}

	html := string(body)

	// Extract title
	if m := reTitle.FindStringSubmatch(html); m != nil {
		page.Title = strings.TrimSpace(reStripHTML.ReplaceAllString(m[1], ""))
	}

	// Extract links
	linkMatches := reAnchorHref.FindAllStringSubmatch(html, -1)
	var links []string
	for _, m := range linkMatches {
		href := strings.TrimSpace(m[1])
		if href != "" && !strings.HasPrefix(href, "javascript:") && !strings.HasPrefix(href, "mailto:") && !strings.HasPrefix(href, "tel:") {
			links = append(links, href)
		}
	}

	return page, links
}

// resolveLink converts a relative link to absolute.
func resolveLink(href, origin string, base *url.URL) string {
	if strings.HasPrefix(href, "http://") || strings.HasPrefix(href, "https://") {
		return href
	}
	if strings.HasPrefix(href, "//") {
		return base.Scheme + ":" + href
	}
	if strings.HasPrefix(href, "/") {
		return origin + href
	}
	// Relative path
	ref, err := url.Parse(href)
	if err != nil {
		return ""
	}
	return base.ResolveReference(ref).String()
}

// normalizeForVisit strips fragments and trailing slashes for deduplication.
func normalizeForVisit(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	parsed.Fragment = ""
	result := parsed.String()
	result = strings.TrimRight(result, "/")
	return result
}

// indexByPath creates a map of URL path -> CrawlPage for comparison.
func indexByPath(pages []CrawlPage, base *url.URL) map[string]CrawlPage {
	idx := make(map[string]CrawlPage, len(pages))
	for _, p := range pages {
		parsed, err := url.Parse(p.URL)
		if err != nil {
			continue
		}
		path := parsed.Path
		if path == "" {
			path = "/"
		}
		path = strings.TrimRight(path, "/")
		if path == "" {
			path = "/"
		}
		// Include query string in path for differentiation
		if parsed.RawQuery != "" {
			path += "?" + parsed.RawQuery
		}
		idx[path] = p
	}
	return idx
}

// dialContextForResolve creates a DialContext that resolves to a specific IP.
func dialContextForResolve(resolveIP string) func(ctx context.Context, network, addr string) (net.Conn, error) {
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		_, port, _ := net.SplitHostPort(addr)
		return (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, network, net.JoinHostPort(resolveIP, port))
	}
}
