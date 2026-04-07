# Claude Code Instructions

## Project overview

ps-site-check is a Go HTTP API for site inspection — DNS, HTTP headers, TLS certificates, with curated AGCDN insights. Deployed on Cloud Run, public, no auth by default.

## Structure

```
main.go              # HTTP server, middleware (auth, rate limit, logging), handlers, result cache
checker/
  types.go           # All data types (Result, Options, DNSResult, HTTPResult, TLSResult, WarmupResult, etc.)
  checker.go         # Run() orchestrator, RunBatch(), runWarmup(), normalizeURL(), generateID()
  dns.go             # checkDNS(), checkDNSMultiPath(), resolveVia() — A/AAAA/CNAME/MX/NS/TXT
  http.go            # checkHTTP(), extractAGCDNHeaders(), headerInsight(), traceRedirects()
  tls.go             # checkTLS(), classifyCipherSecurity(), tlsVersionString(), formatIssuer()
  insights.go        # generateInsights(), per-category insight functions, warmupInsights()
  subdomains.go      # LookupSubdomains() — CT log search via crt.sh
  securitytrails.go  # SecurityTrails API: LookupDNSHistory(), LookupWHOIS(), LookupSubdomainsST(), LookupDomainDetails()
  har.go             # AnalyzeHAR() — HAR file analysis
  validate.go        # ValidateResolveIP() — SSRF prevention
cloudbuild.yaml            # CI/CD for Go API Cloud Run auto-deploy
cloudbuild-frontend.yaml   # CI/CD for frontend Cloud Run auto-deploy
Dockerfile                 # Multi-stage Alpine build (Go API)
frontend/                  # Remix React Router 7 frontend
  app/
    routes/_index.tsx      # Single site check (main page)
    routes/batch.tsx       # Batch check (up to 10 URLs)
    components/AppNavbar.tsx
    root.tsx               # App shell (PDS GlobalWrapper, no auth)
    app.css
  Dockerfile               # Node.js 20 multi-stage build
  package.json
  vite.config.ts
  react-router.config.ts
  tsconfig.json
```

## Conventions

- Go stdlib only — no external dependencies
- All checks run concurrently via goroutines + sync.WaitGroup
- Return empty slices (not nil) for clean JSON serialization
- Insights have severity (info/warning/error) and category (dns/cache/cdn/tls/security)
- Results get a random hex ID for permalink caching

## Frontend conventions

- Remix React Router 7 + Vite, TypeScript
- PDS Toolkit React for UI components (Panel, Button, Callout, Tabs, Navbar)
- No auth required — public tool
- API URL via `SITE_CHECK_API_URL` env var (defaults to `https://api.site-check.ps-pantheon.com`)
- Loaders for reads (GET /check), actions for mutations (POST /check-batch)

## Deployment

- GCP project: `pantheon-psapps`, region: `us-east1`
- Go API: Cloud Run service `ps-site-check` at `api.site-check.ps-pantheon.com`
- Frontend: Cloud Run service `ps-site-check-web` at `site-check.ps-pantheon.com`
