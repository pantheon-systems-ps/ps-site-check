package checker

import (
	"net"
	"strings"
	"time"
)

// Known Pantheon IP ranges for CDN detection.
var pantheonIPs = map[string]string{
	"23.185.0.1":      "Global CDN",
	"23.185.0.2":      "Global CDN",
	"23.185.0.3":      "Global CDN",
	"23.185.0.4":      "Global CDN",
	"23.185.0.252":    "Global CDN (Canary)",
	"23.185.0.253":    "Global CDN (Canary)",
	"23.185.0.254":    "Global CDN (Canary)",
	"151.101.2.133":   "AGCDN Legacy",
	"151.101.66.133":  "AGCDN Legacy",
	"151.101.130.133": "AGCDN Legacy",
	"151.101.194.133": "AGCDN Legacy",
	"151.101.2.228":   "AGCDN2",
	"151.101.66.228":  "AGCDN2",
	"151.101.130.228": "AGCDN2",
	"151.101.194.228": "AGCDN2",
}

// CheckMigrationReadiness runs a pre-migration checklist for a domain.
func CheckMigrationReadiness(domain string) *MigrationReadiness {
	start := time.Now()
	domain = strings.TrimSpace(strings.ToLower(domain))

	result := &MigrationReadiness{
		Domain: domain,
		Checks: []MigrationCheck{},
	}

	passed := 0
	total := 0

	// 1. DNS resolution
	total++
	ips, err := net.LookupHost(domain)
	if err != nil || len(ips) == 0 {
		result.Checks = append(result.Checks, MigrationCheck{
			Name:        "DNS Resolution",
			Status:      "fail",
			Description: "Domain does not resolve",
			Detail:      "No A/AAAA records found. DNS must be configured before migration.",
		})
	} else {
		result.Checks = append(result.Checks, MigrationCheck{
			Name:        "DNS Resolution",
			Status:      "pass",
			Description: "Domain resolves successfully",
			Detail:      "IPs: " + strings.Join(ips, ", "),
		})
		passed++
	}

	// 2. Current hosting provider detection
	total++
	cnames, _ := net.LookupCNAME(domain)
	currentProvider := detectProvider(ips, cnames)
	alreadyPantheon := strings.Contains(currentProvider, "Pantheon")
	if alreadyPantheon {
		result.Checks = append(result.Checks, MigrationCheck{
			Name:        "Current Provider",
			Status:      "info",
			Description: "Already on Pantheon",
			Detail:      currentProvider,
		})
		passed++
	} else {
		result.Checks = append(result.Checks, MigrationCheck{
			Name:        "Current Provider",
			Status:      "info",
			Description: "Current provider detected",
			Detail:      currentProvider,
		})
		passed++
	}

	// 3. DNS provider detection
	total++
	ns, err := net.LookupNS(domain)
	if err == nil && len(ns) > 0 {
		nsNames := make([]string, len(ns))
		for i, n := range ns {
			nsNames[i] = n.Host
		}
		dnsProvider := detectDNSProvider(nsNames)
		result.Checks = append(result.Checks, MigrationCheck{
			Name:        "DNS Provider",
			Status:      "pass",
			Description: "DNS provider identified",
			Detail:      dnsProvider + " (" + strings.Join(nsNames, ", ") + ")",
		})
		passed++
	} else {
		result.Checks = append(result.Checks, MigrationCheck{
			Name:        "DNS Provider",
			Status:      "warning",
			Description: "Could not determine DNS provider",
		})
	}

	// 4. TLS certificate check
	total++
	tlsResult := checkTLS(domain, "443", Options{})
	if tlsResult != nil && tlsResult.Error == "" {
		result.Checks = append(result.Checks, MigrationCheck{
			Name:        "TLS Certificate",
			Status:      "pass",
			Description: "Valid TLS certificate found",
			Detail:      "Issuer: " + tlsResult.Issuer + ", Expires: " + tlsResult.ValidTo,
		})
		passed++
	} else {
		errDetail := ""
		if tlsResult != nil {
			errDetail = tlsResult.Error
		}
		result.Checks = append(result.Checks, MigrationCheck{
			Name:        "TLS Certificate",
			Status:      "warning",
			Description: "TLS certificate issue",
			Detail:      errDetail,
		})
	}

	// 5. HSTS check
	total++
	httpResult := checkHTTP("https://"+domain, domain, Options{PantheonDebug: true, FastlyDebug: true})
	if httpResult != nil && httpResult.Error == "" {
		hsts := httpResult.Headers["strict-transport-security"]
		if hsts != "" {
			result.Checks = append(result.Checks, MigrationCheck{
				Name:        "HSTS Header",
				Status:      "pass",
				Description: "HSTS is configured",
				Detail:      hsts,
			})
			passed++
		} else {
			result.Checks = append(result.Checks, MigrationCheck{
				Name:        "HSTS Header",
				Status:      "warning",
				Description: "No HSTS header — consider adding after migration",
			})
		}
	} else {
		result.Checks = append(result.Checks, MigrationCheck{
			Name:        "HSTS Header",
			Status:      "warning",
			Description: "Could not check HSTS (HTTP request failed)",
		})
	}

	// 6. HTTP to HTTPS redirect
	total++
	httpPlain := checkHTTP("http://"+domain, domain, Options{})
	if httpPlain != nil && httpPlain.StatusCode >= 300 && httpPlain.StatusCode < 400 {
		loc := httpPlain.Headers["location"]
		if strings.HasPrefix(loc, "https://") {
			result.Checks = append(result.Checks, MigrationCheck{
				Name:        "HTTP→HTTPS Redirect",
				Status:      "pass",
				Description: "HTTP correctly redirects to HTTPS",
				Detail:      loc,
			})
			passed++
		} else {
			result.Checks = append(result.Checks, MigrationCheck{
				Name:        "HTTP→HTTPS Redirect",
				Status:      "warning",
				Description: "HTTP redirects but not to HTTPS",
				Detail:      loc,
			})
		}
	} else {
		result.Checks = append(result.Checks, MigrationCheck{
			Name:        "HTTP→HTTPS Redirect",
			Status:      "warning",
			Description: "No HTTP→HTTPS redirect detected",
		})
	}

	// 7. CAA records
	total++
	caaRecords := lookupCAA(domain)
	if len(caaRecords) > 0 {
		caaIssuers := []string{}
		for _, c := range caaRecords {
			if c.Tag == "issue" || c.Tag == "issuewild" {
				caaIssuers = append(caaIssuers, c.Value)
			}
		}
		// Check if Let's Encrypt or GlobalSign is allowed
		allowsPantheon := false
		for _, issuer := range caaIssuers {
			lower := strings.ToLower(issuer)
			if strings.Contains(lower, "letsencrypt") || strings.Contains(lower, "globalsign") {
				allowsPantheon = true
			}
		}
		if allowsPantheon {
			result.Checks = append(result.Checks, MigrationCheck{
				Name:        "CAA Records",
				Status:      "pass",
				Description: "CAA allows Pantheon certificate issuers",
				Detail:      strings.Join(caaIssuers, ", "),
			})
			passed++
		} else {
			result.Checks = append(result.Checks, MigrationCheck{
				Name:        "CAA Records",
				Status:      "warning",
				Description: "CAA records may need updating for Pantheon",
				Detail:      "Current issuers: " + strings.Join(caaIssuers, ", ") + ". Pantheon uses Let's Encrypt and GlobalSign.",
			})
		}
	} else {
		result.Checks = append(result.Checks, MigrationCheck{
			Name:        "CAA Records",
			Status:      "pass",
			Description: "No CAA records (any CA can issue certificates)",
		})
		passed++
	}

	// 8. Email auth (SPF/DMARC)
	total++
	txtRecords, _ := net.LookupTXT(domain)
	emailAuth := AuditEmailAuth(domain, txtRecords)
	if emailAuth != nil {
		if emailAuth.SPF != nil && emailAuth.SPF.Found {
			result.Checks = append(result.Checks, MigrationCheck{
				Name:        "Email Authentication",
				Status:      "pass",
				Description: "SPF record found (preserve during DNS migration)",
				Detail:      "Grade: " + emailAuth.Grade,
			})
			passed++
		} else {
			result.Checks = append(result.Checks, MigrationCheck{
				Name:        "Email Authentication",
				Status:      "info",
				Description: "No SPF record found",
			})
			passed++
		}
	}

	// 9. MX records (preserve during migration)
	total++
	mxRecords, err := net.LookupMX(domain)
	if err == nil && len(mxRecords) > 0 {
		mxHosts := make([]string, len(mxRecords))
		for i, mx := range mxRecords {
			mxHosts[i] = mx.Host
		}
		result.Checks = append(result.Checks, MigrationCheck{
			Name:        "MX Records",
			Status:      "pass",
			Description: "MX records found (preserve during DNS migration)",
			Detail:      strings.Join(mxHosts, ", "),
		})
		passed++
	} else {
		result.Checks = append(result.Checks, MigrationCheck{
			Name:        "MX Records",
			Status:      "info",
			Description: "No MX records found",
		})
		passed++
	}

	// 10. Domain count (subdomains)
	total++
	subResult := LookupSubdomains(domain)
	if subResult.Count > 0 {
		result.Checks = append(result.Checks, MigrationCheck{
			Name:        "Subdomain Count",
			Status:      "info",
			Description: "Subdomains discovered via Certificate Transparency",
			Detail:      strings.Join(subResult.Subdomains[:min(5, len(subResult.Subdomains))], ", ") + " (" + itoa(subResult.Count) + " total)",
		})
		passed++
	} else {
		result.Checks = append(result.Checks, MigrationCheck{
			Name:        "Subdomain Count",
			Status:      "info",
			Description: "No subdomains discovered",
		})
		passed++
	}

	// Calculate score and grade
	if total > 0 {
		result.Score = (passed * 100) / total
	}
	result.Grade = migrationGrade(result.Score)
	result.DurationMS = time.Since(start).Milliseconds()

	return result
}

