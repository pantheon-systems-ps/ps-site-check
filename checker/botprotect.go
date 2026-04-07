package checker

import (
	"crypto/tls"
	"io"
	"net/http"
	"strings"
	"time"
)

// DetectBotProtection probes a domain for PoW / Obolus bot mitigation.
func DetectBotProtection(domain string) *BotProtection {
	start := time.Now()
	domain = strings.TrimSpace(domain)

	bp := &BotProtection{
		Domain: domain,
	}

	origin := "https://" + domain

	// Use a minimal client that does NOT execute JavaScript (like a bot would)
	client := &http.Client{
		Timeout: 10 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12},
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return http.ErrUseLastResponse
			}
			return nil
		},
	}

	// 1. Check /obolus-challenge endpoint (Obolus system)
	bp.ChallengeEndpoint = probeObolusEndpoint(client, origin)

	// 2. Check main page for PoW challenge indicators
	bp.ChallengePage = probeChallengePage(client, origin)

	// 3. Check for PoW/Obolus cookie requirements
	bp.CookieRequired = probeCookieRequirement(client, origin)

	// Determine overall detection
	if bp.ChallengeEndpoint.Detected {
		bp.Detected = true
		bp.Type = "obolus"
	} else if bp.ChallengePage.Detected {
		bp.Detected = true
		if strings.Contains(strings.ToLower(bp.ChallengePage.Detail), "obolus") {
			bp.Type = "obolus"
		} else {
			bp.Type = "pow-interstitial"
		}
	} else if bp.CookieRequired.Detected {
		bp.Detected = true
		bp.Type = "pow-interstitial"
	}

	bp.DurationMS = time.Since(start).Milliseconds()
	return bp
}

// probeObolusEndpoint checks if /obolus-challenge returns the PoW JavaScript.
func probeObolusEndpoint(client *http.Client, origin string) *BotProbeResult {
	result := &BotProbeResult{}

	req, err := http.NewRequest("GET", origin+"/obolus-challenge", nil)
	if err != nil {
		return result
	}
	req.Header.Set("User-Agent", "ps-site-check/1.0 (bot-probe)")

	resp, err := client.Do(req)
	if err != nil {
		return result
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 128*1024))
	bodyStr := string(body)

	// Obolus serves JavaScript via synthetic response
	ct := resp.Header.Get("Content-Type")
	if resp.StatusCode == 200 && strings.Contains(ct, "javascript") {
		result.Detected = true
		result.Detail = "Obolus challenge endpoint active (serves JavaScript PoW solver)"
		return result
	}

	// Check body for Obolus indicators even if content-type doesn't match
	lowerBody := strings.ToLower(bodyStr)
	if strings.Contains(lowerBody, "obolus") ||
		strings.Contains(lowerBody, "x_obolus_proof") ||
		strings.Contains(lowerBody, "sha-256") && strings.Contains(lowerBody, "proof") {
		result.Detected = true
		result.Detail = "Obolus challenge endpoint detected (contains PoW references)"
		return result
	}

	return result
}

// probeChallengePage checks if the main page returns a PoW challenge instead of content.
func probeChallengePage(client *http.Client, origin string) *BotProbeResult {
	result := &BotProbeResult{}

	// Request without any cookies — bots wouldn't have the proof cookie
	req, err := http.NewRequest("GET", origin, nil)
	if err != nil {
		return result
	}
	// Use a generic bot-like UA to potentially trigger the challenge
	req.Header.Set("User-Agent", "ps-site-check/1.0 (bot-probe)")

	resp, err := client.Do(req)
	if err != nil {
		return result
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 128*1024))
	bodyStr := string(body)
	lowerBody := strings.ToLower(bodyStr)

	// Check for PoW interstitial page indicators
	powIndicators := []string{
		"pow_solution",
		"proof-of-work",
		"proof of work",
		"x_obolus_proof",
		"x_obolus_grace",
		"obolus-challenge",
		"verification required",
		"sha-256",
	}

	for _, indicator := range powIndicators {
		if strings.Contains(lowerBody, indicator) {
			result.Detected = true
			result.Detail = "Challenge page detected: contains '" + indicator + "'"
			return result
		}
	}

	// Check for Fastly synthetic error responses used by PoW (error 778, 779, 601)
	// These manifest as specific status codes or via x-cache headers
	if resp.StatusCode == 403 || resp.StatusCode == 503 {
		if strings.Contains(lowerBody, "challenge") ||
			strings.Contains(lowerBody, "nonce") ||
			strings.Contains(lowerBody, "mining") {
			result.Detected = true
			result.Detail = "Challenge page detected: HTTP " + resp.Status + " with PoW challenge content"
			return result
		}
	}

	return result
}

// probeCookieRequirement checks response headers for PoW cookie indicators.
func probeCookieRequirement(client *http.Client, origin string) *BotProbeResult {
	result := &BotProbeResult{}

	req, err := http.NewRequest("GET", origin, nil)
	if err != nil {
		return result
	}
	req.Header.Set("User-Agent", "ps-site-check/1.0 (bot-probe)")

	resp, err := client.Do(req)
	if err != nil {
		return result
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)

	// Check Set-Cookie headers for PoW-related cookies
	cookies := resp.Header.Values("Set-Cookie")
	for _, cookie := range cookies {
		lower := strings.ToLower(cookie)
		if strings.Contains(lower, "pow_solution") {
			result.Detected = true
			result.Detail = "PoW solution cookie set in response"
			return result
		}
		if strings.Contains(lower, "x_obolus_proof") {
			result.Detected = true
			result.Detail = "Obolus proof cookie set in response"
			return result
		}
		if strings.Contains(lower, "x_obolus_grace") {
			result.Detected = true
			result.Detail = "Obolus grace cookie set in response"
			return result
		}
	}

	return result
}
