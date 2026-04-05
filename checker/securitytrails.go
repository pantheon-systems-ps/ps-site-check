package checker

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const stBaseURL = "https://api.securitytrails.com/v1"

// --- DNS History ---

// DNSHistoryResult is the response from the DNS history endpoint.
type DNSHistoryResult struct {
	Domain     string           `json:"domain"`
	Type       string           `json:"type"`
	Records    []DNSHistoryRecord `json:"records"`
	Pages      int              `json:"pages"`
	DurationMS int64            `json:"duration_ms"`
	Error      string           `json:"error,omitempty"`
}

// DNSHistoryRecord is one historical DNS record entry.
type DNSHistoryRecord struct {
	FirstSeen     string               `json:"first_seen"`
	LastSeen      string               `json:"last_seen"`
	Organizations []string             `json:"organizations"`
	Type          string               `json:"type"`
	Values        []DNSHistoryValue    `json:"values"`
}

// DNSHistoryValue holds the IP or hostname for a history record.
type DNSHistoryValue struct {
	IP       string `json:"ip,omitempty"`
	IPv6     string `json:"ipv6,omitempty"`
	Hostname string `json:"hostname,omitempty"`
	Name     string `json:"name,omitempty"`
}

// stDNSHistoryResponse maps the raw SecurityTrails API response.
type stDNSHistoryResponse struct {
	Type    string `json:"type"`
	Pages   int    `json:"pages"`
	Records []struct {
		FirstSeen     string   `json:"first_seen"`
		LastSeen      string   `json:"last_seen"`
		Organizations []string `json:"organizations"`
		Type          string   `json:"type"`
		Values        []struct {
			IP       string `json:"ip"`
			IPv6     string `json:"ipv6"`
			Hostname string `json:"hostname"`
			Name     string `json:"name"`
		} `json:"values"`
	} `json:"records"`
}

// LookupDNSHistory queries SecurityTrails for historical DNS records.
// recordType should be one of: a, aaaa, mx, ns, soa, txt.
func LookupDNSHistory(domain, recordType, apiKey string) *DNSHistoryResult {
	start := time.Now()
	domain = cleanDomain(domain)

	if recordType == "" {
		recordType = "a"
	}
	recordType = strings.ToLower(recordType)

	valid := map[string]bool{"a": true, "aaaa": true, "mx": true, "ns": true, "soa": true, "txt": true}
	if !valid[recordType] {
		return &DNSHistoryResult{
			Domain: domain,
			Type:   recordType,
			Error:  "invalid record type: must be a, aaaa, mx, ns, soa, or txt",
		}
	}

	url := fmt.Sprintf("%s/history/%s/dns/%s", stBaseURL, domain, recordType)
	body, err := stRequest(url, apiKey)
	if err != nil {
		return &DNSHistoryResult{
			Domain:     domain,
			Type:       recordType,
			DurationMS: time.Since(start).Milliseconds(),
			Error:      err.Error(),
		}
	}

	var raw stDNSHistoryResponse
	if err := json.Unmarshal(body, &raw); err != nil {
		return &DNSHistoryResult{
			Domain:     domain,
			Type:       recordType,
			DurationMS: time.Since(start).Milliseconds(),
			Error:      "failed to parse response",
		}
	}

	records := make([]DNSHistoryRecord, 0, len(raw.Records))
	for _, r := range raw.Records {
		rec := DNSHistoryRecord{
			FirstSeen:     r.FirstSeen,
			LastSeen:      r.LastSeen,
			Organizations: r.Organizations,
			Type:          r.Type,
		}
		for _, v := range r.Values {
			rec.Values = append(rec.Values, DNSHistoryValue{
				IP:       v.IP,
				IPv6:     v.IPv6,
				Hostname: v.Hostname,
				Name:     v.Name,
			})
		}
		if rec.Values == nil {
			rec.Values = []DNSHistoryValue{}
		}
		records = append(records, rec)
	}

	return &DNSHistoryResult{
		Domain:     domain,
		Type:       raw.Type,
		Records:    records,
		Pages:      raw.Pages,
		DurationMS: time.Since(start).Milliseconds(),
	}
}

