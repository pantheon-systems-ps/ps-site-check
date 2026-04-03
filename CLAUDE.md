# Claude Code Instructions

## Project overview

ps-site-check is a Go HTTP API for site inspection — DNS, HTTP headers, TLS certificates, with curated AGCDN insights. Deployed on Cloud Run, public, no auth by default.

## Structure

```
main.go              # HTTP server, middleware (auth, rate limit, logging), handlers, result cache
checker/
  types.go           # All data types (Result, Options, DNSResult, HTTPResult, TLSResult, etc.)
  checker.go         # Run() orchestrator, RunBatch(), normalizeURL(), generateID()
  dns.go             # checkDNS(), checkDNSMultiPath(), resolveVia()
  http.go            # checkHTTP(), extractAGCDNHeaders(), headerInsight(), traceRedirects()
  tls.go             # checkTLS(), tlsVersionString(), formatIssuer()
  insights.go        # generateInsights(), per-category insight functions
cloudbuild.yaml      # CI/CD for Cloud Run auto-deploy
Dockerfile           # Multi-stage Alpine build
```

## Conventions

- Go stdlib only — no external dependencies
- All checks run concurrently via goroutines + sync.WaitGroup
- Return empty slices (not nil) for clean JSON serialization
- Insights have severity (info/warning/error) and category (dns/cache/cdn/tls/security)
- Results get a random hex ID for permalink caching

## Deployment

- GCP project: `pantheon-psapps`, region: `us-east1`
- Cloud Run service: `ps-site-check`
- Custom domain: `site-check.ps-pantheon.com`
- Consumer: agcdn-dash-v2 `/check` route (server-side fetch)
