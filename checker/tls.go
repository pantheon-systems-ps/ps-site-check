package checker

import (
	"crypto/tls"
	"crypto/x509/pkix"
	"fmt"
	"net"
	"time"
)

// checkTLS connects to the host and inspects the TLS certificate.
func checkTLS(hostname, port string) *TLSResult {
	start := time.Now()

	conn, err := tls.DialWithDialer(
		&net.Dialer{Timeout: 5 * time.Second},
		"tcp",
		net.JoinHostPort(hostname, port),
		&tls.Config{
			MinVersion: tls.VersionTLS12,
		},
	)
	if err != nil {
		return &TLSResult{
			Error:      "TLS connection failed: " + err.Error(),
			DurationMS: time.Since(start).Milliseconds(),
		}
	}
	defer conn.Close()

	state := conn.ConnectionState()
	result := &TLSResult{
		Protocol:   tlsVersionString(state.Version),
		DurationMS: time.Since(start).Milliseconds(),
	}

	if len(state.PeerCertificates) > 0 {
		cert := state.PeerCertificates[0]
		result.Subject = cert.Subject.CommonName
		result.Issuer = formatIssuer(cert.Issuer)
		result.ValidFrom = cert.NotBefore.UTC().Format(time.RFC3339)
		result.ValidTo = cert.NotAfter.UTC().Format(time.RFC3339)
		result.SANs = cert.DNSNames
	}

	if result.SANs == nil {
		result.SANs = []string{}
	}

	return result
}

func tlsVersionString(version uint16) string {
	switch version {
	case tls.VersionTLS10:
		return "TLS 1.0"
	case tls.VersionTLS11:
		return "TLS 1.1"
	case tls.VersionTLS12:
		return "TLS 1.2"
	case tls.VersionTLS13:
		return "TLS 1.3"
	default:
		return fmt.Sprintf("unknown (0x%04x)", version)
	}
}

func formatIssuer(issuer pkix.Name) string {
	if issuer.CommonName != "" {
		if len(issuer.Organization) > 0 {
			return fmt.Sprintf("%s (%s)", issuer.CommonName, issuer.Organization[0])
		}
		return issuer.CommonName
	}
	if len(issuer.Organization) > 0 {
		return issuer.Organization[0]
	}
	return issuer.String()
}
