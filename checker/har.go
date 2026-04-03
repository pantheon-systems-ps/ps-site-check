package checker

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// HARFile represents the top-level HAR structure.
type HARFile struct {
	Log HARLog `json:"log"`
}

// HARLog contains the HAR log data.
type HARLog struct {
	Version string     `json:"version"`
	Creator HARCreator `json:"creator"`
	Entries []HAREntry `json:"entries"`
	Pages   []HARPage  `json:"pages,omitempty"`
}

// HARCreator identifies what generated the HAR.
type HARCreator struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// HARPage represents a page in the HAR.
type HARPage struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

// HAREntry represents a single request/response pair.
type HAREntry struct {
	StartedDateTime string      `json:"startedDateTime"`
	Time            float64     `json:"time"`
	Request         HARRequest  `json:"request"`
	Response        HARResponse `json:"response"`
	ServerIPAddress string      `json:"serverIPAddress,omitempty"`
	Timings         HARTimings  `json:"timings"`
}

// HARRequest is the request portion of an entry.
type HARRequest struct {
	Method  string      `json:"method"`
	URL     string      `json:"url"`
	Headers []HARHeader `json:"headers"`
}

// HARResponse is the response portion of an entry.
type HARResponse struct {
	Status      int         `json:"status"`
	StatusText  string      `json:"statusText"`
	Headers     []HARHeader `json:"headers"`
	Content     HARContent  `json:"content"`
	RedirectURL string      `json:"redirectURL"`
}

// HARHeader is a name/value pair.
type HARHeader struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// HARContent describes response body metadata.
type HARContent struct {
	Size     int64  `json:"size"`
	MimeType string `json:"mimeType"`
}

// HARTimings contains timing breakdown.
type HARTimings struct {
	Blocked float64 `json:"blocked"`
	DNS     float64 `json:"dns"`
	Connect float64 `json:"connect"`
	Send    float64 `json:"send"`
	Wait    float64 `json:"wait"`
	Receive float64 `json:"receive"`
	SSL     float64 `json:"ssl"`
}

// HARAnalysis is the result of analyzing a HAR file.
type HARAnalysis struct {
	Summary      HARSummary       `json:"summary"`
	SlowRequests []HARRequestInfo `json:"slow_requests"`
	ErrorEntries []HARRequestInfo `json:"error_entries"`
	ByDomain     []HARDomainStats `json:"by_domain"`
	ByType       []HARTypeStats   `json:"by_type"`
	CacheStats   HARCacheStats    `json:"cache_stats"`
	Insights     []Insight        `json:"insights"`
}

// HARSummary contains high-level HAR stats.
type HARSummary struct {
	TotalRequests int     `json:"total_requests"`
	TotalSizeKB   float64 `json:"total_size_kb"`
	TotalTimeMS   float64 `json:"total_time_ms"`
	Domains       int     `json:"domains"`
	Pages         int     `json:"pages"`
	Creator       string  `json:"creator"`
}

// HARRequestInfo describes a single notable request.
type HARRequestInfo struct {
	URL        string  `json:"url"`
	Method     string  `json:"method"`
	Status     int     `json:"status"`
	TimeMS     float64 `json:"time_ms"`
	SizeKB     float64 `json:"size_kb"`
	MimeType   string  `json:"mime_type"`
	WaitMS     float64 `json:"wait_ms,omitempty"`
}

// HARDomainStats aggregates stats per domain.
type HARDomainStats struct {
	Domain   string  `json:"domain"`
	Requests int     `json:"requests"`
	SizeKB   float64 `json:"size_kb"`
	AvgMS    float64 `json:"avg_ms"`
}

// HARTypeStats aggregates stats per content type.
type HARTypeStats struct {
	Type     string  `json:"type"`
	Requests int     `json:"requests"`
	SizeKB   float64 `json:"size_kb"`
}

// HARCacheStats describes caching behavior from the HAR.
type HARCacheStats struct {
	CacheHits   int `json:"cache_hits"`
	CacheMisses int `json:"cache_misses"`
	NoCache     int `json:"no_cache"`
}

