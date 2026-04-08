package main

import (
	"net/http"
	"sort"
	"strconv"
	"sync"
	"time"
)

// --- In-memory analytics tracker ---

var analytics = struct {
	sync.RWMutex
	startTime    time.Time
	totalHits    int64
	endpointHits map[string]int64
	domainHits   map[string]int64
	aiModelHits  map[string]int64
	statusCodes  map[int]int64
	hourlyHits   [24]int64 // hits per hour of day (UTC)
	dailyHits    map[string]int64 // hits per date (YYYY-MM-DD)
	topIPs       map[string]int64
}{
	startTime:    time.Now(),
	endpointHits: make(map[string]int64),
	domainHits:   make(map[string]int64),
	aiModelHits:  make(map[string]int64),
	statusCodes:  make(map[int]int64),
	dailyHits:    make(map[string]int64),
	topIPs:       make(map[string]int64),
}

// trackRequest records a request in the analytics.
func trackRequest(r *http.Request, statusCode int, extra map[string]string) {
	analytics.Lock()
	defer analytics.Unlock()

	analytics.totalHits++
	analytics.endpointHits[r.URL.Path]++
	analytics.statusCodes[statusCode]++

	now := time.Now().UTC()
	analytics.hourlyHits[now.Hour()]++
	analytics.dailyHits[now.Format("2006-01-02")]++

	// Track IP (first part of X-Forwarded-For)
	ip := r.Header.Get("X-Forwarded-For")
	if ip == "" {
		ip = r.RemoteAddr
	}
	analytics.topIPs[ip]++

	// Track domain if present
	if domain, ok := extra["domain"]; ok && domain != "" {
		analytics.domainHits[domain]++
	}

	// Track AI model if present
	if model, ok := extra["model"]; ok && model != "" {
		analytics.aiModelHits[model]++
	}
}

// getAnalytics returns a snapshot of current analytics data.
func getAnalytics() map[string]any {
	analytics.RLock()
	defer analytics.RUnlock()

	uptime := time.Since(analytics.startTime)

	// Sort domains by hit count (top 20)
	type kv struct {
		Key   string
		Count int64
	}

	topDomains := sortedTop(analytics.domainHits, 20)
	topEndpoints := sortedTop(analytics.endpointHits, 20)
	topIPs := sortedTop(analytics.topIPs, 10)

	// Today's hits
	today := time.Now().UTC().Format("2006-01-02")
	todayHits := analytics.dailyHits[today]

	// Daily hits (last 7 days)
	daily := make(map[string]int64)
	for i := 0; i < 7; i++ {
		d := time.Now().UTC().AddDate(0, 0, -i).Format("2006-01-02")
		daily[d] = analytics.dailyHits[d]
	}

	return map[string]any{
		"uptime_seconds":  int(uptime.Seconds()),
		"uptime_human":    formatDuration(uptime),
		"total_requests":  analytics.totalHits,
		"today_requests":  todayHits,
		"top_endpoints":   topEndpoints,
		"top_domains":     topDomains,
		"top_ips":         topIPs,
		"ai_model_usage":  analytics.aiModelHits,
		"status_codes":    analytics.statusCodes,
		"hourly_distribution": analytics.hourlyHits,
		"daily_hits":      daily,
	}
}

func sortedTop(m map[string]int64, n int) []map[string]any {
	type kv struct {
		Key   string
		Count int64
	}
	var sorted []kv
	for k, v := range m {
		sorted = append(sorted, kv{k, v})
	}
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Count > sorted[j].Count })
	if len(sorted) > n {
		sorted = sorted[:n]
	}
	result := make([]map[string]any, len(sorted))
	for i, s := range sorted {
		result[i] = map[string]any{"name": s.Key, "count": s.Count}
	}
	return result
}

func formatDuration(d time.Duration) string {
	days := int(d.Hours()) / 24
	hours := int(d.Hours()) % 24
	mins := int(d.Minutes()) % 60
	if days > 0 {
		return strconv.Itoa(days) + "d " + strconv.Itoa(hours) + "h " + strconv.Itoa(mins) + "m"
	}
	if hours > 0 {
		return strconv.Itoa(hours) + "h " + strconv.Itoa(mins) + "m"
	}
	return strconv.Itoa(mins) + "m"
}