func detectProvider(ips []string, cname string) string {
	cnameLower := strings.ToLower(cname)

	// Check Pantheon IPs
	for _, ip := range ips {
		if _, ok := pantheonIPs[ip]; ok {
			return "Pantheon (" + pantheonIPs[ip] + ")"
		}
	}

	// Check CNAME patterns
	switch {
	case strings.Contains(cnameLower, "pantheon.io") || strings.Contains(cnameLower, "edge.pantheon"):
		return "Pantheon"
	case strings.Contains(cnameLower, "wpengine"):
		return "WP Engine"
	case strings.Contains(cnameLower, "cloudflare"):
		return "Cloudflare"
	case strings.Contains(cnameLower, "amazonaws.com"):
		return "AWS"
	case strings.Contains(cnameLower, "googlehosted") || strings.Contains(cnameLower, "ghs."):
		return "Google Cloud"
	case strings.Contains(cnameLower, "azurewebsites") || strings.Contains(cnameLower, "azure"):
		return "Azure"
	case strings.Contains(cnameLower, "netlify"):
		return "Netlify"
	case strings.Contains(cnameLower, "vercel"):
		return "Vercel"
	case strings.Contains(cnameLower, "acquia"):
		return "Acquia"
	case strings.Contains(cnameLower, "platformsh") || strings.Contains(cnameLower, "platform.sh"):
		return "Platform.sh"
	case strings.Contains(cnameLower, "squarespace"):
		return "Squarespace"
	case strings.Contains(cnameLower, "shopify"):
		return "Shopify"
	}

	return "Unknown (IPs: " + strings.Join(ips, ", ") + ")"
}

