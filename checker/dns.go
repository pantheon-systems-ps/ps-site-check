package checker

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"sync"
	"time"
)

// checkDNS resolves A, AAAA, and CNAME records for the hostname.
func checkDNS(hostname string) *DNSResult {
	start := time.Now()
	resolver := net.DefaultResolver
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	result := &DNSResult{}

	// Resolve A records
	ips, err := resolver.LookupIPAddr(ctx, hostname)
	if err == nil {
		for _, ip := range ips {
			if ip.IP.To4() != nil {
				result.A = append(result.A, ip.IP.String())
			} else {
				result.AAAA = append(result.AAAA, ip.IP.String())
			}
		}
	}

	// Resolve CNAME
	cname, err := resolver.LookupCNAME(ctx, hostname)
	if err == nil && cname != hostname+"." {
		result.CNAME = append(result.CNAME, cname)
	}

	// Resolve MX records
	mxRecords, err := resolver.LookupMX(ctx, hostname)
	if err == nil {
		for _, mx := range mxRecords {
			result.MX = append(result.MX, MXRecord{
				Host:     mx.Host,
				Priority: mx.Pref,
			})
		}
	}

	// Resolve NS records
	nsRecords, err := resolver.LookupNS(ctx, hostname)
	if err == nil {
		for _, ns := range nsRecords {
			result.NS = append(result.NS, ns.Host)
		}
	}

	// Resolve TXT records
	txtRecords, err := resolver.LookupTXT(ctx, hostname)
	if err == nil {
		result.TXT = txtRecords
	}

	// Lookup CAA records via Google DoH
	result.CAA = lookupCAA(hostname)

	// Check DNSSEC status via Google DoH
	result.DNSSEC = checkDNSSEC(hostname)

	// Ensure non-nil slices for clean JSON
	if result.A == nil {
		result.A = []string{}
	}
	if result.AAAA == nil {
		result.AAAA = []string{}
	}
	if result.CNAME == nil {
		result.CNAME = []string{}
	}

	result.DurationMS = time.Since(start).Milliseconds()
	return result
}

// dnsResolvers defines well-known public DNS resolvers for multi-path comparison.
var dnsResolvers = []struct {
	addr  string
	label string
}{
	{"8.8.8.8:53", "Google DNS"},
	{"1.1.1.1:53", "Cloudflare DNS"},
	{"9.9.9.9:53", "Quad9 DNS"},
	{"208.67.222.222:53", "OpenDNS"},
	{"4.2.2.1:53", "Level3 DNS"},
	{"8.26.56.26:53", "Comodo Secure DNS"},
	{"94.140.14.14:53", "AdGuard DNS"},
}

// checkDNSMultiPath resolves through multiple DNS servers to compare results.
func checkDNSMultiPath(hostname string) []DNSPathResult {
	results := make([]DNSPathResult, len(dnsResolvers))

	var wg sync.WaitGroup
	for i, r := range dnsResolvers {
		wg.Add(1)
		go func(idx int, addr, label string) {
			defer wg.Done()
			results[idx] = resolveVia(hostname, addr, label)
		}(i, r.addr, r.label)
	}
	wg.Wait()

	return results
}

// resolveVia resolves a hostname using a specific DNS server.
func resolveVia(hostname, dnsAddr, label string) DNSPathResult {
	start := time.Now()
	result := DNSPathResult{
		Resolver: dnsAddr,
		Label:    label,
		A:        []string{},
		AAAA:     []string{},
	}

	resolver := &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
			d := net.Dialer{Timeout: 3 * time.Second}
			return d.DialContext(ctx, "udp", dnsAddr)
		},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	ips, err := resolver.LookupIPAddr(ctx, hostname)
	if err != nil {
		result.Error = err.Error()
		result.DurationMS = time.Since(start).Milliseconds()
		return result
	}

	for _, ip := range ips {
		if ip.IP.To4() != nil {
			result.A = append(result.A, ip.IP.String())
		} else {
			result.AAAA = append(result.AAAA, ip.IP.String())
		}
	}

	result.DurationMS = time.Since(start).Milliseconds()
	return result
}

