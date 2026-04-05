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
	A          []string   `json:"a"`
	AAAA       []string   `json:"aaaa"`
	CNAME      []string   `json:"cname"`
	MX         []MXRecord `json:"mx,omitempty"`
	NS         []string   `json:"ns,omitempty"`
	TXT        []string   `json:"txt,omitempty"`
	DurationMS int64      `json:"duration_ms"`
	Error      string     `json:"error,omitempty"`
}

// MXRecord contains a mail exchange record.
type MXRecord struct {
	Host     string `json:"host"`
	Priority uint16 `json:"priority"`
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
	Protocol      string   `json:"protocol"`
	CipherSuite   string   `json:"cipher_suite,omitempty"`
	CipherSecurity string  `json:"cipher_security,omitempty"` // "recommended", "secure", "weak", "insecure"
	Subject       string   `json:"subject"`
	Issuer        string   `json:"issuer"`
	ValidFrom     string   `json:"valid_from"`
	ValidTo       string   `json:"valid_to"`
	SANs          []string `json:"sans"`
	DurationMS    int64    `json:"duration_ms"`
	Error         string   `json:"error,omitempty"`
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
	Results    []*Result `json:"results"`
	TotalMS    int64     `json:"total_ms"`
	TotalURLs  int       `json:"total_urls"`
}
