package checker

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// ── Compiled regex patterns for HTML parsing ────────────────────────

var (
	reTitle       = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	reMetaDesc    = regexp.MustCompile(`(?is)<meta\s[^>]*?name\s*=\s*["']description["'][^>]*?>`)
	reMetaContent = regexp.MustCompile(`(?is)content\s*=\s*["'](.*?)["']`)
	reCanonical   = regexp.MustCompile(`(?is)<link\s[^>]*?rel\s*=\s*["']canonical["'][^>]*?>`)
	reHref        = regexp.MustCompile(`(?is)href\s*=\s*["'](.*?)["']`)
	reOGMeta      = regexp.MustCompile(`(?is)<meta\s[^>]*?property\s*=\s*["'](og:[^"']+)["'][^>]*?>`)
	reTwitterMeta = regexp.MustCompile(`(?is)<meta\s[^>]*?name\s*=\s*["'](twitter:[^"']+)["'][^>]*?>`)
	reH1          = regexp.MustCompile(`(?is)<h1[^>]*>(.*?)</h1>`)
	reH2          = regexp.MustCompile(`(?is)<h2[^>]*>`)
	reH3          = regexp.MustCompile(`(?is)<h3[^>]*>`)
	reImg         = regexp.MustCompile(`(?is)<img\s[^>]*?>`)
	reAlt         = regexp.MustCompile(`(?is)\balt\s*=\s*["']([^"']*)["']`)
	reLDJSON      = regexp.MustCompile(`(?is)<script[^>]*?type\s*=\s*["']application/ld\+json["'][^>]*?>(.*?)</script>`)
	reHreflang    = regexp.MustCompile(`(?is)<link\s[^>]*?rel\s*=\s*["']alternate["'][^>]*?hreflang\s*=\s*["']([^"']+)["'][^>]*?>`)
	reMixedSrc    = regexp.MustCompile(`(?is)\b(?:src|href|action)\s*=\s*["'](http://[^"']+)["']`)
	reSitemapLine = regexp.MustCompile(`(?im)^Sitemap:\s*(\S+)`)
	reDisallowAll = regexp.MustCompile(`(?im)^Disallow:\s*/\s*$`)
	reBlockCSS    = regexp.MustCompile(`(?im)^Disallow:.*\.css`)
	reBlockJS     = regexp.MustCompile(`(?im)^Disallow:.*\.js`)
	reSitemapLoc  = regexp.MustCompile(`(?is)<loc>(.*?)</loc>`)
	reStripHTML   = regexp.MustCompile(`<[^>]*>`)
	// Pattern for OG meta where property comes after content
	reOGMetaRev = regexp.MustCompile(`(?is)<meta\s[^>]*?content\s*=\s*["']([^"']*)["'][^>]*?property\s*=\s*["'](og:[^"']+)["'][^>]*?>`)
	// Pattern for Twitter meta where name comes after content
	reTwitterMetaRev = regexp.MustCompile(`(?is)<meta\s[^>]*?content\s*=\s*["']([^"']*)["'][^>]*?name\s*=\s*["'](twitter:[^"']+)["'][^>]*?>`)
	// Pattern for meta description where name comes after content
	reMetaDescRev = regexp.MustCompile(`(?is)<meta\s[^>]*?content\s*=\s*["']([^"']*)["'][^>]*?name\s*=\s*["']description["'][^>]*?>`)
)

const (
	seoMaxBodySize    = 5 * 1024 * 1024 // 5 MB
	seoSitemapMaxSize = 2 * 1024 * 1024 // 2 MB
)

