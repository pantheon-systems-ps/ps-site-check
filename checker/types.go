package checker

import "time"

// Options configures the check behavior.
type Options struct {
	DoubleRequest   bool   // Make two requests to compare MISS→HIT
	FollowRedirects bool   // Follow redirect chain
	ResolveIP       string // Force-resolve HTTP/TLS to this IP (like curl --resolve)
	PantheonDebug   bool   // Send Pantheon-Debug: 1 header
	FastlyDebug     bool   // Send Fastly-Debug: 1 header
	ClientIP        string // Spoof Fastly-Client-IP header for geo-routing tests
	UserAgent       string // Custom User-Agent string (empty = default "ps-site-check/1.0")
	WarmupRequests  int    // Number of requests for cache warmup test (0 = disabled)
}

// Result is the top-level response from a site check.
type Result struct {
	ID            string           `json:"id"`
	URL           string           `json:"url"`
	ResolveIP     string           `json:"resolve_ip,omitempty"`
	Timestamp     time.Time        `json:"timestamp"`
	DurationMS    int64            `json:"duration_ms"`
	DNS           *DNSResult       `json:"dns"`
	DNSMulti      []DNSPathResult  `json:"dns_multi,omitempty"`
	HTTP          *HTTPResult      `json:"http"`
	SecondHTTP    *HTTPResult      `json:"second_http,omitempty"`
	Warmup        *WarmupResult    `json:"warmup,omitempty"`
	RedirectChain []RedirectHop    `json:"redirect_chain,omitempty"`
	TLS           *TLSResult       `json:"tls"`
	Insights      []Insight        `json:"insights"`
	Security      *SecurityAudit   `json:"security,omitempty"`
	EmailAuth     *EmailAuthResult `json:"email_auth,omitempty"`
	Pantheon      *PantheonDetails `json:"pantheon,omitempty"`
}

// WarmupResult contains cache warmup test data.
type WarmupResult struct {
	TotalRequests int             `json:"total_requests"`
	Hits          int             `json:"hits"`
	Misses        int             `json:"misses"`
	HitRatio      float64         `json:"hit_ratio"`
	Requests      []WarmupRequest `json:"requests"`
}

// WarmupRequest captures one request in the warmup sequence.
type WarmupRequest struct {
	Sequence   int    `json:"sequence"`
	XCache     string `json:"x_cache"`
	StatusCode int    `json:"status_code"`
	DurationMS int64  `json:"duration_ms"`
}

// DNSResult contains DNS resolution data.
type DNSResult struct {
	A          []string    `json:"a"`
	AAAA       []string    `json:"aaaa"`
	CNAME      []string    `json:"cname"`
	MX         []MXRecord  `json:"mx,omitempty"`
	NS         []string    `json:"ns,omitempty"`
	TXT        []string    `json:"txt,omitempty"`
	CAA        []CAARecord `json:"caa,omitempty"`
	DNSSEC     *DNSSECInfo `json:"dnssec,omitempty"`
	DurationMS int64       `json:"duration_ms"`
	Error      string      `json:"error,omitempty"`
}

// MXRecord contains a mail exchange record.
type MXRecord struct {
	Host     string `json:"host"`
	Priority uint16 `json:"priority"`
}

// CAARecord contains a Certificate Authority Authorization record.
type CAARecord struct {
	Flag  uint8  `json:"flag"`
	Tag   string `json:"tag"`   // "issue", "issuewild", "iodef"
	Value string `json:"value"` // CA domain
}

// DNSSECInfo contains DNSSEC validation status.
type DNSSECInfo struct {
	Enabled  bool   `json:"enabled"`
	Valid    bool   `json:"valid"`
	KeyCount int    `json:"key_count,omitempty"`
	Error    string `json:"error,omitempty"`
}

// DNSPathResult contains DNS resolution via a specific resolver.
type DNSPathResult struct {
	Resolver   string   `json:"resolver"`
	Label      string   `json:"label"`
	A          []string `json:"a"`
	AAAA       []string `json:"aaaa"`
	DurationMS int64    `json:"duration_ms"`
	Error      string   `json:"error,omitempty"`
}

