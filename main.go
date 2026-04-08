package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/pantheon-systems-ps/ps-site-check/checker"
)

// --- Result cache ---

var resultCache = struct {
	sync.RWMutex
	items map[string]cachedResult
}{items: make(map[string]cachedResult)}

type cachedResult struct {
	result    *checker.Result
	expiresAt time.Time
}

const cacheTTL = 24 * time.Hour
const maxCacheSize = 1000

// --- Rate limiter ---

var rateLimiter = struct {
	sync.Mutex
	clients map[string]*rateBucket
}{clients: make(map[string]*rateBucket)}

type rateBucket struct {
	tokens    int
	lastReset time.Time
}

const rateLimit = 30        // default requests per window
const rateWindow = time.Minute

// Tiered rate limits by endpoint cost
var endpointLimits = map[string]int{
	"/analyze":         5,   // AI — costs money
	"/lighthouse":      10,  // hits external API
	"/seo":             15,
	"/subdomains":      15,
	"/dns-history":     15,
	"/whois":           15,
	"/crux":            15,
	"/migration-check": 10,
	"/crawl":           5,
	"/compare":         5,
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Clean expired cache entries periodically
	go func() {
		for range time.Tick(10 * time.Minute) {
			cleanCache()
			cleanRateLimiter()
		}
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /check", withMiddleware(handleCheck))
	mux.HandleFunc("POST /check-batch", withMiddleware(handleBatch))
	mux.HandleFunc("POST /check-har", withMiddleware(handleHAR))
	mux.HandleFunc("GET /subdomains", withMiddleware(handleSubdomains))
	mux.HandleFunc("GET /dns-history", withMiddleware(handleDNSHistory))
	mux.HandleFunc("GET /whois", withMiddleware(handleWHOIS))
	mux.HandleFunc("GET /domain", withMiddleware(handleDomainDetails))
	mux.HandleFunc("GET /seo", withMiddleware(handleSEO))
	mux.HandleFunc("GET /crux", withMiddleware(handleCrUX))
	mux.HandleFunc("GET /lighthouse", withMiddleware(handleLighthouse))
	mux.HandleFunc("GET /hsts-preload", withMiddleware(handleHSTSPreload))
	mux.HandleFunc("POST /migration-check", withMiddleware(handleMigrationCheck))
	mux.HandleFunc("POST /analyze", withMiddleware(handleAnalyze))
	mux.HandleFunc("GET /models", handleModels)
	mux.HandleFunc("POST /crawl", withMiddleware(handleCrawl))
	mux.HandleFunc("POST /compare", withMiddleware(handleCompare))
	mux.HandleFunc("GET /agcdn-probe", withMiddleware(handleAGCDNProbe))
	mux.HandleFunc("GET /bot-protection", withMiddleware(handleBotProtection))
	mux.HandleFunc("GET /resources", withMiddleware(handleResources))
	mux.HandleFunc("GET /result/{id}", handleResult)
	mux.HandleFunc("GET /analytics", handleAnalytics)
	mux.HandleFunc("GET /health", handleHealth)

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      withCORS(mux),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 120 * time.Second, // Lighthouse can take up to 60s
		IdleTimeout:  120 * time.Second,
	}

	log.Printf("site-check listening on :%s", port)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}

// --- Middleware ---

func withMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// API key auth (optional — only enforced if API_KEY env var is set)
		apiKey := os.Getenv("API_KEY")
		if apiKey != "" {
			key := r.Header.Get("X-API-Key")
			if key == "" {
				key = r.URL.Query().Get("key")
			}
			if key != apiKey {
				writeJSON(w, http.StatusUnauthorized, map[string]string{
					"error": "invalid or missing API key",
				})
				return
			}
		}

		// Tiered rate limiting
		clientIP := r.Header.Get("X-Forwarded-For")
		if clientIP == "" {
			clientIP = r.RemoteAddr
		}
		limit := rateLimit
		if l, ok := endpointLimits[r.URL.Path]; ok {
			limit = l
		}
		if !checkTieredRateLimit(clientIP, r.URL.Path, limit) {
			writeJSON(w, http.StatusTooManyRequests, map[string]string{
				"error": "rate limit exceeded — max " + strconv.Itoa(limit) + " requests per minute for this endpoint",
			})
			return
		}

		// Structured logging + analytics
		start := time.Now()
		next(w, r)

		// Extract domain from query params for logging
		extra := map[string]string{}
		if domain := r.URL.Query().Get("url"); domain != "" {
			extra["domain"] = domain
		} else if domain := r.URL.Query().Get("domain"); domain != "" {
			extra["domain"] = domain
		} else if domain := r.URL.Query().Get("origin"); domain != "" {
			extra["domain"] = domain
		}

		logRequest(r, time.Since(start), extra)
		trackRequest(r, 200, extra)
	}
}

