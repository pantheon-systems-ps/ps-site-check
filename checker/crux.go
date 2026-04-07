package checker

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// cruxMetricMap maps CrUX API metric names to our field names.
var cruxMetricMap = map[string]string{
	"largest_contentful_paint":    "LCP",
	"interaction_to_next_paint":   "INP",
	"cumulative_layout_shift":     "CLS",
	"first_contentful_paint":      "FCP",
	"experimental_time_to_first_byte": "TTFB",
}

// cruxThreshold defines good/poor boundaries for a Web Vital metric.
type cruxThreshold struct {
	Good float64
	Poor float64
	Unit string
}

var cruxThresholds = map[string]cruxThreshold{
	"LCP":  {Good: 2500, Poor: 4000, Unit: "ms"},
	"INP":  {Good: 200, Poor: 500, Unit: "ms"},
	"CLS":  {Good: 0.1, Poor: 0.25, Unit: "unitless"},
	"FCP":  {Good: 1800, Poor: 3000, Unit: "ms"},
	"TTFB": {Good: 800, Poor: 1800, Unit: "ms"},
}

// FetchCrUX queries the Chrome UX Report API for real-user metrics on the given origin.
func FetchCrUX(origin, apiKey string) *CrUXData {
	if apiKey == "" {
		return &CrUXData{Origin: origin, Error: "CRUX_API_KEY not configured"}
	}

	url := fmt.Sprintf("https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=%s", apiKey)

	body, err := json.Marshal(map[string]string{"origin": origin})
	if err != nil {
		return &CrUXData{Origin: origin, Error: "failed to marshal request: " + err.Error()}
	}

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return &CrUXData{Origin: origin, Error: "CrUX API request failed: " + err.Error()}
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return &CrUXData{Origin: origin, Error: "failed to read CrUX response: " + err.Error()}
	}

	if resp.StatusCode == 404 {
		return &CrUXData{Origin: origin, Error: "no CrUX data available for this origin"}
	}
	if resp.StatusCode != 200 {
		return &CrUXData{Origin: origin, Error: fmt.Sprintf("CrUX API returned HTTP %d: %s", resp.StatusCode, string(respBody))}
	}

	// Parse the CrUX API response.
	var raw struct {
		Record struct {
			Key struct {
				Origin     string `json:"origin"`
				FormFactor string `json:"formFactor"`
			} `json:"key"`
			Metrics map[string]struct {
				Histogram []struct {
					Start   float64 `json:"start"`
					End     float64 `json:"end"`
					Density float64 `json:"density"`
				} `json:"histogram"`
				Percentiles struct {
					P75 json.Number `json:"p75"`
				} `json:"percentiles"`
			} `json:"metrics"`
		} `json:"record"`
	}

	if err := json.Unmarshal(respBody, &raw); err != nil {
		return &CrUXData{Origin: origin, Error: "failed to parse CrUX response: " + err.Error()}
	}

	result := &CrUXData{
		Origin:     raw.Record.Key.Origin,
		FormFactor: raw.Record.Key.FormFactor,
	}

	for apiName, fieldName := range cruxMetricMap {
		metric, ok := raw.Record.Metrics[apiName]
		if !ok {
			continue
		}

		p75, err := metric.Percentiles.P75.Float64()
		if err != nil {
			continue
		}

		thresh := cruxThresholds[fieldName]

		wv := &WebVitalMetric{
			P75:  p75,
			Unit: thresh.Unit,
		}

		// Determine rating from p75 value.
		switch {
		case p75 <= thresh.Good:
			wv.Rating = "good"
		case p75 > thresh.Poor:
			wv.Rating = "poor"
		default:
			wv.Rating = "needs-improvement"
		}

		// Extract histogram bucket densities.
		// CrUX returns 3 buckets: good (0..good), needs-improvement (good..poor), poor (poor..).
		if len(metric.Histogram) >= 3 {
			wv.Good = metric.Histogram[0].Density
			wv.NI = metric.Histogram[1].Density
			wv.Poor = metric.Histogram[2].Density
		}

		switch fieldName {
		case "LCP":
			result.LCP = wv
		case "INP":
			result.INP = wv
		case "CLS":
			result.CLS = wv
		case "FCP":
			result.FCP = wv
		case "TTFB":
			result.TTFB = wv
		}
	}

	return result
}