// HTTPResult contains the HTTP response data.
type HTTPResult struct {
	StatusCode   int               `json:"status_code"`
	Headers      map[string]string `json:"headers"`
	AGCDNHeaders []AGCDNHeader     `json:"agcdn_headers"`
	DurationMS   int64             `json:"duration_ms"`
	Error        string            `json:"error,omitempty"`
}

// AGCDNHeader is a curated header with insight commentary.
type AGCDNHeader struct {
	Header  string `json:"header"`
	Value   string `json:"value"`
	Insight string `json:"insight,omitempty"`
}

// TLSResult contains TLS certificate information.
type TLSResult struct {
	Protocol       string   `json:"protocol"`
	CipherSuite    string   `json:"cipher_suite,omitempty"`
	CipherSecurity string   `json:"cipher_security,omitempty"` // "recommended", "secure", "weak", "insecure"
	Subject        string   `json:"subject"`
	Issuer         string   `json:"issuer"`
	ValidFrom      string   `json:"valid_from"`
	ValidTo        string   `json:"valid_to"`
	SANs           []string `json:"sans"`
	DurationMS     int64    `json:"duration_ms"`
	Error          string   `json:"error,omitempty"`
}

// RedirectHop represents one step in a redirect chain.
type RedirectHop struct {
	URL        string `json:"url"`
	StatusCode int    `json:"status_code"`
	Location   string `json:"location"`
	DurationMS int64  `json:"duration_ms"`
}

// Insight is a curated observation about the site.
type Insight struct {
	Severity string `json:"severity"` // "info", "warning", "error"
	Category string `json:"category"` // "dns", "cache", "tls", "cdn", "security"
	Message  string `json:"message"`
}

// BatchRequest is a list of URLs to check.
type BatchRequest struct {
	URLs    []string `json:"urls"`
	Options Options  `json:"options"`
}

// BatchResult wraps multiple check results.
type BatchResult struct {
	Results   []*Result `json:"results"`
	TotalMS   int64     `json:"total_ms"`
	TotalURLs int       `json:"total_urls"`
}

// ── Security audit types ──────────────────────────────────────

// SecurityAudit contains the security headers analysis and cookie audit.
type SecurityAudit struct {
	Grade   string           `json:"grade"`   // A+, A, B, C, D, F
	Score   int              `json:"score"`   // 0-100
	Headers []SecurityHeader `json:"headers"`
	Cookies []CookieAudit    `json:"cookies,omitempty"`
}

// SecurityHeader is one header in the security scorecard.
type SecurityHeader struct {
	Name        string `json:"name"`
	Present     bool   `json:"present"`
	Value       string `json:"value,omitempty"`
	Rating      string `json:"rating"`      // "good", "warning", "missing", "bad"
	Description string `json:"description"` // human-readable explanation
}

// CookieAudit is the security analysis of one Set-Cookie header.
type CookieAudit struct {
	Name     string   `json:"name"`
	Secure   bool     `json:"secure"`
	HttpOnly bool     `json:"http_only"`
	SameSite string   `json:"same_site"` // "Strict", "Lax", "None", ""
	Issues   []string `json:"issues,omitempty"`
}

// ── Email authentication types ────────────────────────────────

// EmailAuthResult contains SPF, DKIM, and DMARC analysis.
type EmailAuthResult struct {
	Grade string      `json:"grade"` // A, B, C, D, F
	SPF   *SPFResult  `json:"spf"`
	DKIM  *DKIMResult `json:"dkim"`
	DMARC *DMARCResult `json:"dmarc"`
}

// SPFResult contains SPF record analysis.
type SPFResult struct {
	Found    bool     `json:"found"`
	Record   string   `json:"record,omitempty"`
	Valid    bool     `json:"valid"`
	Lookups  int      `json:"lookups,omitempty"` // DNS lookup count (max 10)
	Issues   []string `json:"issues,omitempty"`
}

// DKIMResult contains DKIM status (limited without knowing the selector).
type DKIMResult struct {
	Found bool   `json:"found"`
	Note  string `json:"note"`
}

