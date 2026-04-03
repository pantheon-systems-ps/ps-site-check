package main

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
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

const rateLimit = 30        // requests per window
const rateWindow = time.Minute

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
	mux.HandleFunc("GET /result/{id}", handleResult)
	mux.HandleFunc("GET /health", handleHealth)

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      withCORS(mux),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 60 * time.Second,
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

		// Rate limiting
		clientIP := r.Header.Get("X-Forwarded-For")
		if clientIP == "" {
			clientIP = r.RemoteAddr
		}
		if !checkRateLimit(clientIP) {
			writeJSON(w, http.StatusTooManyRequests, map[string]string{
				"error": "rate limit exceeded — max 30 requests per minute",
			})
			return
		}

		// Structured logging
		start := time.Now()
		next(w, r)
		logRequest(r, time.Since(start))
	}
}

// --- Handlers ---

func handleCheck(w http.ResponseWriter, r *http.Request) {
	url := r.URL.Query().Get("url")
	if url == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "missing required parameter: url",
		})
		return
	}

	opts := checker.Options{
		DoubleRequest:   r.URL.Query().Get("double") == "true",
		FollowRedirects: r.URL.Query().Get("follow") == "true",
	}

	result := checker.Run(url, opts)
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

func handleResult(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing result id"})
		return
	}

	resultCache.RLock()
	cached, ok := resultCache.items[id]
	resultCache.RUnlock()

	if !ok || time.Now().After(cached.expiresAt) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "result not found or expired"})
		return
	}

	writeJSON(w, http.StatusOK, cached.result)
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

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-API-Key")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// --- Structured logging ---

func logRequest(r *http.Request, duration time.Duration) {
	entry := map[string]any{
		"severity":   "INFO",
		"method":     r.Method,
		"path":       r.URL.Path,
		"query":      r.URL.RawQuery,
		"remote_ip":  r.Header.Get("X-Forwarded-For"),
		"user_agent": r.UserAgent(),
		"duration_ms": duration.Milliseconds(),
		"timestamp":  time.Now().UTC().Format(time.RFC3339),
	}
	if entry["remote_ip"] == "" {
		entry["remote_ip"] = r.RemoteAddr
	}
	b, _ := json.Marshal(entry)
	log.Println(string(b))
}

// --- Rate limiting ---

func checkRateLimit(clientIP string) bool {
	rateLimiter.Lock()
	defer rateLimiter.Unlock()

	bucket, ok := rateLimiter.clients[clientIP]
	if !ok || time.Since(bucket.lastReset) > rateWindow {
		rateLimiter.clients[clientIP] = &rateBucket{tokens: rateLimit - 1, lastReset: time.Now()}
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

// --- Result cache ---

func cacheResult(result *checker.Result) {
	resultCache.Lock()
	defer resultCache.Unlock()

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