// AnalyzeHAR parses and analyzes a HAR file.
func AnalyzeHAR(data []byte) (*HARAnalysis, error) {
	var har HARFile
	if err := json.Unmarshal(data, &har); err != nil {
		return nil, fmt.Errorf("invalid HAR JSON: %w", err)
	}

	if len(har.Log.Entries) == 0 {
		return nil, fmt.Errorf("HAR file contains no entries")
	}

	analysis := &HARAnalysis{}

	// Summary
	var totalSize int64
	var totalTime float64
	domains := make(map[string]bool)
	domainStats := make(map[string]*HARDomainStats)
	typeStats := make(map[string]*HARTypeStats)

	for _, entry := range har.Log.Entries {
		totalSize += entry.Response.Content.Size
		totalTime += entry.Time

		// Extract domain
		domain := extractDomain(entry.Request.URL)
		domains[domain] = true

		// Domain stats
		ds, ok := domainStats[domain]
		if !ok {
			ds = &HARDomainStats{Domain: domain}
			domainStats[domain] = ds
		}
		ds.Requests++
		ds.SizeKB += float64(entry.Response.Content.Size) / 1024
		ds.AvgMS += entry.Time

		// Type stats
		mimeType := simplifyMime(entry.Response.Content.MimeType)
		ts, ok := typeStats[mimeType]
		if !ok {
			ts = &HARTypeStats{Type: mimeType}
			typeStats[mimeType] = ts
		}
		ts.Requests++
		ts.SizeKB += float64(entry.Response.Content.Size) / 1024

		// Slow requests (>1s)
		if entry.Time > 1000 {
			analysis.SlowRequests = append(analysis.SlowRequests, HARRequestInfo{
				URL:      truncateURL(entry.Request.URL, 120),
				Method:   entry.Request.Method,
				Status:   entry.Response.Status,
				TimeMS:   entry.Time,
				SizeKB:   float64(entry.Response.Content.Size) / 1024,
				MimeType: mimeType,
				WaitMS:   entry.Timings.Wait,
			})
		}

		// Error entries (4xx, 5xx)
		if entry.Response.Status >= 400 {
			analysis.ErrorEntries = append(analysis.ErrorEntries, HARRequestInfo{
				URL:      truncateURL(entry.Request.URL, 120),
				Method:   entry.Request.Method,
				Status:   entry.Response.Status,
				TimeMS:   entry.Time,
				SizeKB:   float64(entry.Response.Content.Size) / 1024,
				MimeType: mimeType,
			})
		}

		// Cache stats from response headers
		for _, h := range entry.Response.Headers {
			if strings.EqualFold(h.Name, "x-cache") {
				if strings.Contains(strings.ToUpper(h.Value), "HIT") {
					analysis.CacheStats.CacheHits++
				} else {
					analysis.CacheStats.CacheMisses++
				}
			}
			if strings.EqualFold(h.Name, "cache-control") {
				if strings.Contains(strings.ToLower(h.Value), "no-cache") || strings.Contains(strings.ToLower(h.Value), "no-store") {
					analysis.CacheStats.NoCache++
				}
			}
		}
	}

	analysis.Summary = HARSummary{
		TotalRequests: len(har.Log.Entries),
		TotalSizeKB:   float64(totalSize) / 1024,
		TotalTimeMS:   totalTime,
		Domains:       len(domains),
		Pages:         len(har.Log.Pages),
		Creator:       har.Log.Creator.Name + " " + har.Log.Creator.Version,
	}

	// Finalize domain stats
	for _, ds := range domainStats {
		if ds.Requests > 0 {
			ds.AvgMS = ds.AvgMS / float64(ds.Requests)
		}
		analysis.ByDomain = append(analysis.ByDomain, *ds)
	}
	sort.Slice(analysis.ByDomain, func(i, j int) bool {
		return analysis.ByDomain[i].Requests > analysis.ByDomain[j].Requests
	})

	// Finalize type stats
	for _, ts := range typeStats {
		analysis.ByType = append(analysis.ByType, *ts)
	}
	sort.Slice(analysis.ByType, func(i, j int) bool {
		return analysis.ByType[i].Requests > analysis.ByType[j].Requests
	})

	// Sort slow requests by time descending
	sort.Slice(analysis.SlowRequests, func(i, j int) bool {
		return analysis.SlowRequests[i].TimeMS > analysis.SlowRequests[j].TimeMS
	})

	// Limit to top 20
	if len(analysis.SlowRequests) > 20 {
		analysis.SlowRequests = analysis.SlowRequests[:20]
	}
	if len(analysis.ErrorEntries) > 20 {
		analysis.ErrorEntries = analysis.ErrorEntries[:20]
	}

	// Generate insights
	analysis.Insights = harInsights(analysis)

	return analysis, nil
}

