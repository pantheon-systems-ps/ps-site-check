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
	Summary    string   `json:"summary"`
	Findings   []string `json:"findings"`
	NextSteps  []string `json:"next_steps"`
	Risk       string   `json:"risk,omitempty"`
	Model      string   `json:"model,omitempty"`
	DurationMS int64    `json:"duration_ms"`
	Error      string   `json:"error,omitempty"`
}

// AIAnalyzeRequest is the input to the analyze endpoint.
type AIAnalyzeRequest struct {
	Check      *Result             `json:"check,omitempty"`
	SEO        *SEOAudit           `json:"seo,omitempty"`
	Lighthouse *LighthouseResult   `json:"lighthouse,omitempty"`
	Migration  *MigrationReadiness `json:"migration,omitempty"`
	CompareA   *Result             `json:"compare_a,omitempty"`
	CompareB   *Result             `json:"compare_b,omitempty"`
	Mode       string              `json:"mode"`
	Model      string              `json:"model,omitempty"`
}

// ModelConfig describes a supported AI model.
type ModelConfig struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Publisher string  `json:"publisher"` // "anthropic" or "google"
	Region    string  `json:"region"`
	VertexID  string  `json:"vertex_id"`
	CostPer   string  `json:"cost_per"` // estimated cost per analysis
}

// SupportedModels returns the list of available models.
func SupportedModels() []ModelConfig {
	return []ModelConfig{
		{ID: "claude-opus-4-6", Name: "Claude Opus 4.6", Publisher: "anthropic", Region: "us-east5", VertexID: "claude-opus-4-6@default", CostPer: "~$0.12"},
		{ID: "claude-sonnet-4-6", Name: "Claude Sonnet 4.6", Publisher: "anthropic", Region: "us-east5", VertexID: "claude-sonnet-4-6@default", CostPer: "~$0.024"},
		{ID: "gemini-2.5-pro", Name: "Gemini 2.5 Pro", Publisher: "google", Region: "us-east1", VertexID: "gemini-2.5-pro", CostPer: "~$0.014"},
		{ID: "gemini-2.5-flash", Name: "Gemini 2.5 Flash", Publisher: "google", Region: "us-east1", VertexID: "gemini-2.5-flash", CostPer: "~$0.001"},
	}
}

func getModelConfig(modelID string) ModelConfig {
	for _, m := range SupportedModels() {
		if m.ID == modelID {
			return m
		}
	}
	// Default to Opus
	return SupportedModels()[0]
}

// AnalyzeWithAI sends check results to an AI model via Vertex AI for analysis.
func AnalyzeWithAI(req AIAnalyzeRequest) *AIAnalysis {
	start := time.Now()

	prompt := buildAnalysisPrompt(req)
	if prompt == "" {
		return &AIAnalysis{Error: "no data to analyze", DurationMS: time.Since(start).Milliseconds()}
	}

	token, err := getAccessToken()
	if err != nil {
		return &AIAnalysis{Error: "failed to get access token: " + err.Error(), DurationMS: time.Since(start).Milliseconds()}
	}

	projectID := os.Getenv("GCP_PROJECT_ID")
	if projectID == "" {
		projectID = "pantheon-psapps"
	}

	model := getModelConfig(req.Model)
	systemPrompt := buildSystemPrompt(req.Mode)

	var rawText string
	var callErr error

	if model.Publisher == "google" {
		rawText, callErr = callGemini(token, projectID, model, systemPrompt, prompt)
	} else {
		rawText, callErr = callAnthropic(token, projectID, model, systemPrompt, prompt)
	}

	if callErr != nil {
		return &AIAnalysis{Error: callErr.Error(), Model: model.Name, DurationMS: time.Since(start).Milliseconds()}
	}

	analysis := parseAIResponseJSON(rawText)
	analysis.DurationMS = time.Since(start).Milliseconds()
	analysis.Model = model.Name

	return analysis
}

// callAnthropic calls Claude models via Vertex AI rawPredict.
func callAnthropic(token, projectID string, model ModelConfig, systemPrompt, prompt string) (string, error) {
	endpoint := fmt.Sprintf(
		"https://%s-aiplatform.googleapis.com/v1/projects/%s/locations/%s/publishers/anthropic/models/%s:rawPredict",
		model.Region, projectID, model.Region, model.VertexID,
	)

	body := map[string]any{
		"anthropic_version": "vertex-2023-10-16",
		"max_tokens":        2048,
		"messages":          []map[string]string{{"role": "user", "content": prompt}},
		"system":            systemPrompt,
	}

	bodyJSON, _ := json.Marshal(body)

	httpReq, err := http.NewRequest("POST", endpoint, bytes.NewReader(bodyJSON))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: 90 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("Vertex AI returned %d: %s", resp.StatusCode, truncateStr(string(respBody), 200))
	}

	var aiResp struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal(respBody, &aiResp); err != nil {
		return "", fmt.Errorf("failed to parse response: %w", err)
	}
	if len(aiResp.Content) == 0 {
		return "", fmt.Errorf("empty response")
	}

	return aiResp.Content[0].Text, nil
}