// --- Handlers ---

func handleCheck(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	rawURL := q.Get("url")
	if rawURL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "missing required parameter: url",
		})
		return
	}

	// Validate resolve IP (SSRF prevention)
	resolve := q.Get("resolve")
	if resolve != "" {
		if errMsg := checker.ValidateResolveIP(resolve); errMsg != "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{
				"error": errMsg,
			})
			return
		}
	}

	// Debug headers: backward compatible — both default to true when neither is specified.
	// When at least one is explicitly provided, use the explicit values.
	pantheonDebug, fastlyDebug := true, true
	if q.Has("debug") || q.Has("fdebug") {
		pantheonDebug = q.Get("debug") == "true"
		fastlyDebug = q.Get("fdebug") == "true"
	}

	// Parse warmup count (default 0 = disabled)
	warmup := 0
	if w := q.Get("warmup"); w != "" {
		if n, err := strconv.Atoi(w); err == nil && n >= 2 && n <= 20 {
			warmup = n
		}
	}

	opts := checker.Options{
		DoubleRequest:   q.Get("double") == "true",
		FollowRedirects: q.Get("follow") == "true",
		ResolveIP:       resolve,
		PantheonDebug:   pantheonDebug,
		FastlyDebug:     fastlyDebug,
		ClientIP:        q.Get("client_ip"),
		UserAgent:       q.Get("user_agent"),
		WarmupRequests:  warmup,
	}

	result := checker.Run(rawURL, opts)
	cacheResult(result)
	writeJSON(w, http.StatusOK, result)
}

func handleBatch(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20)) // 1MB max
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "failed to read body"})
		return
	}

	var req checker.BatchRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON: " + err.Error()})
		return
	}

	if len(req.URLs) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "urls array is required"})
		return
	}

	result := checker.RunBatch(req.URLs, req.Options)

	// Cache each individual result
	for _, r := range result.Results {
		cacheResult(r)
	}

	writeJSON(w, http.StatusOK, result)
}

func handleHAR(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 10<<20)) // 10MB max
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "failed to read body"})
		return
	}

	analysis, err := checker.AnalyzeHAR(body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, analysis)
}

func handleSubdomains(w http.ResponseWriter, r *http.Request) {
	domain := r.URL.Query().Get("domain")
	if domain == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "missing required parameter: domain",
		})
		return
	}

	// Prefer SecurityTrails when API key is available, fall back to crt.sh
	stKey := os.Getenv("SECURITYTRAILS_API_KEY")
	source := r.URL.Query().Get("source") // "crtsh" to force crt.sh
	if stKey != "" && source != "crtsh" {
		result := checker.LookupSubdomainsST(domain, stKey)
		writeJSON(w, http.StatusOK, result)
		return
	}

	result := checker.LookupSubdomains(domain)
	writeJSON(w, http.StatusOK, result)
}

func handleDNSHistory(w http.ResponseWriter, r *http.Request) {
	stKey := os.Getenv("SECURITYTRAILS_API_KEY")
	if stKey == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "SECURITYTRAILS_API_KEY not configured",
		})
		return
	}

	q := r.URL.Query()
	domain := q.Get("domain")
	if domain == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "missing required parameter: domain",
		})
		return
	}

	recordType := q.Get("type")
	if recordType == "" {
		recordType = "a"
	}

	result := checker.LookupDNSHistory(domain, recordType, stKey)
	writeJSON(w, http.StatusOK, result)
}

