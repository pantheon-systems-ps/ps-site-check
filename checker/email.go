package checker

import (
	"context"
	"net"
	"strconv"
	"strings"
	"time"
)

// AuditEmailAuth analyzes DNS TXT records for email authentication (SPF, DKIM, DMARC).
// The txtRecords parameter should contain the TXT records already fetched for the domain.
// A separate DNS lookup is performed for the _dmarc subdomain.
func AuditEmailAuth(domain string, txtRecords []string) *EmailAuthResult {
	result := &EmailAuthResult{
		SPF:   analyzeSPF(txtRecords),
		DKIM:  analyzeDKIM(),
		DMARC: analyzeDMARC(domain),
	}
	result.Grade = gradeEmailAuth(result)
	return result
}

// analyzeSPF inspects the provided TXT records for a valid SPF record.
func analyzeSPF(txtRecords []string) *SPFResult {
	result := &SPFResult{}

	var spfRecords []string
	for _, txt := range txtRecords {
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(txt)), "v=spf1") {
			spfRecords = append(spfRecords, txt)
		}
	}

	if len(spfRecords) == 0 {
		result.Found = false
		result.Issues = []string{"No SPF record found"}
		return result
	}

	result.Found = true

	if len(spfRecords) > 1 {
		result.Issues = append(result.Issues, "Multiple SPF records found; RFC 7208 requires exactly one")
	}

	// Analyze the first SPF record.
	record := spfRecords[0]
	result.Record = record
	result.Valid = true

	lower := strings.ToLower(record)
	mechanisms := strings.Fields(lower)

	// Count DNS-lookup-causing mechanisms.
	lookups := 0
	hasAll := false
	for _, m := range mechanisms {
		if m == "v=spf1" {
			continue
		}

		// The "all" mechanism and its qualifiers.
		bare := strings.TrimLeft(m, "+-~?")
		if bare == "all" {
			hasAll = true
			if m == "+all" || m == "all" {
				result.Issues = append(result.Issues, "Using \"+all\" or bare \"all\" allows any server to send mail as this domain")
				result.Valid = false
			}
			continue
		}

		// Count mechanisms that cause DNS lookups per RFC 7208 Section 4.6.4:
		// include, a, mx, ptr, exists, and redirect modifier.
		switch {
		case strings.HasPrefix(m, "include:"):
			lookups++
		case bare == "a" || strings.HasPrefix(bare, "a:") || strings.HasPrefix(bare, "a/"):
			lookups++
		case bare == "mx" || strings.HasPrefix(bare, "mx:") || strings.HasPrefix(bare, "mx/"):
			lookups++
		case bare == "ptr" || strings.HasPrefix(bare, "ptr:"):
			lookups++
			result.Issues = append(result.Issues, "Using deprecated \"ptr\" mechanism (RFC 7208 Section 5.5)")
		case strings.HasPrefix(m, "exists:"):
			lookups++
		case strings.HasPrefix(m, "redirect="):
			lookups++
		}
	}

	result.Lookups = lookups

	if lookups > 10 {
		result.Issues = append(result.Issues, "SPF record exceeds 10 DNS lookup limit ("+strconv.Itoa(lookups)+" mechanisms); this may cause PermError")
		result.Valid = false
	}

	if !hasAll {
		result.Issues = append(result.Issues, "Missing terminating \"all\" mechanism; consider adding \"~all\" or \"-all\"")
	}

	if len(spfRecords) > 1 {
		result.Valid = false
	}

	if result.Issues == nil {
		result.Issues = []string{}
	}

	return result
}

// analyzeDKIM notes that DKIM verification requires a known selector.
func analyzeDKIM() *DKIMResult {
	return &DKIMResult{
		Found: false,
		Note:  "DKIM records are published at <selector>._domainkey.<domain> and cannot be checked without knowing the selector. Check with your email provider for the correct selector.",
	}
}

// analyzeDMARC performs a DNS TXT lookup on _dmarc.<domain> and parses the result.
func analyzeDMARC(domain string) *DMARCResult {
	result := &DMARCResult{}

	dmarcDomain := "_dmarc." + domain

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	txtRecords, err := net.DefaultResolver.LookupTXT(ctx, dmarcDomain)
	if err != nil {
		result.Found = false
		result.Issues = []string{"No DMARC record found at " + dmarcDomain}
		return result
	}

	// Find the DMARC record among TXT results.
	var dmarcRecord string
	for _, txt := range txtRecords {
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(txt)), "v=dmarc1") {
			dmarcRecord = txt
			break
		}
	}

	if dmarcRecord == "" {
		result.Found = false
		result.Issues = []string{"TXT records exist at " + dmarcDomain + " but none contain a valid DMARC record"}
		return result
	}

	result.Found = true
	result.Record = dmarcRecord
	result.Pct = 100 // Default per RFC 7489.

	// Parse DMARC tags. Tags are semicolon-separated key=value pairs.
	tags := parseDMARCTags(dmarcRecord)

	if p, ok := tags["p"]; ok {
		result.Policy = strings.ToLower(p)
	}
	if pctStr, ok := tags["pct"]; ok {
		if v, err := strconv.Atoi(strings.TrimSpace(pctStr)); err == nil {
			result.Pct = v
		}
	}
	if rua, ok := tags["rua"]; ok {
		result.RUA = rua
	}

	// Flag issues.
	if result.Policy == "" {
		result.Issues = append(result.Issues, "DMARC record missing required \"p\" (policy) tag")
	} else if result.Policy == "none" {
		result.Issues = append(result.Issues, "DMARC policy is \"none\" (monitoring only, no enforcement)")
	}

	if result.Pct < 100 {
		result.Issues = append(result.Issues, "DMARC pct="+strconv.Itoa(result.Pct)+"%; policy is not applied to all messages")
	}

	if result.RUA == "" {
		result.Issues = append(result.Issues, "No aggregate report URI (rua) configured; you won't receive DMARC reports")
	}

	if result.Issues == nil {
		result.Issues = []string{}
	}

	return result
}

// parseDMARCTags splits a DMARC record into its tag=value pairs.
func parseDMARCTags(record string) map[string]string {
	tags := make(map[string]string)
	parts := strings.Split(record, ";")
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		idx := strings.Index(part, "=")
		if idx < 0 {
			continue
		}
		key := strings.TrimSpace(part[:idx])
		val := strings.TrimSpace(part[idx+1:])
		tags[strings.ToLower(key)] = val
	}
	return tags
}

// gradeEmailAuth assigns a letter grade based on SPF and DMARC status.
//
//	A: SPF valid + DMARC reject/quarantine
//	B: SPF valid + DMARC none
//	C: SPF valid + no DMARC
//	D: SPF found but has issues (invalid)
//	F: No SPF record
func gradeEmailAuth(r *EmailAuthResult) string {
	if r.SPF == nil || !r.SPF.Found {
		return "F"
	}

	if !r.SPF.Valid {
		return "D"
	}

	// SPF is valid; grade depends on DMARC.
	if r.DMARC == nil || !r.DMARC.Found {
		return "C"
	}

	switch r.DMARC.Policy {
	case "reject", "quarantine":
		return "A"
	case "none":
		return "B"
	default:
		// DMARC record exists but policy is missing or unrecognized.
		return "C"
	}
}