// callGemini calls Gemini models via Vertex AI generateContent.
func callGemini(token, projectID string, model ModelConfig, systemPrompt, prompt string) (string, error) {
	endpoint := fmt.Sprintf(
		"https://%s-aiplatform.googleapis.com/v1/projects/%s/locations/%s/publishers/google/models/%s:generateContent",
		model.Region, projectID, model.Region, model.VertexID,
	)

	body := map[string]any{
		"contents": []map[string]any{
			{"role": "user", "parts": []map[string]string{{"text": prompt}}},
		},
		"systemInstruction": map[string]any{
			"parts": []map[string]string{{"text": systemPrompt}},
		},
		"generationConfig": map[string]any{
			"maxOutputTokens":  4096,
			"temperature":      0.3,
			"responseMimeType": "application/json",
		},
	}

	bodyJSON, _ := json.Marshal(body)

	httpReq, err := http.NewRequest("POST", endpoint, bytes.NewReader(bodyJSON))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: 90 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("Vertex AI returned %d: %s", resp.StatusCode, truncateStr(string(respBody), 200))
	}

	var aiResp struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal(respBody, &aiResp); err != nil {
		return "", fmt.Errorf("failed to parse response: %w", err)
	}
	if len(aiResp.Candidates) == 0 || len(aiResp.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("empty response")
	}

	return aiResp.Candidates[0].Content.Parts[0].Text, nil
}

