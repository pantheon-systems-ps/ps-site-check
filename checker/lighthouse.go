package checker

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"time"
)

// FetchLighthouse runs a PageSpeed Insights audit and returns category scores and key metrics.
func FetchLighthouse(targetURL, strategy string) *LighthouseResult {
	if strategy == "" {
		strategy = "mobile"
	}

	params := url.Values{}
	params.Set("url", targetURL)
	params.Set("strategy", strategy)
	params.Add("category", "PERFORMANCE")
	params.Add("category", "ACCESSIBILITY")
	params.Add("category", "BEST_PRACTICES")
	params.Add("category", "SEO")

	if apiKey := os.Getenv("PAGESPEED_API_KEY"); apiKey != "" {
		params.Set("key", apiKey)
	}

	apiURL := "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?" + params.Encode()

	client := &http.Client{Timeout: 90 * time.Second}
	start := time.Now()

	resp, err := client.Get(apiURL)
	if err != nil {
		return &LighthouseResult{Strategy: strategy, Error: "PageSpeed API request failed: " + err.Error()}
	}
	defer resp.Body.Close()

	duration := time.Since(start).Milliseconds()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return &LighthouseResult{Strategy: strategy, DurationMS: duration, Error: "failed to read PageSpeed response: " + err.Error()}
	}

	if resp.StatusCode != 200 {
		return &LighthouseResult{
			Strategy:   strategy,
			DurationMS: duration,
			Error:      fmt.Sprintf("PageSpeed API returned HTTP %d: %s", resp.StatusCode, truncate(string(body), 200)),
		}
	}

	// Parse the full PSI response with all audit details.
	var raw struct {
		LighthouseResult struct {
			Categories map[string]struct {
				Score float64 `json:"score"`
			} `json:"categories"`
			Audits map[string]json.RawMessage `json:"audits"`
		} `json:"lighthouseResult"`
	}

	if err := json.Unmarshal(body, &raw); err != nil {
		return &LighthouseResult{Strategy: strategy, DurationMS: duration, Error: "failed to parse PageSpeed response: " + err.Error()}
	}

	result := &LighthouseResult{
		Strategy:   strategy,
		DurationMS: duration,
	}

	// Extract category scores (API returns 0-1, we store 0-100).
	cats := raw.LighthouseResult.Categories
	if c, ok := cats["performance"]; ok {
		result.Performance = int(c.Score * 100)
	}
	if c, ok := cats["accessibility"]; ok {
		result.Accessibility = int(c.Score * 100)
	}
	if c, ok := cats["best-practices"]; ok {
		result.BestPractices = int(c.Score * 100)
	}
	if c, ok := cats["seo"]; ok {
		result.SEO = int(c.Score * 100)
	}

	audits := raw.LighthouseResult.Audits

	// Extract display values for key metrics.
	result.FCP = getDisplayValue(audits, "first-contentful-paint")
	result.LCP = getDisplayValue(audits, "largest-contentful-paint")
	result.TBT = getDisplayValue(audits, "total-blocking-time")
	result.CLS = getDisplayValue(audits, "cumulative-layout-shift")
	result.SpeedIndex = getDisplayValue(audits, "speed-index")
	result.TTI = getDisplayValue(audits, "interactive")
	result.TTFB = getDisplayValue(audits, "server-response-time")

	// Page weight (total-byte-weight audit)
	result.PageWeight = getNumericValue(audits, "total-byte-weight")

	// Total requests (network-requests audit — count items)
	result.TotalRequests = getItemCount(audits, "network-requests")

	// Render-blocking resources
	result.RenderBlocking = getRenderBlocking(audits)

	// Third-party summary
	result.ThirdPartySummary, result.ThirdPartyBlockingTime = getThirdPartySummary(audits)

	// Generate Quick / Usable / Resilient assessments
	result.IsQuick = assessQuick(result)
	result.IsUsable = assessUsable(result)
	result.IsResilient = assessResilient(result)

	return result
}

// -- Audit extraction helpers --

func getDisplayValue(audits map[string]json.RawMessage, key string) string {
	raw, ok := audits[key]
	if !ok {
		return ""
	}
	var a struct {
		DisplayValue string `json:"displayValue"`
	}
	json.Unmarshal(raw, &a)
	return a.DisplayValue
}

func getNumericValue(audits map[string]json.RawMessage, key string) int64 {
	raw, ok := audits[key]
	if !ok {
		return 0
	}
	var a struct {
		NumericValue float64 `json:"numericValue"`
	}
	json.Unmarshal(raw, &a)
	return int64(a.NumericValue)
}

func getItemCount(audits map[string]json.RawMessage, key string) int {
	raw, ok := audits[key]
	if !ok {
		return 0
	}
	var a struct {
		Details struct {
			Items []json.RawMessage `json:"items"`
		} `json:"details"`
	}
	json.Unmarshal(raw, &a)
	return len(a.Details.Items)
}