// AuditSEO performs an SEO audit by fetching and parsing HTML, robots.txt, and sitemap.xml.
func AuditSEO(rawURL string, opts Options) *SEOAudit {
	start := time.Now()

	rawURL = normalizeURL(rawURL)
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return &SEOAudit{
			URL:        rawURL,
			Error:      "invalid URL: " + err.Error(),
			DurationMS: time.Since(start).Milliseconds(),
		}
	}

	hostname := parsed.Hostname()
	origin := parsed.Scheme + "://" + parsed.Host
	isHTTPS := parsed.Scheme == "https"

	client := seoHTTPClient(hostname, opts)

	// Fetch the HTML page.
	body, fetchErr := seoFetchBody(client, rawURL, opts, seoMaxBodySize)
	if fetchErr != "" {
		return &SEOAudit{
			URL:        rawURL,
			Error:      fetchErr,
			DurationMS: time.Since(start).Milliseconds(),
		}
	}

	audit := &SEOAudit{URL: rawURL}
	var issues []string

	// 1. Title
	audit.Title = parseTitle(body)
	if audit.Title.Rating == "missing" {
		issues = append(issues, "Page is missing a <title> tag")
	} else if audit.Title.Rating == "too_short" {
		issues = append(issues, fmt.Sprintf("Title is too short (%d chars, recommended 30-60)", audit.Title.Length))
	} else if audit.Title.Rating == "too_long" {
		issues = append(issues, fmt.Sprintf("Title is too long (%d chars, recommended 30-60)", audit.Title.Length))
	}

	// 2. Meta description
	audit.Description = parseMetaDescription(body)
	if audit.Description.Rating == "missing" {
		issues = append(issues, "Page is missing a meta description")
	} else if audit.Description.Rating == "too_short" {
		issues = append(issues, fmt.Sprintf("Meta description is too short (%d chars, recommended 120-160)", audit.Description.Length))
	} else if audit.Description.Rating == "too_long" {
		issues = append(issues, fmt.Sprintf("Meta description is too long (%d chars, recommended 120-160)", audit.Description.Length))
	}

	// 3. Canonical
	audit.Canonical = parseCanonical(body)
	if audit.Canonical == "" {
		issues = append(issues, "No canonical URL specified")
	}

	// 4. Open Graph tags
	audit.OpenGraph = parseOpenGraph(body)
	if _, ok := audit.OpenGraph["og:title"]; !ok {
		issues = append(issues, "Missing og:title Open Graph tag")
	}
	if _, ok := audit.OpenGraph["og:description"]; !ok {
		issues = append(issues, "Missing og:description Open Graph tag")
	}

	// 5. Twitter Card tags
	audit.TwitterCard = parseTwitterCard(body)

	// 6. Headings
	audit.Headings = parseHeadings(body)
	issues = append(issues, audit.Headings.Issues...)

	// 7. Images
	audit.Images = parseImages(body)
	if audit.Images.Total > 0 && audit.Images.Rating == "bad" {
		issues = append(issues, fmt.Sprintf("Only %d/%d images have alt text (< 80%%)", audit.Images.WithAlt, audit.Images.Total))
	} else if audit.Images.Total > 0 && audit.Images.Rating == "warning" {
		issues = append(issues, fmt.Sprintf("%d/%d images missing alt text", audit.Images.WithoutAlt, audit.Images.Total))
	}

	// 8. Structured data
	audit.StructuredData = parseStructuredData(body)

	// 9. Hreflang
	audit.Hreflang = parseHreflang(body)

	// 10. Mixed content
	if isHTTPS {
		audit.MixedContent = detectMixedContent(body)
		if len(audit.MixedContent) > 0 {
			issues = append(issues, fmt.Sprintf("Found %d mixed content reference(s) (http:// on HTTPS page)", len(audit.MixedContent)))
		}
	}

	// 11. robots.txt
	audit.RobotsTxt = fetchRobotsTxt(client, origin, opts)
	if !audit.RobotsTxt.Found {
		issues = append(issues, "robots.txt not found")
	}
	issues = append(issues, audit.RobotsTxt.Issues...)

	// 12. Sitemap
	audit.Sitemap = fetchSitemap(client, origin, audit.RobotsTxt.Sitemaps, opts)
	if !audit.Sitemap.Found {
		issues = append(issues, "sitemap.xml not found")
	}
	issues = append(issues, audit.Sitemap.Issues...)

	audit.Issues = issues

	// 13. Score
	audit.Score = calculateSEOScore(audit)

	audit.DurationMS = time.Since(start).Milliseconds()
	return audit
}