func truncateStr(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

func buildSystemPrompt(mode string) string {
	base := `You are a senior site reliability engineer and web performance expert at Pantheon, a WebOps platform for Drupal and WordPress.

Analyze the site check data provided and give actionable, specific insights. Be direct and concise. No filler.

IMPORTANT: Respond with ONLY a valid JSON object. No markdown, no code fences, no extra text. The JSON must match this exact schema:

{
  "summary": "2-3 sentence executive summary",
  "findings": [
    "specific finding 1",
    "specific finding 2"
  ],
  "next_steps": [
    "prioritized action item 1",
    "prioritized action item 2"
  ],
  "risk": "low|medium|high"
}

Rules for the content:
- summary: 2-3 sentences covering the overall health of the site
- findings: 8-12 specific observations, each one sentence. Start critical ones with "CRITICAL:" and warnings with "WARNING:"
- next_steps: 5-10 prioritized action items, each actionable and specific
- risk: one of "low", "medium", or "high"
- Do NOT use markdown formatting in any values. Use plain text only.
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
			parts = append(parts, "Site A:\n"+string(a))
		}
		if req.CompareB != nil {
			b, _ := json.MarshalIndent(summarizeResult(req.CompareB), "", "  ")
			parts = append(parts, "Site B:\n"+string(b))
		}
	case "migration":
		if req.Migration != nil {
			m, _ := json.MarshalIndent(req.Migration, "", "  ")
			parts = append(parts, "Migration Readiness:\n"+string(m))
		}
	default:
		if req.Check != nil {
			c, _ := json.MarshalIndent(summarizeResult(req.Check), "", "  ")
			parts = append(parts, "Site Check:\n"+string(c))
		}
		if req.SEO != nil {
			s, _ := json.MarshalIndent(summarizeSEO(req.SEO), "", "  ")
			parts = append(parts, "SEO Audit:\n"+string(s))
		}
		if req.Lighthouse != nil {
			l, _ := json.MarshalIndent(summarizeLighthouse(req.Lighthouse), "", "  ")
			parts = append(parts, "Lighthouse:\n"+string(l))
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
		keyHeaders := map[string]string{}
		for _, h := range []string{"cache-control", "x-cache", "x-cache-hits", "age", "server", "strict-transport-security", "content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy", "vary", "set-cookie", "x-served-by", "agcdn-info", "x-pantheon-styx-hostname", "x-pantheon-environment", "x-pantheon-site", "x-drupal-cache", "x-drupal-dynamic-cache", "x-generator"} {
			if v, ok := r.HTTP.Headers[h]; ok {
				keyHeaders[h] = v
			}
		}
		summary["key_headers"] = keyHeaders
		if len(r.HTTP.AGCDNHeaders) > 0 {
			summary["agcdn_header_count"] = len(r.HTTP.AGCDNHeaders)
		}
	}
	if r.DNS != nil {
		summary["dns_a"] = r.DNS.A
		summary["dns_cname"] = r.DNS.CNAME
		summary["dns_ns"] = r.DNS.NS
		summary["dns_duration_ms"] = r.DNS.DurationMS
		if r.DNS.CAA != nil {
			summary["dns_caa_count"] = len(r.DNS.CAA)
		}
		if r.DNS.DNSSEC != nil {
			summary["dnssec_enabled"] = r.DNS.DNSSEC.Enabled
		}
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
		// Include header details so AI can give specific advice
		missingHeaders := []string{}
		for _, h := range r.Security.Headers {
			if !h.Present {
				missingHeaders = append(missingHeaders, h.Name)
			}
		}
		if len(missingHeaders) > 0 {
			summary["security_missing_headers"] = missingHeaders
		}
		if len(r.Security.Cookies) > 0 {
			cookieIssues := []string{}
			for _, c := range r.Security.Cookies {
				cookieIssues = append(cookieIssues, c.Issues...)
			}
			if len(cookieIssues) > 0 {
				summary["cookie_issues"] = cookieIssues
			}
		}
	}
	if r.EmailAuth != nil {
		summary["email_auth_grade"] = r.EmailAuth.Grade
		if r.EmailAuth.SPF != nil {
			summary["spf_found"] = r.EmailAuth.SPF.Found
			summary["spf_valid"] = r.EmailAuth.SPF.Valid
		}
		if r.EmailAuth.DMARC != nil {
			summary["dmarc_found"] = r.EmailAuth.DMARC.Found
			summary["dmarc_policy"] = r.EmailAuth.DMARC.Policy
		}
	}
	if r.Pantheon != nil {
		summary["pantheon"] = r.Pantheon
	}
	if r.RedirectChain != nil && len(r.RedirectChain) > 0 {
		summary["redirect_chain_length"] = len(r.RedirectChain)
	}
	if r.Warmup != nil {
		summary["cache_hit_ratio"] = r.Warmup.HitRatio
	}
	summary["insights"] = r.Insights
	return summary
}

// summarizeLighthouse strips base64 images but keeps all metrics and diagnostics.
func summarizeLighthouse(l *LighthouseResult) map[string]any {
	s := map[string]any{
		"performance":    l.Performance,
		"accessibility":  l.Accessibility,
		"best_practices": l.BestPractices,
		"seo":            l.SEO,
		"strategy":       l.Strategy,
	}
	// Core metrics
	if l.FCP != "" { s["fcp"] = l.FCP }
	if l.LCP != "" { s["lcp"] = l.LCP }
	if l.TBT != "" { s["tbt"] = l.TBT }
	if l.CLS != "" { s["cls"] = l.CLS }
	if l.SpeedIndex != "" { s["speed_index"] = l.SpeedIndex }
	if l.TTI != "" { s["tti"] = l.TTI }
	if l.TTFB != "" { s["ttfb"] = l.TTFB }

	// Page stats
	if l.PageWeight > 0 { s["page_weight_bytes"] = l.PageWeight }
	if l.TotalRequests > 0 { s["total_requests"] = l.TotalRequests }
	if l.DOMSize > 0 { s["dom_size"] = l.DOMSize }

	// LCP/CLS elements
	if l.LCPElement != "" { s["lcp_element"] = l.LCPElement }
	if len(l.CLSElements) > 0 { s["cls_elements"] = l.CLSElements }

	// Resource summary (no images, just structured data)
	if len(l.ResourceSummary) > 0 { s["resource_summary"] = l.ResourceSummary }

	// Render blocking
	if len(l.RenderBlocking) > 0 {
		s["render_blocking_count"] = len(l.RenderBlocking)
		totalWasted := 0
		for _, rb := range l.RenderBlocking {
			totalWasted += rb.WastedMS
		}
		s["render_blocking_wasted_ms"] = totalWasted
	}

	// Third party
	if len(l.ThirdPartySummary) > 0 {
		s["third_party_count"] = len(l.ThirdPartySummary)
		s["third_party_blocking_ms"] = l.ThirdPartyBlockingTime
	}

	// Main thread work
	if len(l.MainThreadWork) > 0 { s["main_thread_work"] = l.MainThreadWork }

	// Unused code (just counts and total wasted)
	if len(l.UnusedJS) > 0 {
		totalWasted := int64(0)
		for _, u := range l.UnusedJS {
			totalWasted += u.WastedBytes
		}
		s["unused_js_count"] = len(l.UnusedJS)
		s["unused_js_wasted_bytes"] = totalWasted
	}
	if len(l.UnusedCSS) > 0 {
		totalWasted := int64(0)
		for _, u := range l.UnusedCSS {
			totalWasted += u.WastedBytes
		}
		s["unused_css_count"] = len(l.UnusedCSS)
		s["unused_css_wasted_bytes"] = totalWasted
	}

	// Cache policy issues
	if len(l.CachePolicy) > 0 {
		s["cache_policy_issues"] = len(l.CachePolicy)
	}

	// Quick/Usable/Resilient assessments
	if l.IsQuick != nil { s["is_quick"] = l.IsQuick.Rating }
	if l.IsUsable != nil { s["is_usable"] = l.IsUsable.Rating }
	if l.IsResilient != nil { s["is_resilient"] = l.IsResilient.Rating }

	return s
}

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

// parseAIResponseJSON tries to parse the AI response as JSON.
func parseAIResponseJSON(text string) *AIAnalysis {
	cleaned := strings.TrimSpace(text)

	// Strip markdown code fences (```json ... ``` or ``` ... ```)
	if strings.HasPrefix(cleaned, "```") {
		// Find the end of the first line (```json or ```)
		if idx := strings.Index(cleaned, "\n"); idx != -1 {
			cleaned = cleaned[idx+1:]
		}
		// Strip trailing ```
		if idx := strings.LastIndex(cleaned, "```"); idx != -1 {
			cleaned = cleaned[:idx]
		}
		cleaned = strings.TrimSpace(cleaned)
	}

	// Try direct JSON parse
	var analysis AIAnalysis
	if err := json.Unmarshal([]byte(cleaned), &analysis); err == nil {
		return &analysis
	}

	// Try to find JSON object within the text (Gemini sometimes adds text around it)
	if start := strings.Index(cleaned, "{"); start != -1 {
		if end := strings.LastIndex(cleaned, "}"); end != -1 && end > start {
			jsonStr := cleaned[start : end+1]
			if err := json.Unmarshal([]byte(jsonStr), &analysis); err == nil {
				return &analysis
			}
		}
	}

	// Fall back to text parser
	return parseAIResponse(text)
}