func harInsights(a *HARAnalysis) []Insight {
	var insights []Insight

	if a.Summary.TotalRequests > 100 {
		insights = append(insights, Insight{
			Severity: "warning",
			Category: "cdn",
			Message:  fmt.Sprintf("Page makes %d requests — consider reducing for better performance", a.Summary.TotalRequests),
		})
	}

	if a.Summary.TotalSizeKB > 5000 {
		insights = append(insights, Insight{
			Severity: "warning",
			Category: "cdn",
			Message:  fmt.Sprintf("Total page weight is %.0f KB — consider optimizing assets", a.Summary.TotalSizeKB),
		})
	}

	if len(a.SlowRequests) > 5 {
		insights = append(insights, Insight{
			Severity: "warning",
			Category: "cdn",
			Message:  fmt.Sprintf("%d requests took over 1 second", len(a.SlowRequests)),
		})
	}

	if len(a.ErrorEntries) > 0 {
		insights = append(insights, Insight{
			Severity: "error",
			Category: "cdn",
			Message:  fmt.Sprintf("%d requests returned errors (4xx/5xx)", len(a.ErrorEntries)),
		})
	}

	if a.CacheStats.CacheHits > 0 || a.CacheStats.CacheMisses > 0 {
		total := a.CacheStats.CacheHits + a.CacheStats.CacheMisses
		ratio := float64(a.CacheStats.CacheHits) / float64(total) * 100
		sev := "info"
		if ratio < 50 {
			sev = "warning"
		}
		insights = append(insights, Insight{
			Severity: sev,
			Category: "cache",
			Message:  fmt.Sprintf("Cache hit ratio: %.0f%% (%d hits, %d misses)", ratio, a.CacheStats.CacheHits, a.CacheStats.CacheMisses),
		})
	}

	if a.Summary.Domains > 10 {
		insights = append(insights, Insight{
			Severity: "info",
			Category: "cdn",
			Message:  fmt.Sprintf("Requests span %d domains — third-party scripts may impact load time", a.Summary.Domains),
		})
	}

	return insights
}

func extractDomain(rawURL string) string {
	// Quick extraction without url.Parse for performance
	s := rawURL
	if idx := strings.Index(s, "://"); idx >= 0 {
		s = s[idx+3:]
	}
	if idx := strings.Index(s, "/"); idx >= 0 {
		s = s[:idx]
	}
	if idx := strings.Index(s, ":"); idx >= 0 {
		s = s[:idx]
	}
	return s
}

func simplifyMime(mime string) string {
	if mime == "" {
		return "other"
	}
	mime = strings.ToLower(mime)
	if idx := strings.Index(mime, ";"); idx >= 0 {
		mime = mime[:idx]
	}
	switch {
	case strings.Contains(mime, "javascript"):
		return "javascript"
	case strings.Contains(mime, "css"):
		return "css"
	case strings.Contains(mime, "html"):
		return "html"
	case strings.Contains(mime, "json"):
		return "json"
	case strings.Contains(mime, "image"):
		return "image"
	case strings.Contains(mime, "font"):
		return "font"
	case strings.Contains(mime, "video"):
		return "video"
	case strings.Contains(mime, "xml"):
		return "xml"
	default:
		return mime
	}
}

func truncateURL(u string, max int) string {
	if len(u) <= max {
		return u
	}
	return u[:max] + "..."
}