// ── HTTP helpers ────────────────────────────────────────────────────

// seoHTTPClient creates an HTTP client matching the project's transport patterns.
func seoHTTPClient(hostname string, opts Options) *http.Client {
	transport := &http.Transport{
		TLSClientConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
		},
	}

	if opts.ResolveIP != "" {
		transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
			_, port, _ := net.SplitHostPort(addr)
			return (&net.Dialer{Timeout: 10 * time.Second}).DialContext(
				ctx, network, net.JoinHostPort(opts.ResolveIP, port),
			)
		}
		transport.TLSClientConfig.ServerName = hostname
		transport.TLSClientConfig.InsecureSkipVerify = true
	}

	return &http.Client{
		Timeout:   15 * time.Second,
		Transport: transport,
		// Follow redirects for SEO — we want the final rendered page.
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return fmt.Errorf("too many redirects")
			}
			return nil
		},
	}
}

// seoFetchBody fetches a URL and returns the body as a string, limited to maxBytes.
// Returns ("", errorMessage) on failure.
func seoFetchBody(client *http.Client, targetURL string, opts Options, maxBytes int64) (string, string) {
	req, err := http.NewRequest("GET", targetURL, nil)
	if err != nil {
		return "", "failed to create request: " + err.Error()
	}

	ua := opts.UserAgent
	if ua == "" {
		ua = "ps-site-check/1.0"
	}
	req.Header.Set("User-Agent", ua)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")

	resp, err := client.Do(req)
	if err != nil {
		return "", "request failed: " + err.Error()
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return "", fmt.Sprintf("HTTP %d fetching page", resp.StatusCode)
	}

	limited := io.LimitReader(resp.Body, maxBytes)
	b, err := io.ReadAll(limited)
	if err != nil {
		return "", "error reading body: " + err.Error()
	}

	return string(b), ""
}

// seoGet performs a simple GET and returns the body string, status, and any error.
func seoGet(client *http.Client, targetURL string, opts Options, maxBytes int64) (string, int, error) {
	req, err := http.NewRequest("GET", targetURL, nil)
	if err != nil {
		return "", 0, err
	}

	ua := opts.UserAgent
	if ua == "" {
		ua = "ps-site-check/1.0"
	}
	req.Header.Set("User-Agent", ua)

	resp, err := client.Do(req)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()

	limited := io.LimitReader(resp.Body, maxBytes)
	b, err := io.ReadAll(limited)
	if err != nil {
		return "", resp.StatusCode, err
	}

	return string(b), resp.StatusCode, nil
}

// ── HTML parsing helpers ────────────────────────────────────────────

// parseTitle extracts and rates the <title> tag.
func parseTitle(html string) *MetaTag {
	m := reTitle.FindStringSubmatch(html)
	if m == nil {
		return &MetaTag{Rating: "missing"}
	}

	text := strings.TrimSpace(reStripHTML.ReplaceAllString(m[1], ""))
	length := len(text)

	rating := "good"
	switch {
	case length == 0:
		rating = "missing"
	case length < 30:
		rating = "too_short"
	case length > 60:
		rating = "too_long"
	}

	return &MetaTag{Value: text, Length: length, Rating: rating}
}

// parseMetaDescription extracts and rates the meta description.
func parseMetaDescription(html string) *MetaTag {
	// Try standard order: name="description" ... content="..."
	m := reMetaDesc.FindString(html)
	if m != "" {
		cm := reMetaContent.FindStringSubmatch(m)
		if cm != nil {
			return rateDescription(cm[1])
		}
	}

	// Try reverse order: content="..." ... name="description"
	rm := reMetaDescRev.FindStringSubmatch(html)
	if rm != nil {
		return rateDescription(rm[1])
	}

	return &MetaTag{Rating: "missing"}
}