// parseAIResponse is a fallback text-based parser.
func parseAIResponse(text string) *AIAnalysis {
	analysis := &AIAnalysis{}

	lines := strings.Split(text, "\n")
	section := ""
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		normalized := strings.TrimLeft(trimmed, "# ")

		switch {
		case strings.EqualFold(normalized, "SUMMARY") || strings.EqualFold(normalized, "summary"):
			section = "summary"
			continue
		case strings.EqualFold(normalized, "FINDINGS") || strings.EqualFold(normalized, "findings"):
			section = "findings"
			continue
		case strings.EqualFold(normalized, "NEXT STEPS") || strings.EqualFold(normalized, "next steps"):
			section = "nextsteps"
			continue
		case strings.HasPrefix(strings.ToUpper(normalized), "RISK:"):
			risk := strings.TrimSpace(strings.TrimPrefix(strings.ToUpper(normalized), "RISK:"))
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
				analysis.Findings[len(analysis.Findings)-1] += " " + trimmed
			}
		case "nextsteps":
			stripped := trimmed
			if strings.HasPrefix(stripped, "- ") || strings.HasPrefix(stripped, "* ") {
				stripped = strings.TrimLeft(stripped, "-* ")
			} else if len(stripped) > 2 && stripped[0] >= '0' && stripped[0] <= '9' {
				if idx := strings.Index(stripped, "."); idx > 0 && idx < 3 {
					stripped = strings.TrimSpace(stripped[idx+1:])
				}
			}
			if stripped != trimmed {
				analysis.NextSteps = append(analysis.NextSteps, stripped)
			} else if len(analysis.NextSteps) > 0 {
				analysis.NextSteps[len(analysis.NextSteps)-1] += " " + trimmed
			}
		}
	}

	if analysis.Summary == "" && len(analysis.Findings) == 0 {
		analysis.Summary = text
	}

	return analysis
}

// getAccessToken retrieves an access token from the GCP metadata server.
func getAccessToken() (string, error) {
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