// --- WHOIS History ---

// WHOISResult is the response from the WHOIS history endpoint.
type WHOISResult struct {
	Domain     string       `json:"domain"`
	Records    []WHOISRecord `json:"records"`
	Count      int          `json:"count"`
	DurationMS int64        `json:"duration_ms"`
	Error      string       `json:"error,omitempty"`
}

// WHOISRecord is one historical WHOIS snapshot.
type WHOISRecord struct {
	CreatedDate  string         `json:"created_date,omitempty"`
	UpdatedDate  string         `json:"updated_date,omitempty"`
	ExpiresDate  string         `json:"expires_date,omitempty"`
	Registrar    string         `json:"registrar"`
	NameServers  []string       `json:"name_servers"`
	Status       []string       `json:"status"`
	Contacts     []WHOISContact `json:"contacts"`
	StartedDate  string         `json:"started,omitempty"`
	EndedDate    string         `json:"ended,omitempty"`
}

// WHOISContact is a contact entry from WHOIS.
type WHOISContact struct {
	Type         string `json:"type"`
	Organization string `json:"organization,omitempty"`
	Country      string `json:"country,omitempty"`
	State        string `json:"state,omitempty"`
	Name         string `json:"name,omitempty"`
}

// stWHOISResponse maps the raw SecurityTrails WHOIS API response.
type stWHOISResponse struct {
	Result struct {
		Count int `json:"count"`
		Items []struct {
			CreatedDate int64  `json:"createdDate"`
			UpdatedDate int64  `json:"updatedDate"`
			ExpiresDate int64  `json:"expiresDate"`
			Registrar   string `json:"registrarName"`
			NameServers []string `json:"nameServers"`
			Status      []string `json:"status"`
			Started     int64  `json:"started"`
			Ended       int64  `json:"ended"`
			Contact     []struct {
				Type         string `json:"type"`
				Organization string `json:"organization"`
				Country      string `json:"country"`
				State        string `json:"state"`
				Name         string `json:"name"`
			} `json:"contact"`
		} `json:"items"`
	} `json:"result"`
}

// LookupWHOIS queries SecurityTrails for WHOIS history.
func LookupWHOIS(domain, apiKey string) *WHOISResult {
	start := time.Now()
	domain = cleanDomain(domain)

	url := fmt.Sprintf("%s/history/%s/whois", stBaseURL, domain)
	body, err := stRequest(url, apiKey)
	if err != nil {
		return &WHOISResult{
			Domain:     domain,
			DurationMS: time.Since(start).Milliseconds(),
			Error:      err.Error(),
		}
	}

	var raw stWHOISResponse
	if err := json.Unmarshal(body, &raw); err != nil {
		return &WHOISResult{
			Domain:     domain,
			DurationMS: time.Since(start).Milliseconds(),
			Error:      "failed to parse response",
		}
	}

	records := make([]WHOISRecord, 0, len(raw.Result.Items))
	for _, item := range raw.Result.Items {
		rec := WHOISRecord{
			Registrar:   item.Registrar,
			NameServers: item.NameServers,
			Status:      item.Status,
		}
		if item.CreatedDate > 0 {
			rec.CreatedDate = msToDate(item.CreatedDate)
		}
		if item.UpdatedDate > 0 {
			rec.UpdatedDate = msToDate(item.UpdatedDate)
		}
		if item.ExpiresDate > 0 {
			rec.ExpiresDate = msToDate(item.ExpiresDate)
		}
		if item.Started > 0 {
			rec.StartedDate = msToDate(item.Started)
		}
		if item.Ended > 0 {
			rec.EndedDate = msToDate(item.Ended)
		}
		for _, c := range item.Contact {
			// Filter out fully redacted contacts
			if c.Organization == "REDACTED FOR PRIVACY" && c.Name == "REDACTED FOR PRIVACY" {
				rec.Contacts = append(rec.Contacts, WHOISContact{
					Type: c.Type,
				})
				continue
			}
			rec.Contacts = append(rec.Contacts, WHOISContact{
				Type:         c.Type,
				Organization: filterRedacted(c.Organization),
				Country:      filterRedacted(c.Country),
				State:        filterRedacted(c.State),
				Name:         filterRedacted(c.Name),
			})
		}
		if rec.NameServers == nil {
			rec.NameServers = []string{}
		}
		if rec.Status == nil {
			rec.Status = []string{}
		}
		if rec.Contacts == nil {
			rec.Contacts = []WHOISContact{}
		}
		records = append(records, rec)
	}

	return &WHOISResult{
		Domain:     domain,
		Records:    records,
		Count:      raw.Result.Count,
		DurationMS: time.Since(start).Milliseconds(),
	}
}