// rateDescription rates a meta description value by length.
func rateDescription(value string) *MetaTag {
	text := strings.TrimSpace(value)
	length := len(text)

	rating := "good"
	switch {
	case length == 0:
		rating = "missing"
	case length < 120:
		rating = "too_short"
	case length > 160:
		rating = "too_long"
	}

	return &MetaTag{Value: text, Length: length, Rating: rating}
}

// parseCanonical extracts the canonical link URL.
func parseCanonical(html string) string {
	m := reCanonical.FindString(html)
	if m == "" {
		return ""
	}
	hm := reHref.FindStringSubmatch(m)
	if hm == nil {
		return ""
	}
	return strings.TrimSpace(hm[1])
}

// parseOpenGraph extracts all og:* meta tags into a map.
func parseOpenGraph(html string) map[string]string {
	og := make(map[string]string)

	// Standard order: property="og:..." ... content="..."
	matches := reOGMeta.FindAllString(html, -1)
	for _, tag := range matches {
		prop := reOGMeta.FindStringSubmatch(tag)
		cont := reMetaContent.FindStringSubmatch(tag)
		if prop != nil && cont != nil {
			og[prop[1]] = cont[1]
		}
	}

	// Reverse order: content="..." ... property="og:..."
	revMatches := reOGMetaRev.FindAllStringSubmatch(html, -1)
	for _, m := range revMatches {
		if _, exists := og[m[2]]; !exists {
			og[m[2]] = m[1]
		}
	}

	if len(og) == 0 {
		return nil
	}
	return og
}

// parseTwitterCard extracts all twitter:* meta tags into a map.
func parseTwitterCard(html string) map[string]string {
	tc := make(map[string]string)

	// Standard order: name="twitter:..." ... content="..."
	matches := reTwitterMeta.FindAllString(html, -1)
	for _, tag := range matches {
		name := reTwitterMeta.FindStringSubmatch(tag)
		cont := reMetaContent.FindStringSubmatch(tag)
		if name != nil && cont != nil {
			tc[name[1]] = cont[1]
		}
	}

	// Reverse order: content="..." ... name="twitter:..."
	revMatches := reTwitterMetaRev.FindAllStringSubmatch(html, -1)
	for _, m := range revMatches {
		if _, exists := tc[m[2]]; !exists {
			tc[m[2]] = m[1]
		}
	}

	if len(tc) == 0 {
		return nil
	}
	return tc
}

// parseHeadings analyzes heading structure (h1, h2, h3).
func parseHeadings(html string) *HeadingStructure {
	hs := &HeadingStructure{}

	h1Matches := reH1.FindAllStringSubmatch(html, -1)
	hs.H1Count = len(h1Matches)
	for _, m := range h1Matches {
		text := strings.TrimSpace(reStripHTML.ReplaceAllString(m[1], ""))
		if text != "" {
			hs.H1s = append(hs.H1s, text)
		}
	}

	hs.H2Count = len(reH2.FindAllString(html, -1))
	hs.H3Count = len(reH3.FindAllString(html, -1))

	// Flag heading issues.
	if hs.H1Count == 0 {
		hs.Issues = append(hs.Issues, "Page has no H1 tag")
	} else if hs.H1Count > 1 {
		hs.Issues = append(hs.Issues, fmt.Sprintf("Page has %d H1 tags (should have exactly 1)", hs.H1Count))
	}

	// Check for broken hierarchy: h1 appearing after h2.
	if hs.H1Count > 0 && hs.H2Count > 0 {
		firstH1 := strings.Index(strings.ToLower(html), "<h1")
		firstH2 := strings.Index(strings.ToLower(html), "<h2")
		if firstH1 > firstH2 && firstH2 >= 0 {
			hs.Issues = append(hs.Issues, "Broken heading hierarchy: H2 appears before H1")
		}
	}

	return hs
}

