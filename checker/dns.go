package checker

import (
	"context"
	"net"
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
