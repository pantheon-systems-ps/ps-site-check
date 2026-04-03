package checker

import "time"

// Options configures the check behavior.
type Options struct {
	DoubleRequest bool // Make two requests to compare MISS→HIT
	FollowRedirects bool // Follow redirect chain
}

// Result is the top-level response from a site check.
type Result struct {
	ID            string          `json:"id"`
	URL           string          `json:"url"`
	Timestamp     time.Time       `json:"timestamp"`
	DurationMS    int64           `json:"duration_ms"`
	DNS           *DNSResult      `json:"dns"`
	HTTP          *HTTPResult     `json:"http"`
	SecondHTTP    *HTTPResult     `json:"second_http,omitempty"`
	RedirectChain []RedirectHop   `json:"redirect_chain,omitempty"`
	TLS           *TLSResult      `json:"tls"`
	Insights      []Insight       `json:"insights"`
}

// DNSResult contains DNS resolution data.
type DNSResult struct {
	A          []string `json:"a"`
	AAAA       []string `json:"aaaa"`
	CNAME      []string `json:"cname"`
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
	Protocol   string   `json:"protocol"`
	Subject    string   `json:"subject"`
	Issuer     string   `json:"issuer"`
	ValidFrom  string   `json:"valid_from"`
	ValidTo    string   `json:"valid_to"`
	SANs       []string `json:"sans"`
	DurationMS int64    `json:"duration_ms"`
	Error      string   `json:"error,omitempty"`
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