// parseImages finds <img> tags and audits alt attributes.
func parseImages(html string) *ImageAudit {
	imgs := reImg.FindAllString(html, -1)
	audit := &ImageAudit{Total: len(imgs)}

	for _, tag := range imgs {
		if reAlt.MatchString(tag) {
			audit.WithAlt++
		} else {
			audit.WithoutAlt++
		}
	}

	switch {
	case audit.Total == 0:
		audit.Rating = "good" // No images to evaluate
	case audit.WithAlt == audit.Total:
		audit.Rating = "good"
	case float64(audit.WithAlt)/float64(audit.Total) >= 0.8:
		audit.Rating = "warning"
	default:
		audit.Rating = "bad"
	}

	return audit
}

// parseStructuredData finds JSON-LD blocks and extracts @type values.
func parseStructuredData(html string) []StructuredData {
	matches := reLDJSON.FindAllStringSubmatch(html, -1)
	if len(matches) == 0 {
		return nil
	}

	var results []StructuredData
	for _, m := range matches {
		jsonStr := strings.TrimSpace(m[1])
		typeName := extractJSONLDType(jsonStr)
		if typeName != "" {
			results = append(results, StructuredData{Type: typeName, Format: "json-ld"})
		}
	}

	return results
}

// extractJSONLDType parses a JSON-LD string and pulls out the @type field.
func extractJSONLDType(jsonStr string) string {
	// Try as single object first.
	var obj map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &obj); err == nil {
		if t, ok := obj["@type"]; ok {
			return fmt.Sprintf("%v", t)
		}
		return ""
	}

	// Try as array of objects.
	var arr []map[string]interface{}
	if err := json.Unmarshal([]byte(jsonStr), &arr); err == nil && len(arr) > 0 {
		if t, ok := arr[0]["@type"]; ok {
			return fmt.Sprintf("%v", t)
		}
	}

	return ""
}

// parseHreflang finds alternate hreflang link tags.
func parseHreflang(html string) []HreflangTag {
	matches := reHreflang.FindAllStringSubmatch(html, -1)
	if len(matches) == 0 {
		return nil
	}

	var tags []HreflangTag
	for _, m := range matches {
		lang := m[1]
		// Extract href from the full match
		hm := reHref.FindStringSubmatch(m[0])
		if hm != nil {
			tags = append(tags, HreflangTag{Lang: lang, URL: hm[1]})
		}
	}

	return tags
}

// detectMixedContent finds http:// URLs in src, href, action attributes on an HTTPS page.
func detectMixedContent(html string) []string {
	matches := reMixedSrc.FindAllStringSubmatch(html, -1)
	if len(matches) == 0 {
		return nil
	}

	seen := make(map[string]bool)
	var results []string
	for _, m := range matches {
		u := m[1]
		if seen[u] {
			continue
		}
		seen[u] = true
		results = append(results, u)
		if len(results) >= 10 {
			break
		}
	}

	return results
}

// ── robots.txt and sitemap fetching ─────────────────────────────────

// fetchRobotsTxt fetches and analyzes robots.txt.
func fetchRobotsTxt(client *http.Client, origin string, opts Options) *RobotsTxtAudit {
	robotsURL := origin + "/robots.txt"
	body, status, err := seoGet(client, robotsURL, opts, 1024*1024)
	if err != nil || status != 200 {
		return &RobotsTxtAudit{Found: false}
	}

	audit := &RobotsTxtAudit{
		Found: true,
		Size:  len(body),
	}

	// Extract sitemap references.
	sitemaps := reSitemapLine.FindAllStringSubmatch(body, -1)
	for _, sm := range sitemaps {
		audit.Sitemaps = append(audit.Sitemaps, strings.TrimSpace(sm[1]))
	}

	// Flag issues.
	if reDisallowAll.MatchString(body) {
		audit.Issues = append(audit.Issues, "robots.txt contains 'Disallow: /' which blocks all crawlers")
	}
	if reBlockCSS.MatchString(body) {
		audit.Issues = append(audit.Issues, "robots.txt blocks CSS files which can harm rendering-based indexing")
	}
	if reBlockJS.MatchString(body) {
		audit.Issues = append(audit.Issues, "robots.txt blocks JavaScript files which can harm rendering-based indexing")
	}

	return audit
}