func getRenderBlocking(audits map[string]json.RawMessage) []RenderBlockingItem {
	raw, ok := audits["render-blocking-resources"]
	if !ok {
		return nil
	}
	var a struct {
		Details struct {
			Items []struct {
				URL      string  `json:"url"`
				WastedMs float64 `json:"wastedMs"`
			} `json:"items"`
		} `json:"details"`
	}
	json.Unmarshal(raw, &a)

	var items []RenderBlockingItem
	for _, item := range a.Details.Items {
		items = append(items, RenderBlockingItem{
			URL:      item.URL,
			WastedMS: int(item.WastedMs),
		})
	}
	return items
}

func getThirdPartySummary(audits map[string]json.RawMessage) ([]ThirdPartyItem, int) {
	raw, ok := audits["third-party-summary"]
	if !ok {
		return nil, 0
	}
	var a struct {
		Details struct {
			Items []struct {
				Entity struct {
					Text string `json:"text"`
				} `json:"entity"`
				TransferSize float64 `json:"transferSize"`
				BlockingTime float64 `json:"blockingTime"`
			} `json:"items"`
		} `json:"details"`
	}
	json.Unmarshal(raw, &a)

	var items []ThirdPartyItem
	totalBlocking := 0
	for _, item := range a.Details.Items {
		bt := int(item.BlockingTime)
		items = append(items, ThirdPartyItem{
			Entity:       item.Entity.Text,
			TransferSize: int64(item.TransferSize),
			BlockingTime: bt,
		})
		totalBlocking += bt
	}
	return items, totalBlocking
}

// -- Quick / Usable / Resilient assessments (WPT-inspired) --

func assessQuick(r *LighthouseResult) *WPTAssessment {
	a := &WPTAssessment{}
	score := 0
	total := 0

	// TTFB
	total++
	if ttfb := getMs(r.TTFB); ttfb > 0 {
		if ttfb < 600 {
			score++
			a.Details = append(a.Details, fmt.Sprintf("Fast server response (TTFB: %s)", r.TTFB))
		} else {
			a.Details = append(a.Details, fmt.Sprintf("Slow server response (TTFB: %s)", r.TTFB))
		}
	}

	// FCP
	total++
	if r.FCP != "" {
		if fcp := getMs(r.FCP); fcp > 0 && fcp < 1800 {
			score++
			a.Details = append(a.Details, fmt.Sprintf("Quick first paint (%s)", r.FCP))
		} else {
			a.Details = append(a.Details, fmt.Sprintf("Slow first paint (%s)", r.FCP))
		}
	}

	// LCP
	total++
	if r.LCP != "" {
		if lcp := getMs(r.LCP); lcp > 0 && lcp < 2500 {
			score++
			a.Details = append(a.Details, fmt.Sprintf("Good largest content paint (%s)", r.LCP))
		} else {
			a.Details = append(a.Details, fmt.Sprintf("Slow largest content paint (%s)", r.LCP))
		}
	}

	// Render-blocking
	total++
	rbCount := len(r.RenderBlocking)
	if rbCount == 0 {
		score++
		a.Details = append(a.Details, "No render-blocking resources")
	} else {
		a.Details = append(a.Details, fmt.Sprintf("%d render-blocking resources", rbCount))
	}

	// Speed Index
	total++
	if si := getMs(r.SpeedIndex); si > 0 && si < 3400 {
		score++
	}

	a.Rating = wptRating(score, total)
	a.Summary = wptQuickSummary(r, rbCount)
	return a
}

func assessUsable(r *LighthouseResult) *WPTAssessment {
	a := &WPTAssessment{}
	score := 0
	total := 0

	// CLS
	total++
	if r.CLS != "" {
		a.Details = append(a.Details, fmt.Sprintf("Layout shift: %s", r.CLS))
		if cls := getCLS(r.CLS); cls < 0.1 {
			score++
		}
	}

	// TBT
	total++
	if r.TBT != "" {
		if tbt := getMs(r.TBT); tbt > 0 && tbt < 200 {
			score++
			a.Details = append(a.Details, fmt.Sprintf("Quick interactivity (TBT: %s)", r.TBT))
		} else {
			a.Details = append(a.Details, fmt.Sprintf("Slow interactivity (TBT: %s)", r.TBT))
		}
	}

	// Accessibility
	total++
	if r.Accessibility >= 90 {
		score++
		a.Details = append(a.Details, fmt.Sprintf("Good accessibility (%d/100)", r.Accessibility))
	} else {
		a.Details = append(a.Details, fmt.Sprintf("Accessibility needs work (%d/100)", r.Accessibility))
	}

	// Page weight
	total++
	if r.PageWeight > 0 {
		mb := float64(r.PageWeight) / (1024 * 1024)
		if mb < 3 {
			score++
			a.Details = append(a.Details, fmt.Sprintf("Reasonable page weight (%.1f MB)", mb))
		} else {
			a.Details = append(a.Details, fmt.Sprintf("Heavy page (%.1f MB)", mb))
		}
	}

	a.Rating = wptRating(score, total)
	a.Summary = wptUsableSummary(r)
	return a
}