// DMARCResult contains DMARC record analysis.
type DMARCResult struct {
	Found  bool     `json:"found"`
	Record string   `json:"record,omitempty"`
	Policy string   `json:"policy,omitempty"` // "none", "quarantine", "reject"
	Pct    int      `json:"pct,omitempty"`    // percentage of messages subject to policy
	RUA    string   `json:"rua,omitempty"`    // aggregate report URI
	Issues []string `json:"issues,omitempty"`
}

// ── Enhanced Pantheon detection types ─────────────────────────

// PantheonDetails contains deep Pantheon platform analysis.
type PantheonDetails struct {
	Detected    bool   `json:"detected"`
	CDNTier     string `json:"cdn_tier,omitempty"`     // "Global CDN", "AGCDN Legacy", "AGCDN2 Custom Cert"
	CMS         string `json:"cms,omitempty"`          // "WordPress", "Drupal"
	CMSVersion  string `json:"cms_version,omitempty"`  // e.g. "Drupal 10", "WordPress 6.4"
	Environment string `json:"environment,omitempty"`  // "live", "dev", "test", "pr-123"
	SiteUUID    string `json:"site_uuid,omitempty"`
	IsMultidev  bool   `json:"is_multidev"`
	Redis       bool   `json:"redis"`
	NewRelic    bool   `json:"new_relic"`
	PHPVersion  string `json:"php_version,omitempty"`
	PlanTier    string `json:"plan_tier,omitempty"` // inferred: "Basic", "Performance", "Elite"
}

// ── SEO audit types ───────────────────────────────────────────

// SEOAudit contains full SEO analysis from HTML, robots.txt, sitemap.
type SEOAudit struct {
	Score          int                `json:"score"` // 0-100
	URL            string             `json:"url"`
	Title          *MetaTag           `json:"title"`
	Description    *MetaTag           `json:"description"`
	Canonical      string             `json:"canonical,omitempty"`
	OpenGraph      map[string]string  `json:"open_graph,omitempty"`
	TwitterCard    map[string]string  `json:"twitter_card,omitempty"`
	Headings       *HeadingStructure  `json:"headings"`
	Images         *ImageAudit        `json:"images"`
	RobotsTxt      *RobotsTxtAudit    `json:"robots_txt"`
	Sitemap        *SitemapAudit      `json:"sitemap"`
	StructuredData []StructuredData   `json:"structured_data,omitempty"`
	Hreflang       []HreflangTag      `json:"hreflang,omitempty"`
	MixedContent   []string           `json:"mixed_content,omitempty"`
	Issues         []string           `json:"issues,omitempty"`
	DurationMS     int64              `json:"duration_ms"`
	Error          string             `json:"error,omitempty"`
}

// MetaTag is a meta tag value with length analysis.
type MetaTag struct {
	Value  string `json:"value"`
	Length int    `json:"length"`
	Rating string `json:"rating"` // "good", "too_short", "too_long", "missing"
}

// HeadingStructure contains heading hierarchy analysis.
type HeadingStructure struct {
	H1Count int      `json:"h1_count"`
	H1s     []string `json:"h1s"`
	H2Count int      `json:"h2_count"`
	H3Count int      `json:"h3_count"`
	Issues  []string `json:"issues,omitempty"`
}

// ImageAudit contains image accessibility analysis.
type ImageAudit struct {
	Total      int    `json:"total"`
	WithAlt    int    `json:"with_alt"`
	WithoutAlt int    `json:"without_alt"`
	Rating     string `json:"rating"` // "good", "warning", "bad"
}

// RobotsTxtAudit contains robots.txt validation.
type RobotsTxtAudit struct {
	Found    bool     `json:"found"`
	Size     int      `json:"size,omitempty"`
	Sitemaps []string `json:"sitemaps,omitempty"`
	Issues   []string `json:"issues,omitempty"`
}

// SitemapAudit contains sitemap.xml validation.
type SitemapAudit struct {
	Found    bool     `json:"found"`
	URL      string   `json:"url,omitempty"`
	URLCount int      `json:"url_count,omitempty"`
	Issues   []string `json:"issues,omitempty"`
}