// --- SecurityTrails Subdomains ---

// STSubdomainResult contains subdomains from SecurityTrails.
type STSubdomainResult struct {
	Domain         string   `json:"domain"`
	Subdomains     []string `json:"subdomains"`
	SubdomainCount int      `json:"subdomain_count"`
	Source         string   `json:"source"`
	DurationMS     int64    `json:"duration_ms"`
	Error          string   `json:"error,omitempty"`
}

// stSubdomainResponse maps the raw SecurityTrails subdomains response.
type stSubdomainResponse struct {
	SubdomainCount int      `json:"subdomain_count"`
	Subdomains     []string `json:"subdomains"`
	Meta           struct {
		LimitReached bool `json:"limit_reached"`
	} `json:"meta"`
}

// LookupSubdomainsST queries SecurityTrails for subdomains.
func LookupSubdomainsST(domain, apiKey string) *STSubdomainResult {
	start := time.Now()
	domain = cleanDomain(domain)

	url := fmt.Sprintf("%s/domain/%s/subdomains", stBaseURL, domain)
	body, err := stRequest(url, apiKey)
	if err != nil {
		return &STSubdomainResult{
			Domain:     domain,
			Source:     "SecurityTrails",
			DurationMS: time.Since(start).Milliseconds(),
			Error:      err.Error(),
		}
	}

	var raw stSubdomainResponse
	if err := json.Unmarshal(body, &raw); err != nil {
		return &STSubdomainResult{
			Domain:     domain,
			Source:     "SecurityTrails",
			DurationMS: time.Since(start).Milliseconds(),
			Error:      "failed to parse response",
		}
	}

	// Build full subdomain FQDNs
	subdomains := make([]string, 0, len(raw.Subdomains))
	for _, sub := range raw.Subdomains {
		subdomains = append(subdomains, sub+"."+domain)
	}

	return &STSubdomainResult{
		Domain:         domain,
		Subdomains:     subdomains,
		SubdomainCount: raw.SubdomainCount,
		Source:         "SecurityTrails",
		DurationMS:     time.Since(start).Milliseconds(),
	}
}

// --- Domain Details ---

// DomainDetailsResult contains current domain information from SecurityTrails.
type DomainDetailsResult struct {
	Domain     string              `json:"domain"`
	AlexaRank  *int                `json:"alexa_rank,omitempty"`
	CurrentDNS map[string]DNSGroup `json:"current_dns"`
	DurationMS int64               `json:"duration_ms"`
	Error      string              `json:"error,omitempty"`
}

// DNSGroup is a set of DNS values for one record type.
type DNSGroup struct {
	FirstSeen string          `json:"first_seen"`
	Values    []DNSGroupValue `json:"values"`
}

// DNSGroupValue holds one DNS value entry.
type DNSGroupValue struct {
	IP           string `json:"ip,omitempty"`
	IPv6         string `json:"ipv6,omitempty"`
	Nameserver   string `json:"nameserver,omitempty"`
	Hostname     string `json:"hostname,omitempty"`
	Value        string `json:"value,omitempty"`
	Organization string `json:"organization,omitempty"`
	Priority     *int   `json:"priority,omitempty"`
}