func assessResilient(r *LighthouseResult) *WPTAssessment {
	a := &WPTAssessment{}
	score := 0
	total := 0

	// 3rd party blocking
	total++
	if r.ThirdPartyBlockingTime < 250 {
		score++
		a.Details = append(a.Details, "Low third-party blocking impact")
	} else {
		a.Details = append(a.Details, fmt.Sprintf("Third-party scripts block for %dms", r.ThirdPartyBlockingTime))
	}

	// Number of 3rd parties
	total++
	tpCount := len(r.ThirdPartySummary)
	if tpCount <= 5 {
		score++
		a.Details = append(a.Details, fmt.Sprintf("%d third-party domains", tpCount))
	} else {
		a.Details = append(a.Details, fmt.Sprintf("%d third-party domains (many dependencies)", tpCount))
	}

	// Total requests
	total++
	if r.TotalRequests > 0 && r.TotalRequests < 100 {
		score++
		a.Details = append(a.Details, fmt.Sprintf("%d total requests", r.TotalRequests))
	} else if r.TotalRequests > 0 {
		a.Details = append(a.Details, fmt.Sprintf("%d total requests (high)", r.TotalRequests))
	}

	// Best practices score (includes security)
	total++
	if r.BestPractices >= 90 {
		score++
		a.Details = append(a.Details, "Good security and best practices")
	} else {
		a.Details = append(a.Details, fmt.Sprintf("Best practices score: %d/100", r.BestPractices))
	}

	a.Rating = wptRating(score, total)
	a.Summary = wptResilientSummary(r, tpCount)
	return a
}

// -- Helper functions --

func wptRating(score, total int) string {
	if total == 0 {
		return "Unknown"
	}
	pct := float64(score) / float64(total) * 100
	switch {
	case pct >= 80:
		return "Good"
	case pct >= 60:
		return "Not Bad"
	case pct >= 40:
		return "Needs Improvement"
	default:
		return "Poor"
	}
}

func wptQuickSummary(r *LighthouseResult, rbCount int) string {
	s := ""
	if r.TTFB != "" {
		s += fmt.Sprintf("Server responded in %s. ", r.TTFB)
	}
	if r.FCP != "" {
		s += fmt.Sprintf("First paint at %s. ", r.FCP)
	}
	if r.LCP != "" {
		s += fmt.Sprintf("Largest content at %s. ", r.LCP)
	}
	if rbCount > 0 {
		s += fmt.Sprintf("%d render-blocking resources.", rbCount)
	}
	return s
}

func wptUsableSummary(r *LighthouseResult) string {
	s := ""
	if r.CLS != "" {
		s += fmt.Sprintf("Layout shift: %s. ", r.CLS)
	}
	if r.TBT != "" {
		s += fmt.Sprintf("Blocking time: %s. ", r.TBT)
	}
	if r.PageWeight > 0 {
		s += fmt.Sprintf("Page weight: %.1f MB. ", float64(r.PageWeight)/(1024*1024))
	}
	if r.Accessibility > 0 {
		s += fmt.Sprintf("Accessibility: %d/100.", r.Accessibility)
	}
	return s
}

func wptResilientSummary(r *LighthouseResult, tpCount int) string {
	s := ""
	if tpCount > 0 {
		s += fmt.Sprintf("%d third-party dependencies. ", tpCount)
	}
	if r.ThirdPartyBlockingTime > 0 {
		s += fmt.Sprintf("Third-party blocking: %dms. ", r.ThirdPartyBlockingTime)
	}
	if r.TotalRequests > 0 {
		s += fmt.Sprintf("%d total requests.", r.TotalRequests)
	}
	return s
}

// getMs parses display values like "1.2 s" or "450 ms" to milliseconds.
func getMs(display string) float64 {
	var val float64
	var unit string
	fmt.Sscanf(display, "%f %s", &val, &unit)
	switch unit {
	case "s":
		return val * 1000
	case "ms":
		return val
	}
	// Try without space: "1.2s"
	fmt.Sscanf(display, "%f%s", &val, &unit)
	switch unit {
	case "s":
		return val * 1000
	case "ms":
		return val
	}
	return 0
}

// getCLS parses CLS display value (unitless number).
func getCLS(display string) float64 {
	var val float64
	fmt.Sscanf(display, "%f", &val)
	return val
}

// truncate shortens a string to maxLen, appending "..." if truncated.
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