// StructuredData is a detected JSON-LD or schema.org item.
type StructuredData struct {
	Type   string `json:"type"`   // "@type" value
	Format string `json:"format"` // "json-ld", "microdata"
}

// HreflangTag is a detected hreflang alternate link.
type HreflangTag struct {
	Lang string `json:"lang"`
	URL  string `json:"url"`
}

// ── CrUX (Chrome UX Report) types ─────────────────────────────

// CrUXData contains Chrome UX Report real-user metrics.
type CrUXData struct {
	Origin     string          `json:"origin"`
	FormFactor string          `json:"form_factor,omitempty"` // "ALL_FORM_FACTORS", "PHONE", "DESKTOP"
	LCP        *WebVitalMetric `json:"lcp,omitempty"`
	INP        *WebVitalMetric `json:"inp,omitempty"`
	CLS        *WebVitalMetric `json:"cls,omitempty"`
	FCP        *WebVitalMetric `json:"fcp,omitempty"`
	TTFB       *WebVitalMetric `json:"ttfb,omitempty"`
	Error      string          `json:"error,omitempty"`
}

// WebVitalMetric is one Core Web Vitals metric with distribution.
type WebVitalMetric struct {
	P75    float64 `json:"p75"`
	Rating string  `json:"rating"` // "good", "needs-improvement", "poor"
	Good   float64 `json:"good"`   // percentage
	NI     float64 `json:"ni"`     // percentage
	Poor   float64 `json:"poor"`   // percentage
	Unit   string  `json:"unit"`   // "ms" or "unitless"
}

// ── Lighthouse / PageSpeed Insights types ─────────────────────

// LighthouseResult contains PageSpeed Insights scores and metrics.
type LighthouseResult struct {
	Performance   int    `json:"performance"`    // 0-100
	Accessibility int    `json:"accessibility"`   // 0-100
	BestPractices int    `json:"best_practices"`  // 0-100
	SEO           int    `json:"seo"`             // 0-100
	FCP           string `json:"fcp,omitempty"`   // e.g. "1.2 s"
	LCP           string `json:"lcp,omitempty"`
	TBT           string `json:"tbt,omitempty"`
	CLS           string `json:"cls,omitempty"`
	SpeedIndex    string `json:"speed_index,omitempty"`
	TTI           string `json:"tti,omitempty"`   // Time to Interactive
	TTFB          string `json:"ttfb,omitempty"`  // Server response time
	Strategy      string `json:"strategy"`        // "mobile" or "desktop"
	DurationMS    int64  `json:"duration_ms"`
	Error         string `json:"error,omitempty"`

	// WPT-inspired metrics (extracted from PSI audits)
	PageWeight             int64               `json:"page_weight,omitempty"`              // total bytes
	TotalRequests          int                 `json:"total_requests,omitempty"`
	RenderBlocking         []RenderBlockingItem `json:"render_blocking,omitempty"`
	ThirdPartySummary      []ThirdPartyItem     `json:"third_party_summary,omitempty"`
	ThirdPartyBlockingTime int                 `json:"third_party_blocking_ms,omitempty"`

	// Quick / Usable / Resilient assessment
	IsQuick     *WPTAssessment `json:"is_quick,omitempty"`
	IsUsable    *WPTAssessment `json:"is_usable,omitempty"`
	IsResilient *WPTAssessment `json:"is_resilient,omitempty"`

	// Visual
	FinalScreenshot string           `json:"final_screenshot,omitempty"` // base64 data URI
	Filmstrip       []FilmstripFrame `json:"filmstrip,omitempty"`

	// Network
	NetworkRequests []NetworkRequest `json:"network_requests,omitempty"`

	// Asset breakdown
	ResourceSummary []ResourceSummaryItem `json:"resource_summary,omitempty"`

	// CPU
	MainThreadWork []MainThreadItem `json:"main_thread_work,omitempty"`

	// Optimization opportunities
	UnusedJS    []UnusedResource  `json:"unused_js,omitempty"`
	UnusedCSS   []UnusedResource  `json:"unused_css,omitempty"`
	CachePolicy []CachePolicyItem `json:"cache_policy,omitempty"`

	// Diagnostics
	LCPElement  string   `json:"lcp_element,omitempty"`
	CLSElements []string `json:"cls_elements,omitempty"`
	DOMSize     int      `json:"dom_size,omitempty"`
}

