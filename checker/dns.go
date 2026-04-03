package checker

import (
	"context"
	"net"
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
