package checker

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
)

// SubdomainResult contains discovered subdomains from Certificate Transparency logs.
type SubdomainResult struct {
	Domain     string   `json:"domain"`
	Subdomains []string `json:"subdomains"`
	Count      int      `json:"count"`
	Source     string   `json:"source"`
	DurationMS int64   `json:"duration_ms"`
	Error      string   `json:"error,omitempty"`
}

// crtShEntry represents a single entry from crt.sh JSON API.
type crtShEntry struct {
	NameValue string `json:"name_value"`
}

// LookupSubdomains queries Certificate Transparency logs via crt.sh for subdomains.
func LookupSubdomains(domain string) *SubdomainResult {
	start := time.Now()

	domain = strings.TrimSpace(strings.ToLower(domain))
	domain = strings.TrimPrefix(domain, "https://")
	domain = strings.TrimPrefix(domain, "http://")
	domain = strings.TrimRight(domain, "/")

	// Strip any path or port
	if idx := strings.Index(domain, "/"); idx != -1 {
		domain = domain[:idx]
	}
	if idx := strings.Index(domain, ":"); idx != -1 {
		domain = domain[:idx]
	}

	if domain == "" {
		return &SubdomainResult{Error: "domain is required"}
	}

	url := fmt.Sprintf("https://crt.sh/?q=%%25.%s&output=json", domain)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return &SubdomainResult{
			Domain:     domain,
			Source:     "crt.sh (Certificate Transparency)",
			DurationMS: time.Since(start).Milliseconds(),
			Error:      "failed to query crt.sh: " + err.Error(),
		}
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return &SubdomainResult{
			Domain:     domain,
			Source:     "crt.sh (Certificate Transparency)",
			DurationMS: time.Since(start).Milliseconds(),
			Error:      fmt.Sprintf("crt.sh returned HTTP %d", resp.StatusCode),
		}
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 5<<20)) // 5MB limit
	if err != nil {
		return &SubdomainResult{
			Domain:     domain,
			Source:     "crt.sh (Certificate Transparency)",
			DurationMS: time.Since(start).Milliseconds(),
			Error:      "failed to read response: " + err.Error(),
		}
	}

	var entries []crtShEntry
	if err := json.Unmarshal(body, &entries); err != nil {
		return &SubdomainResult{
			Domain:     domain,
			Source:     "crt.sh (Certificate Transparency)",
			DurationMS: time.Since(start).Milliseconds(),
			Error:      "failed to parse crt.sh response",
		}
	}

	// Deduplicate and clean subdomains
	seen := make(map[string]bool)
	for _, entry := range entries {
		// crt.sh name_value can contain multiple names separated by newlines
		for _, name := range strings.Split(entry.NameValue, "\n") {
			name = strings.TrimSpace(strings.ToLower(name))
			// Skip wildcard prefix for cleaner results
			name = strings.TrimPrefix(name, "*.")
			if name != "" && strings.HasSuffix(name, domain) {
				seen[name] = true
			}
		}
	}

	subdomains := make([]string, 0, len(seen))
	for name := range seen {
		subdomains = append(subdomains, name)
	}
	sort.Strings(subdomains)

	return &SubdomainResult{
		Domain:     domain,
		Subdomains: subdomains,
		Count:      len(subdomains),
		Source:     "crt.sh (Certificate Transparency)",
		DurationMS: time.Since(start).Milliseconds(),
	}
}