func handleWHOIS(w http.ResponseWriter, r *http.Request) {
	stKey := os.Getenv("SECURITYTRAILS_API_KEY")
	if stKey == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "SECURITYTRAILS_API_KEY not configured",
		})
		return
	}

	domain := r.URL.Query().Get("domain")
	if domain == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "missing required parameter: domain",
		})
		return
	}

	result := checker.LookupWHOIS(domain, stKey)
	writeJSON(w, http.StatusOK, result)
}

func handleDomainDetails(w http.ResponseWriter, r *http.Request) {
	stKey := os.Getenv("SECURITYTRAILS_API_KEY")
	if stKey == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "SECURITYTRAILS_API_KEY not configured",
		})
		return
	}

	domain := r.URL.Query().Get("domain")
	if domain == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "missing required parameter: domain",
		})
		return
	}

	result := checker.LookupDomainDetails(domain, stKey)
	writeJSON(w, http.StatusOK, result)
}

func handleResult(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing result id"})
		return
	}

	result, ok := loadResult(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "result not found or expired"})
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func handleAnalytics(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, getAnalytics())
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	resultCache.RLock()
	cacheSize := len(resultCache.items)
	resultCache.RUnlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"status":     "ok",
		"cache_size": cacheSize,
	})
}

// --- Helpers ---

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// allowedOrigins for CORS — restrict to known domains
var allowedOrigins = map[string]bool{
	"https://site-check.ps-pantheon.com": true,
	"http://localhost:5173":              true, // Vite dev
	"http://localhost:3000":              true,
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")

		if allowedOrigins[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		} else if origin == "" {
			// No origin = direct API call (curl, server-side), allow
			w.Header().Set("Access-Control-Allow-Origin", "https://site-check.ps-pantheon.com")
		}
		// Don't set the header at all for unknown origins — browser will block

		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-API-Key, X-Recaptcha-Token")
		w.Header().Set("Access-Control-Max-Age", "86400")
		w.Header().Set("Vary", "Origin")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// --- Structured logging ---

func logRequest(r *http.Request, duration time.Duration, extra map[string]string) {
	entry := map[string]any{
		"severity":    "INFO",
		"method":      r.Method,
		"path":        r.URL.Path,
		"query":       r.URL.RawQuery,
		"remote_ip":   r.Header.Get("X-Forwarded-For"),
		"user_agent":  r.UserAgent(),
		"duration_ms": duration.Milliseconds(),
		"timestamp":   time.Now().UTC().Format(time.RFC3339),
	}
	if entry["remote_ip"] == "" {
		entry["remote_ip"] = r.RemoteAddr
	}
	// Add extra fields (domain, model, etc.)
	for k, v := range extra {
		if v != "" {
			entry[k] = v
		}
	}
	b, _ := json.Marshal(entry)
	log.Println(string(b))
}

// --- Rate limiting ---

func checkRateLimit(clientIP string) bool {
	return checkTieredRateLimit(clientIP, "", rateLimit)
}

func checkTieredRateLimit(clientIP, path string, limit int) bool {
	rateLimiter.Lock()
	defer rateLimiter.Unlock()

	// Use IP+path as key for per-endpoint limiting
	key := clientIP
	if path != "" {
		key = clientIP + "|" + path
	}

	bucket, ok := rateLimiter.clients[key]
	if !ok || time.Since(bucket.lastReset) > rateWindow {
		rateLimiter.clients[key] = &rateBucket{tokens: limit - 1, lastReset: time.Now()}
		return true
	}

	if bucket.tokens <= 0 {
		return false
	}

	bucket.tokens--
	return true
}

func cleanRateLimiter() {
	rateLimiter.Lock()
	defer rateLimiter.Unlock()
	now := time.Now()
	for ip, bucket := range rateLimiter.clients {
		if now.Sub(bucket.lastReset) > rateWindow*2 {
			delete(rateLimiter.clients, ip)
		}
	}
}

// --- Result cache (in-memory + GCS for persistence) ---

const gcsBucket = "ps-site-check-results"

func cacheResult(result *checker.Result) {
	// In-memory cache (fast reads)
	resultCache.Lock()
	if len(resultCache.items) >= maxCacheSize {
		var oldestID string
		var oldestTime time.Time
		for id, item := range resultCache.items {
			if oldestID == "" || item.expiresAt.Before(oldestTime) {
				oldestID = id
				oldestTime = item.expiresAt
			}
		}
		if oldestID != "" {
			delete(resultCache.items, oldestID)
		}
	}
	resultCache.items[result.ID] = cachedResult{
		result:    result,
		expiresAt: time.Now().Add(cacheTTL),
	}
	resultCache.Unlock()

	// Persist to GCS (async, non-blocking)
	go func() {
		if err := gcsWrite(result.ID, result); err != nil {
			log.Printf("GCS write failed for %s: %v", result.ID, err)
		}
	}()
}

func loadResult(id string) (*checker.Result, bool) {
	// Try in-memory first
	resultCache.RLock()
	cached, ok := resultCache.items[id]
	resultCache.RUnlock()
	if ok && time.Now().Before(cached.expiresAt) {
		return cached.result, true
	}

	// Fall back to GCS
	result, err := gcsRead(id)
	if err != nil {
		return nil, false
	}

	// Populate in-memory cache for subsequent reads
	resultCache.Lock()
	resultCache.items[id] = cachedResult{result: result, expiresAt: time.Now().Add(cacheTTL)}
	resultCache.Unlock()

	return result, true
}

func gcsWrite(id string, result *checker.Result) error {
	token, err := checker.GetAccessToken()
	if err != nil {
		return err
	}

	data, err := json.Marshal(result)
	if err != nil {
		return err
	}

	url := "https://storage.googleapis.com/upload/storage/v1/b/" + gcsBucket + "/o?uploadType=media&name=" + id + ".json"
	req, _ := http.NewRequest("POST", url, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("GCS upload %d: %s", resp.StatusCode, string(body[:min(len(body), 200)]))
	}
	return nil
}

func gcsRead(id string) (*checker.Result, error) {
	token, err := checker.GetAccessToken()
	if err != nil {
		return nil, err
	}

	url := "https://storage.googleapis.com/storage/v1/b/" + gcsBucket + "/o/" + id + ".json?alt=media"
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("not found")
	}

	var result checker.Result
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return &result, nil
}

