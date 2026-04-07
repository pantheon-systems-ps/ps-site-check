package checker

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
)

// CheckHSTSPreload checks if a domain is on the HSTS preload list.
func CheckHSTSPreload(domain string) *HSTSPreload {
	domain = strings.TrimSpace(strings.ToLower(domain))

	result := &HSTSPreload{
		Domain: domain,
		Status: "unknown",
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get("https://hstspreload.org/api/v2/status?domain=" + domain)
	if err != nil {
		result.Issues = append(result.Issues, "Failed to check HSTS preload list: "+err.Error())
		return result
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		result.Issues = append(result.Issues, "Failed to read preload response")
		return result
	}

	var data struct {
		Status string `json:"status"` // "preloaded", "pending", "unknown"
		Name   string `json:"name"`
	}
	if err := json.Unmarshal(body, &data); err != nil {
		result.Issues = append(result.Issues, "Failed to parse preload response")
		return result
	}

	result.Status = data.Status

	switch data.Status {
	case "preloaded":
		result.Preloaded = true
	case "pending":
		result.Issues = append(result.Issues, "Domain is pending addition to the preload list")
	default:
		result.Issues = append(result.Issues, "Domain is not on the HSTS preload list")
		result.Issues = append(result.Issues, "To preload: set HSTS header with max-age >= 31536000, includeSubDomains, and preload directives")
	}

	return result
}
