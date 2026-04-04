package checker

import "net"

// ValidateResolveIP checks that the given string is a valid public IP address.
// Returns an error message if invalid, or empty string if valid.
// This prevents SSRF by rejecting private, loopback, link-local, and reserved ranges.
func ValidateResolveIP(ip string) string {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return "invalid IP address: " + ip
	}
	if !isPublicIP(parsed) {
		return "resolve IP must be a public address, got: " + ip
	}
	return ""
}

// isPublicIP returns true if the IP is not in any private or reserved range.
func isPublicIP(ip net.IP) bool {
	privateCIDRs := []string{
		"0.0.0.0/8",       // "This" network
		"10.0.0.0/8",      // Private
		"100.64.0.0/10",   // Carrier-grade NAT
		"127.0.0.0/8",     // Loopback
		"169.254.0.0/16",  // Link-local (blocks GCP metadata 169.254.169.254)
		"172.16.0.0/12",   // Private
		"192.0.0.0/24",    // IETF protocol assignments
		"192.0.2.0/24",    // Documentation (TEST-NET-1)
		"192.168.0.0/16",  // Private
		"198.18.0.0/15",   // Benchmarking
		"198.51.100.0/24", // Documentation (TEST-NET-2)
		"203.0.113.0/24",  // Documentation (TEST-NET-3)
		"224.0.0.0/4",     // Multicast
		"240.0.0.0/4",     // Reserved
		"::1/128",         // IPv6 loopback
		"fc00::/7",        // IPv6 unique local
		"fe80::/10",       // IPv6 link-local
		"ff00::/8",        // IPv6 multicast
	}

	for _, cidr := range privateCIDRs {
		_, network, err := net.ParseCIDR(cidr)
		if err != nil {
			continue
		}
		if network.Contains(ip) {
			return false
		}
	}
	return true
}