// fetchSitemap tries to fetch and analyze the sitemap.
// It tries URLs from robots.txt first, then falls back to {origin}/sitemap.xml.
func fetchSitemap(client *http.Client, origin string, robotsSitemaps []string, opts Options) *SitemapAudit {
	// Try sitemaps declared in robots.txt first.
	for _, sitemapURL := range robotsSitemaps {
		if audit := trySitemap(client, sitemapURL, opts); audit.Found {
			return audit
		}
	}

	// Fall back to default location.
	defaultURL := origin + "/sitemap.xml"
	audit := trySitemap(client, defaultURL, opts)
	if !audit.Found {
		audit.Issues = append(audit.Issues, "No sitemap found at "+defaultURL)
	}
	return audit
}

// trySitemap attempts to fetch and parse a single sitemap URL.
func trySitemap(client *http.Client, sitemapURL string, opts Options) *SitemapAudit {
	body, status, err := seoGet(client, sitemapURL, opts, seoSitemapMaxSize)
	if err != nil || status != 200 {
		return &SitemapAudit{Found: false, URL: sitemapURL}
	}

	locs := reSitemapLoc.FindAllStringSubmatch(body, -1)
	audit := &SitemapAudit{
		Found:    true,
		URL:      sitemapURL,
		URLCount: len(locs),
	}

	if len(locs) == 0 {
		audit.Issues = append(audit.Issues, "Sitemap found but contains no <loc> entries")
	}

	return audit
}

// ── Scoring ─────────────────────────────────────────────────────────

// calculateSEOScore produces a 0-100 score based on audit results.
func calculateSEOScore(a *SEOAudit) int {
	score := 0

	// Title: 15 points
	if a.Title != nil && a.Title.Rating == "good" {
		score += 15
	} else if a.Title != nil && (a.Title.Rating == "too_short" || a.Title.Rating == "too_long") {
		score += 8
	}

	// Description: 15 points
	if a.Description != nil && a.Description.Rating == "good" {
		score += 15
	} else if a.Description != nil && (a.Description.Rating == "too_short" || a.Description.Rating == "too_long") {
		score += 8
	}

	// Canonical: 5 points
	if a.Canonical != "" {
		score += 5
	}

	// Open Graph (og:title + og:description): 5 points
	ogScore := 0
	if a.OpenGraph != nil {
		if _, ok := a.OpenGraph["og:title"]; ok {
			ogScore++
		}
		if _, ok := a.OpenGraph["og:description"]; ok {
			ogScore++
		}
	}
	if ogScore == 2 {
		score += 5
	} else if ogScore == 1 {
		score += 2
	}

	// H1: 10 points
	if a.Headings != nil && a.Headings.H1Count == 1 && len(a.Headings.Issues) == 0 {
		score += 10
	} else if a.Headings != nil && a.Headings.H1Count == 1 {
		score += 5 // Has H1 but with issues (e.g., hierarchy)
	}

	// Images alt text: 10 points
	if a.Images != nil {
		switch a.Images.Rating {
		case "good":
			score += 10
		case "warning":
			score += 5
		}
	}

	// robots.txt: 10 points
	if a.RobotsTxt != nil && a.RobotsTxt.Found {
		if len(a.RobotsTxt.Issues) == 0 {
			score += 10
		} else {
			score += 5
		}
	}

	// Sitemap: 10 points
	if a.Sitemap != nil && a.Sitemap.Found {
		if a.Sitemap.URLCount > 0 {
			score += 10
		} else {
			score += 5
		}
	}

	// Structured data: 5 points
	if len(a.StructuredData) > 0 {
		score += 5
	}

	// No mixed content: 10 points
	if len(a.MixedContent) == 0 {
		score += 10
	}

	// Hreflang bonus: 5 points if multilingual (cap at 100)
	if len(a.Hreflang) > 0 {
		score += 5
	}

	if score > 100 {
		score = 100
	}

	return score
}