func cleanCache() {
	resultCache.Lock()
	defer resultCache.Unlock()
	now := time.Now()
	for id, item := range resultCache.items {
		if now.After(item.expiresAt) {
			delete(resultCache.items, id)
		}
	}
}

// --- New handlers: SEO, CrUX, Lighthouse, HSTS Preload, Migration ---

func handleSEO(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	rawURL := q.Get("url")
	if rawURL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing required parameter: url"})
		return
	}

	resolve := q.Get("resolve")
	if resolve != "" {
		if errMsg := checker.ValidateResolveIP(resolve); errMsg != "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": errMsg})
			return
		}
	}

	opts := checker.Options{
		ResolveIP: resolve,
		UserAgent: q.Get("user_agent"),
	}

	result := checker.AuditSEO(rawURL, opts)
	writeJSON(w, http.StatusOK, result)
}

func handleCrUX(w http.ResponseWriter, r *http.Request) {
	origin := r.URL.Query().Get("origin")
	if origin == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing required parameter: origin"})
		return
	}

	apiKey := os.Getenv("CRUX_API_KEY")
	result := checker.FetchCrUX(origin, apiKey)
	writeJSON(w, http.StatusOK, result)
}

func handleLighthouse(w http.ResponseWriter, r *http.Request) {
	rawURL := r.URL.Query().Get("url")
	if rawURL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing required parameter: url"})
		return
	}

	strategy := r.URL.Query().Get("strategy")
	if strategy == "" {
		strategy = "mobile"
	}

	result := checker.FetchLighthouse(rawURL, strategy)
	writeJSON(w, http.StatusOK, result)
}

func handleHSTSPreload(w http.ResponseWriter, r *http.Request) {
	domain := r.URL.Query().Get("domain")
	if domain == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing required parameter: domain"})
		return
	}

	result := checker.CheckHSTSPreload(domain)
	writeJSON(w, http.StatusOK, result)
}

func handleModels(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"models":            checker.SupportedModels(),
		"recaptcha_site_key": os.Getenv("RECAPTCHA_SITE_KEY"),
	})
}