// ── Google DoH response types ─────────────────────────────────

// dohResponse represents the JSON response from Google's DNS-over-HTTPS API.
type dohResponse struct {
	Status int  `json:"Status"`
	AD     bool `json:"AD"` // Authenticated Data (DNSSEC validated)
	Answer []struct {
		Name string `json:"name"`
		Type int    `json:"type"`
		Data string `json:"data"`
	} `json:"Answer"`
}

// dohQuery calls Google's DNS-over-HTTPS API and returns the parsed response.
func dohQuery(domain string, qtype string, dnssecOK bool) (*dohResponse, error) {
	url := fmt.Sprintf("https://dns.google/resolve?name=%s&type=%s", domain, qtype)
	if dnssecOK {
		url += "&do=true"
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("DoH request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("DoH read body: %w", err)
	}

	var doh dohResponse
	if err := json.Unmarshal(body, &doh); err != nil {
		return nil, fmt.Errorf("DoH parse JSON: %w", err)
	}
	return &doh, nil
}

// ── CAA lookup ────────────────────────────────────────────────

// lookupCAA queries CAA records for the domain via Google's DoH API.
// DNS type 257 = CAA.
func lookupCAA(domain string) []CAARecord {
	doh, err := dohQuery(domain, "CAA", false)
	if err != nil || doh.Status != 0 {
		return nil
	}

	var records []CAARecord
	for _, ans := range doh.Answer {
		if ans.Type != 257 { // 257 = CAA
			continue
		}
		rec := parseCAAData(ans.Data)
		if rec != nil {
			records = append(records, *rec)
		}
	}
	return records
}

// parseCAAData parses a CAA record data string from the DoH response.
// Google DoH returns CAA data as: <flag> <tag> "<value>"
// Example: "0 issue \"letsencrypt.org\""
func parseCAAData(data string) *CAARecord {
	var flag uint8
	var tag, value string

	// Try parsing the Google DoH format: 0 issue "letsencrypt.org"
	n, err := fmt.Sscanf(data, "%d %s", &flag, &tag)
	if err != nil || n < 2 {
		return nil
	}

	// Extract the quoted value after the tag
	// Find the first quote
	start := -1
	end := -1
	for i, c := range data {
		if c == '"' {
			if start == -1 {
				start = i + 1
			} else {
				end = i
				break
			}
		}
	}
	if start != -1 && end != -1 && end > start {
		value = data[start:end]
	} else {
		// Fall back: take everything after the tag
		afterTag := len(fmt.Sprintf("%d %s ", flag, tag))
		if afterTag < len(data) {
			value = data[afterTag:]
		}
	}

	return &CAARecord{
		Flag:  flag,
		Tag:   tag,
		Value: value,
	}
}

// ── DNSSEC check ──────────────────────────────────────────────

// checkDNSSEC checks DNSSEC validation status via Google's DoH API.
// It queries with the DO (DNSSEC OK) flag and checks the AD (Authenticated Data) bit,
// then queries for DNSKEY records to count signing keys.
func checkDNSSEC(domain string) *DNSSECInfo {
	info := &DNSSECInfo{}

	// Query A record with DNSSEC OK flag to check the AD bit
	doh, err := dohQuery(domain, "A", true)
	if err != nil {
		info.Error = err.Error()
		return info
	}

	// The AD flag indicates the response was DNSSEC-validated
	info.Enabled = doh.AD
	info.Valid = doh.AD

	// Query DNSKEY records to count signing keys
	dohKey, err := dohQuery(domain, "DNSKEY", true)
	if err == nil && dohKey.Status == 0 {
		keyCount := 0
		for _, ans := range dohKey.Answer {
			if ans.Type == 48 { // 48 = DNSKEY
				keyCount++
			}
		}
		info.KeyCount = keyCount
		// If we found DNSKEY records, DNSSEC is at least enabled even if
		// the resolver didn't set AD (e.g. partial chain)
		if keyCount > 0 {
			info.Enabled = true
		}
	}

	return info
}