// FilmstripFrame is one frame from the filmstrip (screenshot-thumbnails audit).
type FilmstripFrame struct {
	Timing int    `json:"timing"` // ms
	Data   string `json:"data"`   // base64 data URI
}

// NetworkRequest is a single network request from the network-requests audit.
type NetworkRequest struct {
	URL          string  `json:"url"`
	ResourceType string  `json:"resource_type"`
	StartTime    float64 `json:"start_time"`  // ms
	EndTime      float64 `json:"end_time"`    // ms
	TransferSize int64   `json:"transfer_size"`
	StatusCode   int     `json:"status_code"`
	Protocol     string  `json:"protocol,omitempty"`
}

// ResourceSummaryItem is one row from the resource-summary audit.
type ResourceSummaryItem struct {
	ResourceType string `json:"resource_type"`
	Label        string `json:"label"`
	RequestCount int    `json:"request_count"`
	TransferSize int64  `json:"transfer_size"`
}

// MainThreadItem is one row from the mainthread-work-breakdown audit.
type MainThreadItem struct {
	Group    string  `json:"group"`
	Duration float64 `json:"duration"` // ms
}

// UnusedResource is one item from unused-javascript or unused-css-rules audits.
type UnusedResource struct {
	URL        string `json:"url"`
	TotalBytes int64  `json:"total_bytes"`
	WastedBytes int64 `json:"wasted_bytes"`
}

// CachePolicyItem is one item from the uses-long-cache-ttl audit.
type CachePolicyItem struct {
	URL        string  `json:"url"`
	CacheHit   float64 `json:"cache_hit_probability"`
	TotalBytes int64   `json:"total_bytes"`
	CacheTTL   float64 `json:"cache_ttl"` // seconds
}

// RenderBlockingItem is a resource that blocks rendering.
type RenderBlockingItem struct {
	URL      string `json:"url"`
	WastedMS int    `json:"wasted_ms"`
}

// ThirdPartyItem is a third-party domain with its impact.
type ThirdPartyItem struct {
	Entity       string `json:"entity"`
	TransferSize int64  `json:"transfer_size"`
	BlockingTime int    `json:"blocking_time_ms"`
}

// WPTAssessment is a Quick/Usable/Resilient verdict.
type WPTAssessment struct {
	Rating  string   `json:"rating"`  // "Good", "Not Bad", "Needs Improvement", "Poor"
	Summary string   `json:"summary"` // human-readable explanation
	Details []string `json:"details,omitempty"`
}

// ── HSTS Preload types ────────────────────────────────────────

// HSTSPreload contains HSTS preload list status.
type HSTSPreload struct {
	Domain    string   `json:"domain"`
	Preloaded bool     `json:"preloaded"`
	Status    string   `json:"status"` // "preloaded", "pending", "unknown", "not found"
	Issues    []string `json:"issues,omitempty"`
}

// ── Migration readiness types ─────────────────────────────────

// MigrationReadiness contains pre-migration checklist results.
type MigrationReadiness struct {
	Domain     string           `json:"domain"`
	Score      int              `json:"score"` // 0-100
	Grade      string           `json:"grade"` // A, B, C, D, F
	Checks     []MigrationCheck `json:"checks"`
	DurationMS int64            `json:"duration_ms"`
}

// MigrationCheck is one item in the migration readiness checklist.
type MigrationCheck struct {
	Name        string `json:"name"`
	Status      string `json:"status"` // "pass", "warning", "fail", "info"
	Description string `json:"description"`
	Detail      string `json:"detail,omitempty"`
}

// ── Site crawl & comparison types ────────────────────────────

