package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/pantheon-systems-ps/ps-site-check/checker"
)

// resultCache stores check results for permalink access.
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

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Clean expired cache entries every 10 minutes
	go func() {
		for range time.Tick(10 * time.Minute) {
			cleanCache()
		}
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /check", handleCheck)
	mux.HandleFunc("GET /result/{id}", handleResult)
	mux.HandleFunc("GET /health", handleHealth)

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      withCORS(mux),
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	log.Printf("site-check listening on :%s", port)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}

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

	// Cache for permalink access
	cacheResult(result)

	writeJSON(w, http.StatusOK, result)
}

func handleResult(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "missing result id",
		})
		return
	}

	resultCache.RLock()
	cached, ok := resultCache.items[id]
	resultCache.RUnlock()

	if !ok || time.Now().After(cached.expiresAt) {
		writeJSON(w, http.StatusNotFound, map[string]string{
			"error": "result not found or expired",
		})
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

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func cacheResult(result *checker.Result) {
	resultCache.Lock()
	defer resultCache.Unlock()

	// Evict oldest if at capacity
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