// stDomainResponse maps the raw SecurityTrails domain details response.
type stDomainResponse struct {
	AlexaRank  *int   `json:"alexa_rank"`
	ApexDomain string `json:"apex_domain"`
	CurrentDNS map[string]struct {
		FirstSeen string `json:"first_seen"`
		Values    []struct {
			IP                   string `json:"ip"`
			IPv6                 string `json:"ipv6"`
			Nameserver           string `json:"nameserver"`
			Hostname             string `json:"hostname"`
			Value                string `json:"value"`
			IPOrganization       string `json:"ip_organization"`
			IPv6Organization     string `json:"ipv6_organization"`
			NameserverOrg        string `json:"nameserver_organization"`
			HostnameOrganization string `json:"hostname_organization"`
			Priority             *int   `json:"priority"`
		} `json:"values"`
	} `json:"current_dns"`
}

// LookupDomainDetails queries SecurityTrails for current domain information.
func LookupDomainDetails(domain, apiKey string) *DomainDetailsResult {
	start := time.Now()
	domain = cleanDomain(domain)

	url := fmt.Sprintf("%s/domain/%s", stBaseURL, domain)
	body, err := stRequest(url, apiKey)
	if err != nil {
		return &DomainDetailsResult{
			Domain:     domain,
			DurationMS: time.Since(start).Milliseconds(),
			Error:      err.Error(),
		}
	}

	var raw stDomainResponse
	if err := json.Unmarshal(body, &raw); err != nil {
		return &DomainDetailsResult{
			Domain:     domain,
			DurationMS: time.Since(start).Milliseconds(),
			Error:      "failed to parse response",
		}
	}

	currentDNS := make(map[string]DNSGroup)
	for recordType, group := range raw.CurrentDNS {
		g := DNSGroup{FirstSeen: group.FirstSeen}
		for _, v := range group.Values {
			org := v.IPOrganization
			if org == "" {
				org = v.IPv6Organization
			}
			if org == "" {
				org = v.NameserverOrg
			}
			if org == "" {
				org = v.HostnameOrganization
			}
			g.Values = append(g.Values, DNSGroupValue{
				IP:           v.IP,
				IPv6:         v.IPv6,
				Nameserver:   v.Nameserver,
				Hostname:     v.Hostname,
				Value:        v.Value,
				Organization: org,
				Priority:     v.Priority,
			})
		}
		if g.Values == nil {
			g.Values = []DNSGroupValue{}
		}
		currentDNS[recordType] = g
	}

	return &DomainDetailsResult{
		Domain:     domain,
		AlexaRank:  raw.AlexaRank,
		CurrentDNS: currentDNS,
		DurationMS: time.Since(start).Milliseconds(),
	}
}

// --- Helpers ---

// stRequest makes an authenticated GET request to the SecurityTrails API.
func stRequest(url, apiKey string) ([]byte, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("APIKEY", apiKey)
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 5<<20))
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode == 429 {
		return nil, fmt.Errorf("SecurityTrails rate limit exceeded")
	}
	if resp.StatusCode == 403 {
		return nil, fmt.Errorf("SecurityTrails API key is invalid or lacks permissions")
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("SecurityTrails returned HTTP %d", resp.StatusCode)
	}

	return body, nil
}

// cleanDomain strips scheme, path, and port from a domain string.
func cleanDomain(domain string) string {
	domain = strings.TrimSpace(strings.ToLower(domain))
	domain = strings.TrimPrefix(domain, "https://")
	domain = strings.TrimPrefix(domain, "http://")
	domain = strings.TrimRight(domain, "/")
	if idx := strings.Index(domain, "/"); idx != -1 {
		domain = domain[:idx]
	}
	if idx := strings.Index(domain, ":"); idx != -1 {
		domain = domain[:idx]
	}
	return domain
}

// msToDate converts a Unix timestamp in milliseconds to a date string.
func msToDate(ms int64) string {
	return time.Unix(ms/1000, 0).UTC().Format("2006-01-02")
}

// filterRedacted returns empty string for WHOIS privacy-redacted values.
func filterRedacted(s string) string {
	if strings.Contains(strings.ToUpper(s), "REDACTED FOR PRIVACY") {
		return ""
	}
	return s
}