func handleAnalyze(w http.ResponseWriter, r *http.Request) {
	// reCAPTCHA verification (if configured)
	recaptchaSecret := os.Getenv("RECAPTCHA_SECRET_KEY")
	if recaptchaSecret != "" {
		token := r.Header.Get("X-Recaptcha-Token")
		if token == "" {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "reCAPTCHA token required"})
			return
		}
		if !verifyRecaptcha(recaptchaSecret, token) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "reCAPTCHA verification failed"})
			return
		}
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "failed to read body"})
		return
	}

	var req checker.AIAnalyzeRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON: " + err.Error()})
		return
	}

	if req.Mode == "" {
		req.Mode = "check"
	}

	result := checker.AnalyzeWithAI(req)

	// Track AI model usage in analytics
	trackRequest(r, 200, map[string]string{"model": req.Model})

	writeJSON(w, http.StatusOK, result)
}

// verifyRecaptcha checks a reCAPTCHA v3 token with Google's API.
func verifyRecaptcha(secret, token string) bool {
	resp, err := http.PostForm("https://www.google.com/recaptcha/api/siteverify", map[string][]string{
		"secret":   {secret},
		"response": {token},
	})
	if err != nil {
		log.Printf("reCAPTCHA verify error: %v", err)
		return false
	}
	defer resp.Body.Close()

	var result struct {
		Success bool    `json:"success"`
		Score   float64 `json:"score"`
		Action  string  `json:"action"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return false
	}

	// Score threshold: 0.5+ is likely human (0.0 = bot, 1.0 = human)
	return result.Success && result.Score >= 0.5
}

func handleCrawl(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "failed to read body"})
		return
	}

	var req struct {
		URL   string `json:"url"`
		Depth int    `json:"depth"`
	}
	if err := json.Unmarshal(body, &req); err != nil || req.URL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "JSON body with 'url' field required"})
		return
	}
	if req.Depth < 1 || req.Depth > 3 {
		req.Depth = 2
	}

	result := checker.CrawlSite(req.URL, req.Depth)
	writeJSON(w, http.StatusOK, result)
}

func handleCompare(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "failed to read body"})
		return
	}

	var req struct {
		SiteA string `json:"site_a"`
		SiteB string `json:"site_b"`
		Depth int    `json:"depth"`
	}
	if err := json.Unmarshal(body, &req); err != nil || req.SiteA == "" || req.SiteB == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "JSON body with 'site_a' and 'site_b' fields required"})
		return
	}
	if req.Depth < 1 || req.Depth > 3 {
		req.Depth = 2
	}

	result := checker.CompareSites(req.SiteA, req.SiteB, req.Depth)
	writeJSON(w, http.StatusOK, result)
}

func handleAGCDNProbe(w http.ResponseWriter, r *http.Request) {
	domain := r.URL.Query().Get("domain")
	if domain == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing required parameter: domain"})
		return
	}

	result := checker.ProbeAGCDN(domain)
	writeJSON(w, http.StatusOK, result)
}

func handleBotProtection(w http.ResponseWriter, r *http.Request) {
	domain := r.URL.Query().Get("domain")
	if domain == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing required parameter: domain"})
		return
	}

	result := checker.DetectBotProtection(domain)
	writeJSON(w, http.StatusOK, result)
}

func handleResources(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	rawURL := q.Get("url")
	if rawURL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing required parameter: url"})
		return
	}

	resolve := q.Get("resolve")
	if resolve != "" {
		if errMsg := checker.ValidateResolveIP(resolve); errMsg != "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": errMsg})
			return
		}
	}

	opts := checker.Options{
		ResolveIP: resolve,
		UserAgent: q.Get("user_agent"),
	}

	result := checker.AuditResources(rawURL, opts)
	writeJSON(w, http.StatusOK, result)
}

func handleMigrationCheck(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "failed to read body"})
		return
	}

	var req struct {
		Domain string `json:"domain"`
	}
	if err := json.Unmarshal(body, &req); err != nil || req.Domain == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "JSON body with 'domain' field required"})
		return
	}

	result := checker.CheckMigrationReadiness(req.Domain)
	writeJSON(w, http.StatusOK, result)
}
