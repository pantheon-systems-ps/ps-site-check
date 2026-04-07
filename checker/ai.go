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
		{ID: "claude-sonnet-4-5", Name: "Claude Sonnet 4.5", Publisher: "anthropic", Region: "us-east5", VertexID: "claude-sonnet-4-5-20241022", CostPer: "~$0.024"},
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
			"maxOutputTokens": 2048,
			"temperature":     0.3,
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
			l, _ := json.MarshalIndent(req.Lighthouse, "", "  ")
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
	if strings.HasPrefix(cleaned, "```json") {
		cleaned = strings.TrimPrefix(cleaned, "```json")
		cleaned = strings.TrimSuffix(cleaned, "```")
		cleaned = strings.TrimSpace(cleaned)
	} else if strings.HasPrefix(cleaned, "```") {
		cleaned = strings.TrimPrefix(cleaned, "```")
		cleaned = strings.TrimSuffix(cleaned, "```")
		cleaned = strings.TrimSpace(cleaned)
	}

	var analysis AIAnalysis
	if err := json.Unmarshal([]byte(cleaned), &analysis); err == nil {
		return &analysis
	}

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