func detectDNSProvider(nameservers []string) string {
	if len(nameservers) == 0 {
		return "Unknown"
	}
	ns := strings.ToLower(nameservers[0])
	switch {
	case strings.Contains(ns, "cloudflare"):
		return "Cloudflare"
	case strings.Contains(ns, "route53") || strings.Contains(ns, "awsdns"):
		return "AWS Route 53"
	case strings.Contains(ns, "google") || strings.Contains(ns, "googledomains"):
		return "Google Cloud DNS"
	case strings.Contains(ns, "godaddy") || strings.Contains(ns, "domaincontrol"):
		return "GoDaddy"
	case strings.Contains(ns, "namecheap") || strings.Contains(ns, "registrar-servers"):
		return "Namecheap"
	case strings.Contains(ns, "digitalocean"):
		return "DigitalOcean"
	case strings.Contains(ns, "dnsimple"):
		return "DNSimple"
	case strings.Contains(ns, "nsone") || strings.Contains(ns, "ns1"):
		return "NS1"
	case strings.Contains(ns, "dynect"):
		return "Dyn"
	case strings.Contains(ns, "azure"):
		return "Azure DNS"
	}
	return "Other"
}

func migrationGrade(score int) string {
	switch {
	case score >= 90:
		return "A"
	case score >= 75:
		return "B"
	case score >= 60:
		return "C"
	case score >= 40:
		return "D"
	default:
		return "F"
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	s := ""
	for n > 0 {
		s = string(rune('0'+n%10)) + s
		n /= 10
	}
	return s
}
