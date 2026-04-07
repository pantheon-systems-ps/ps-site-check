package checker

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// AIAnalysis is the structured response from the AI analysis.
type AIAnalysis struct {
	Summary   string   `json:"summary"`
	Findings  []string `json:"findings"`
	NextSteps []string `json:"next_steps"`
	Risk      string   `json:"risk,omitempty"` // "low", "medium", "high"
	Raw       string   `json:"raw,omitempty"`  // full AI response text
	DurationMS int64   `json:"duration_ms"`
	Error     string   `json:"error,omitempty"`
}

// AIAnalyzeRequest is the input to the analyze endpoint.
type AIAnalyzeRequest struct {
	Check      *Result          `json:"check,omitempty"`
	SEO        *SEOAudit        `json:"seo,omitempty"`
	Lighthouse *LighthouseResult `json:"lighthouse,omitempty"`
	Migration  *MigrationReadiness `json:"migration,omitempty"`
	CompareA   *Result          `json:"compare_a,omitempty"`
	CompareB   *Result          `json:"compare_b,omitempty"`
	Mode       string           `json:"mode"` // "check", "compare", "migration"
}

// AnalyzeWithAI sends check results to Claude via Vertex AI for analysis.
func AnalyzeWithAI(req AIAnalyzeRequest) *AIAnalysis {
	start := time.Now()

	// Build the prompt based on mode
	prompt := buildAnalysisPrompt(req)
	if prompt == "" {
		return &AIAnalysis{Error: "no data to analyze", DurationMS: time.Since(start).Milliseconds()}
	}

	// Get access token from metadata server (Cloud Run ADC)
	token, err := getAccessToken()
	if err != nil {
		return &AIAnalysis{Error: "failed to get access token: " + err.Error(), DurationMS: time.Since(start).Milliseconds()}
	}

	// Call Vertex AI
	projectID := os.Getenv("GCP_PROJECT_ID")
	if projectID == "" {
		projectID = "pantheon-psapps"
	}
	region := os.Getenv("VERTEX_AI_REGION")
	if region == "" {
		region = "us-east5"
	}
	model := os.Getenv("VERTEX_AI_MODEL")
	if model == "" {
		model = "claude-opus-4-6@default"
	}

	endpoint := fmt.Sprintf(
		"https://%s-aiplatform.googleapis.com/v1/projects/%s/locations/%s/publishers/anthropic/models/%s:rawPredict",
		region, projectID, region, model,
	)

	body := map[string]any{
		"anthropic_version": "vertex-2023-10-16",
		"max_tokens":        2048,
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
		"system": buildSystemPrompt(req.Mode),
	}

	bodyJSON, _ := json.Marshal(body)

	httpReq, err := http.NewRequest("POST", endpoint, bytes.NewReader(bodyJSON))
	if err != nil {
		return &AIAnalysis{Error: "failed to create request: " + err.Error(), DurationMS: time.Since(start).Milliseconds()}
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return &AIAnalysis{Error: "Vertex AI request failed: " + err.Error(), DurationMS: time.Since(start).Milliseconds()}
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	if resp.StatusCode != 200 {
		return &AIAnalysis{
			Error:      fmt.Sprintf("Vertex AI returned %d: %s", resp.StatusCode, string(respBody)),
			DurationMS: time.Since(start).Milliseconds(),
		}
	}

	// Parse the Anthropic response
	var aiResp struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal(respBody, &aiResp); err != nil {
		return &AIAnalysis{Error: "failed to parse AI response: " + err.Error(), DurationMS: time.Since(start).Milliseconds()}
	}

	if len(aiResp.Content) == 0 {
		return &AIAnalysis{Error: "empty AI response", DurationMS: time.Since(start).Milliseconds()}
	}

	rawText := aiResp.Content[0].Text

	// Parse structured output from the AI response
	analysis := parseAIResponse(rawText)
	analysis.DurationMS = time.Since(start).Milliseconds()
	analysis.Raw = rawText

	return analysis
}

func buildSystemPrompt(mode string) string {
	base := `You are a senior site reliability engineer and web performance expert at Pantheon, a WebOps platform for Drupal and WordPress.

Analyze the site check data provided and give actionable, specific insights. Be direct and concise. No filler.

Structure your response EXACTLY like this:

SUMMARY
(2-3 sentence executive summary of the site's overall health)

FINDINGS
- (specific finding 1)
- (specific finding 2)
- (etc.)

NEXT STEPS
- (prioritized action item 1)
- (prioritized action item 2)
- (etc.)

RISK: (low|medium|high)
`

	switch mode {
	case "compare":
		return base + "\nYou are comparing two sites. Highlight meaningful differences and explain which site is better configured and why."
	case "migration":
		return base + "\nYou are assessing a domain's readiness for migration to Pantheon. Flag blockers, warn about DNS/email records that must be preserved, and provide a migration confidence score."
	default:
		return base
	}
}

func buildAnalysisPrompt(req AIAnalyzeRequest) string {
	var parts []string

	switch req.Mode {
	case "compare":
		if req.CompareA != nil {
			a, _ := json.MarshalIndent(summarizeResult(req.CompareA), "", "  ")
			parts = append(parts, "## Site A\n```json\n"+string(a)+"\n```")
		}
		if req.CompareB != nil {
			b, _ := json.MarshalIndent(summarizeResult(req.CompareB), "", "  ")
			parts = append(parts, "## Site B\n```json\n"+string(b)+"\n```")
		}
	case "migration":
		if req.Migration != nil {
			m, _ := json.MarshalIndent(req.Migration, "", "  ")
			parts = append(parts, "## Migration Readiness\n```json\n"+string(m)+"\n```")
		}
	default:
		if req.Check != nil {
			c, _ := json.MarshalIndent(summarizeResult(req.Check), "", "  ")
			parts = append(parts, "## Site Check\n```json\n"+string(c)+"\n```")
		}
		if req.SEO != nil {
			s, _ := json.MarshalIndent(summarizeSEO(req.SEO), "", "  ")
			parts = append(parts, "## SEO Audit\n```json\n"+string(s)+"\n```")
		}
		if req.Lighthouse != nil {
			l, _ := json.MarshalIndent(req.Lighthouse, "", "  ")
			parts = append(parts, "## Lighthouse\n```json\n"+string(l)+"\n```")
		}
	}

	if len(parts) == 0 {
		return ""
	}

	return "Analyze the following site check results:\n\n" + strings.Join(parts, "\n\n")
}

// summarizeResult strips large fields to fit in the prompt context.
func summarizeResult(r *Result) map[string]any {
	summary := map[string]any{
		"url":         r.URL,
		"duration_ms": r.DurationMS,
	}
	if r.HTTP != nil {
		summary["http_status"] = r.HTTP.StatusCode
		summary["http_duration_ms"] = r.HTTP.DurationMS
		// Include key headers only
		keyHeaders := map[string]string{}
		for _, h := range []string{"cache-control", "x-cache", "age", "server", "strict-transport-security", "content-security-policy", "x-served-by", "agcdn-info", "x-pantheon-styx-hostname", "x-pantheon-environment", "x-pantheon-site"} {
			if v, ok := r.HTTP.Headers[h]; ok {
				keyHeaders[h] = v
			}
		}
		summary["key_headers"] = keyHeaders
	}
	if r.DNS != nil {
		summary["dns_a"] = r.DNS.A
		summary["dns_cname"] = r.DNS.CNAME
		summary["dns_duration_ms"] = r.DNS.DurationMS
	}
	if r.TLS != nil {
		summary["tls_protocol"] = r.TLS.Protocol
		summary["tls_issuer"] = r.TLS.Issuer
		summary["tls_subject"] = r.TLS.Subject
		summary["tls_valid_to"] = r.TLS.ValidTo
		summary["tls_cipher"] = r.TLS.CipherSuite
		summary["tls_cipher_security"] = r.TLS.CipherSecurity
	}
	if r.Security != nil {
		summary["security_grade"] = r.Security.Grade
		summary["security_score"] = r.Security.Score
	}
	if r.EmailAuth != nil {
		summary["email_auth_grade"] = r.EmailAuth.Grade
	}
	if r.Pantheon != nil {
		summary["pantheon"] = r.Pantheon
	}
	summary["insights"] = r.Insights
	return summary
}

// summarizeSEO strips content to fit in prompt.
func summarizeSEO(s *SEOAudit) map[string]any {
	return map[string]any{
		"score":           s.Score,
		"title":           s.Title,
		"description":     s.Description,
		"canonical":       s.Canonical,
		"headings":        s.Headings,
		"images":          s.Images,
		"robots_txt":      s.RobotsTxt,
		"sitemap":         s.Sitemap,
		"structured_data": s.StructuredData,
		"mixed_content":   len(s.MixedContent),
		"issues":          s.Issues,
	}
}

// parseAIResponse extracts structured data from the AI's text response.
func parseAIResponse(text string) *AIAnalysis {
	analysis := &AIAnalysis{}

	lines := strings.Split(text, "\n")
	section := ""
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)

		switch {
		case trimmed == "SUMMARY":
			section = "summary"
			continue
		case trimmed == "FINDINGS":
			section = "findings"
			continue
		case trimmed == "NEXT STEPS":
			section = "nextsteps"
			continue
		case strings.HasPrefix(trimmed, "RISK:"):
			risk := strings.TrimSpace(strings.TrimPrefix(trimmed, "RISK:"))
			analysis.Risk = strings.ToLower(risk)
			section = ""
			continue
		}

		if trimmed == "" {
			continue
		}

		switch section {
		case "summary":
			if analysis.Summary != "" {
				analysis.Summary += " "
			}
			analysis.Summary += trimmed
		case "findings":
			if strings.HasPrefix(trimmed, "- ") || strings.HasPrefix(trimmed, "* ") {
				analysis.Findings = append(analysis.Findings, strings.TrimLeft(trimmed, "-* "))
			} else if len(analysis.Findings) > 0 {
				// continuation line
				analysis.Findings[len(analysis.Findings)-1] += " " + trimmed
			}
		case "nextsteps":
			if strings.HasPrefix(trimmed, "- ") || strings.HasPrefix(trimmed, "* ") {
				analysis.NextSteps = append(analysis.NextSteps, strings.TrimLeft(trimmed, "-* "))
			} else if len(analysis.NextSteps) > 0 {
				analysis.NextSteps[len(analysis.NextSteps)-1] += " " + trimmed
			}
		}
	}

	// Fallback: if parsing failed, put everything in summary
	if analysis.Summary == "" && len(analysis.Findings) == 0 {
		analysis.Summary = text
	}

	return analysis
}

// getAccessToken retrieves an access token from the GCP metadata server.
func getAccessToken() (string, error) {
	// Try metadata server first (Cloud Run)
	client := &http.Client{Timeout: 5 * time.Second}
	req, _ := http.NewRequest("GET",
		"http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
		nil,
	)
	req.Header.Set("Metadata-Flavor", "Google")

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("metadata server unavailable: %w", err)
	}
	defer resp.Body.Close()

	var tokenResp struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return "", fmt.Errorf("failed to parse token: %w", err)
	}

	return tokenResp.AccessToken, nil
}