// CrawlResult contains the results of crawling a site at a given depth.
type CrawlResult struct {
	URL        string      `json:"url"`
	Depth      int         `json:"depth"`
	TotalPages int         `json:"total_pages"`
	Pages      []CrawlPage `json:"pages"`
	Errors     int         `json:"errors"`
	DurationMS int64       `json:"duration_ms"`
	Error      string      `json:"error,omitempty"`
}

// CrawlPage is a single page discovered during a crawl.
type CrawlPage struct {
	URL        string `json:"url"`
	StatusCode int    `json:"status_code"`
	Title      string `json:"title,omitempty"`
	DurationMS int64  `json:"duration_ms"`
	Depth      int    `json:"depth"`
	Error      string `json:"error,omitempty"`
}

// CompareResult compares two crawled sites for migration validation.
type CompareResult struct {
	SiteA       *CrawlResult  `json:"site_a"`
	SiteB       *CrawlResult  `json:"site_b"`
	Matches     []CompareMatch `json:"matches"`
	OnlyInA     []string       `json:"only_in_a"`
	OnlyInB     []string       `json:"only_in_b"`
	StatusDiffs []CompareMatch `json:"status_diffs,omitempty"`
	MatchRate   float64        `json:"match_rate"`
	DurationMS  int64          `json:"duration_ms"`
}

// CompareMatch is a URL found in both sites with their respective status codes.
type CompareMatch struct {
	Path        string `json:"path"`
	StatusCodeA int    `json:"status_code_a"`
	StatusCodeB int    `json:"status_code_b"`
	Match       bool   `json:"match"`
}

// ── AGCDN feature probing types ──────────────────────────────

// AGCDNProbe contains active AGCDN feature detection results.
type AGCDNProbe struct {
	Domain     string          `json:"domain"`
	IsAGCDN    bool            `json:"is_agcdn"`
	WAF        *AGCDNFeature   `json:"waf"`
	IO         *AGCDNIOProbe   `json:"io"`
	RateLimit  *AGCDNFeature   `json:"rate_limit"`
	DurationMS int64           `json:"duration_ms"`
}

// AGCDNFeature is a single AGCDN feature detection result.
type AGCDNFeature struct {
	Detected bool   `json:"detected"`
	Evidence string `json:"evidence,omitempty"`
}

// AGCDNIOProbe contains Image Optimization probe results.
type AGCDNIOProbe struct {
	Detected    bool   `json:"detected"`
	Transforms  bool   `json:"transforms"`
	Evidence    string `json:"evidence,omitempty"`
}

// ── Bot protection detection types ───────────────────────────

// BotProtection contains bot mitigation detection results.
type BotProtection struct {
	Domain          string             `json:"domain"`
	Detected        bool               `json:"detected"`
	Type            string             `json:"type,omitempty"` // "obolus", "pow-interstitial", "unknown"
	ChallengeEndpoint *BotProbeResult  `json:"challenge_endpoint,omitempty"`
	CookieRequired  *BotProbeResult    `json:"cookie_required,omitempty"`
	ChallengePage   *BotProbeResult    `json:"challenge_page,omitempty"`
	DurationMS      int64              `json:"duration_ms"`
}

// BotProbeResult is one probe in the bot protection detection.
type BotProbeResult struct {
	Detected bool   `json:"detected"`
	Detail   string `json:"detail,omitempty"`
}

// ── Broken resource audit types ──────────────────────────────

// ResourceAudit contains the results of checking linked resources.
type ResourceAudit struct {
	URL            string           `json:"url"`
	TotalResources int              `json:"total_resources"`
	Healthy        int              `json:"healthy"`
	Broken         int              `json:"broken"`
	Errors         int              `json:"errors"`
	Resources      []ResourceCheck  `json:"resources"`
	DurationMS     int64            `json:"duration_ms"`
	Error          string           `json:"error,omitempty"`
}

// ResourceCheck is the health check of one linked resource.
type ResourceCheck struct {
	URL        string `json:"url"`
	Type       string `json:"type"` // "css", "js", "image", "other"
	StatusCode int    `json:"status_code"`
	Status     string `json:"status"` // "ok", "broken", "error"
	DurationMS int64  `json:"duration_ms"`
	Error      string `json:"error,omitempty"`
}
