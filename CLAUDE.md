# Claude Code Instructions

## Project overview

ps-site-check is a comprehensive site analysis tool: a Go HTTP API with a Remix frontend. It performs DNS, HTTP, TLS, security, SEO, performance (Lighthouse/CrUX), email auth, and Pantheon platform checks with AI-powered analysis via Vertex AI. Deployed on GCP Cloud Run, public, no auth by default.

## Structure

```
main.go                        # HTTP server, middleware (auth, rate limit, CORS, logging),
                               # all handlers, GCS permalink storage, analytics endpoint
analytics.go                   # In-memory usage analytics tracker (request counts, top domains)
.gcloudignore                  # Excludes frontend/ from API deploys
cloudbuild.yaml                # CI/CD for Go API Cloud Run auto-deploy
cloudbuild-frontend.yaml       # CI/CD for frontend Cloud Run auto-deploy
Dockerfile                     # Multi-stage Alpine build (Go API)

checker/
  types.go                     # All data types (Result, Options, DNSResult, HTTPResult, TLSResult,
                               # SEOResult, LighthouseResult, CrUXResult, SecurityScorecard, etc.)
  checker.go                   # Run() orchestrator, RunBatch(), runWarmup(), normalizeURL(), generateID()
  dns.go                       # checkDNS(), checkDNSMultiPath(), resolveVia() — A/AAAA/CNAME/MX/NS/TXT,
                               # CAA, DNSSEC, 7 resolvers (Google, Cloudflare, Quad9, OpenDNS, etc.)
  http.go                      # checkHTTP(), extractAGCDNHeaders(), headerInsight(), traceRedirects(),
                               # User-Agent spoofing support
  tls.go                       # checkTLS(), classifyCipherSecurity(), tlsVersionString(), formatIssuer()
  insights.go                  # generateInsights(), per-category insight functions, warmupInsights()
  security.go                  # Security headers scorecard (HSTS, CSP, X-Frame-Options, etc.),
                               # cookie audit, overall grade calculation
  email.go                     # SPF/DKIM/DMARC analysis from DNS TXT records
  pantheon.go                  # Enhanced Pantheon platform detection (Styx, pcontext, binding, env)
  seo.go                       # SEO audit: title, meta, headings, images, robots.txt, sitemap,
                               # structured data (JSON-LD), mixed content, Open Graph
  crux.go                      # Chrome UX Report API — real-user field metrics
  lighthouse.go                # PageSpeed Insights: Lighthouse scores, WPT metrics, filmstrip,
                               # waterfall, asset breakdown, render-blocking, 3rd party,
                               # unused JS/CSS, cache policy, LCP/CLS elements, DOM size
  ai.go                        # Vertex AI integration: multi-model support (Gemini 2.5 Flash/Pro,
                               # Claude Sonnet/Opus), JSON output prompt, summarized context
  hsts.go                      # HSTS preload list check
  migration.go                 # Pre-migration readiness: 10-point checklist
  subdomains.go                # CT log subdomain discovery via crt.sh
  securitytrails.go            # SecurityTrails API: subdomains, DNS history, WHOIS, domain details
  har.go                       # HAR file analysis: slow requests, errors, cache ratio, domain stats
  validate.go                  # ValidateResolveIP() — SSRF prevention for resolve param
  agcdn.go                     # AGCDN feature probing: WAF, IO, rate limiting, geoblocking
  botprotect.go                # Bot protection detection (Fastly Bot Mgmt, Cloudflare, etc.)
  crawl.go                     # Site crawler (depth 1-3) + crawl-based comparison
  resources.go                 # Broken resource audit: CSS, JS, images, fonts

frontend/
  app/
    routes/
      _index.tsx               # Main check page (score dashboard, insights, AI, section cards)
      batch.tsx                # Batch check (up to 10 URLs)
      compare.tsx              # Quick compare (side-by-side) + crawl-based comparison
      migration.tsx            # Pre-migration readiness checklist
      analytics.tsx            # Usage analytics dashboard
      har.tsx                  # HAR file upload and analysis
      lighthouse.tsx           # Standalone Lighthouse/PSI page
      seo.tsx                  # Standalone SEO audit page
    components/
      SectionCard.tsx          # Collapsible section card with status-based borders
      AppNavbar.tsx            # Navigation bar with logo
    root.tsx                   # App shell (PDS GlobalWrapper, no auth)
    app.css                    # Design system tokens (colors, spacing, radii, shadows)
  DESIGN.md                    # Design guidelines and component patterns
  Dockerfile                   # Node.js 20 multi-stage build
  package.json
  vite.config.ts
  react-router.config.ts
  tsconfig.json
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/check` | GET | Core check: DNS, HTTP, TLS, security scorecard, email auth, Pantheon detection |
| `/check-batch` | POST | Batch check up to 10 URLs |
| `/seo` | GET | SEO audit (title, meta, headings, images, robots.txt, sitemap, structured data) |
| `/lighthouse` | GET | PageSpeed Insights (scores, filmstrip, waterfall, asset breakdown, CWV) |
| `/crux` | GET | Chrome UX Report real-user field metrics |
| `/subdomains` | GET | Subdomain discovery via SecurityTrails / CT logs |
| `/analyze` | POST | AI analysis via Vertex AI Gemini 2.5 Flash (reCAPTCHA protected) |
| `/models` | GET | List available AI models with pricing |
| `/migration-check` | POST | Pre-migration readiness checklist (10 checks) |
| `/hsts-preload` | GET | HSTS preload list check |
| `/agcdn-probe` | GET | Active AGCDN feature detection (WAF, IO, rate limiting) |
| `/bot-protection` | GET | Bot mitigation detection |
| `/resources` | GET | Broken resource audit (CSS, JS, images, fonts) |
| `/crawl` | POST | Site crawler (configurable depth 1-3) |
| `/compare` | POST | Crawl-based site comparison |
| `/dns-history` | GET | DNS history via SecurityTrails |
| `/whois` | GET | WHOIS via SecurityTrails |
| `/domain` | GET | Domain details via SecurityTrails |
| `/check-har` | POST | HAR file analysis |
| `/result/{id}` | GET | Permalink (persisted in GCS, forever retention) |
| `/analytics` | GET | Usage analytics dashboard |
| `/health` | GET | Health check |

## Conventions

### Go API

- Go stdlib only -- zero external dependencies
- All checks run concurrently via goroutines + sync.WaitGroup
- Return empty slices (not nil) for clean JSON serialization
- Insights have severity (info/warning/error) and category (dns/cache/cdn/tls/security)
- Results get a random hex ID for permalink storage in GCS bucket `ps-site-check-results`
- Tiered rate limiting per endpoint: 5/min for AI, 10/min for crawl/compare, 30/min for standard
- CORS restricted to `site-check.ps-pantheon.com` and `localhost`
- SSRF prevention: `validate.go` blocks private/reserved IPs in the `resolve` parameter

### Frontend

- Remix React Router 7 + Vite, TypeScript
- PDS Toolkit React for UI components (Panel, Button, Callout, Tabs, Navbar)
- No auth required -- public tool
- API URL via `SITE_CHECK_API_URL` env var (defaults to `https://api.site-check.ps-pantheon.com`)
- Loaders for reads (GET endpoints), actions for mutations (POST endpoints)
- Section-card layout with status-based borders (red for problems, amber for warnings, green for good)
- Client-side async loading for SEO and Lighthouse data (fetched after page renders)
- Subdomains are opt-in (user clicks a button to trigger discovery)
- reCAPTCHA v3 on AI analysis to prevent abuse
- Design system via CSS custom properties in `app.css` (colors, spacing, radii, shadows)

### AI Analysis

- Default model: Gemini 2.5 Flash (~$0.001/analysis)
- Also supports: Gemini 2.5 Pro, Claude Sonnet, Claude Opus
- JSON output prompt requesting: summary, findings (CRITICAL/WARNING prefixed), next_steps, risk
- Context sent to AI: summarized check result (21 key headers, security details, email auth, Pantheon info), SEO audit, Lighthouse metrics (no base64 images to save tokens)
- reCAPTCHA v3 required on `/analyze` endpoint

### Permalinks

- Stored in GCS bucket `ps-site-check-results` (project: `pantheon-psapps`)
- Forever retention (no TTL)
- Accessible via `GET /result/{id}`

## Deployment

- GCP project: `pantheon-psapps`, region: `us-east1`
- Go API: Cloud Run service `ps-site-check` at `api.site-check.ps-pantheon.com`
- Frontend: Cloud Run service `ps-site-check-web` at `site-check.ps-pantheon.com`
- `.gcloudignore` excludes `frontend/` from API deploys

## Environment Variables

| Env var | Description |
|---------|-------------|
| `PORT` | Server port (default: 8080) |
| `API_KEY` | Optional API key auth (`X-API-Key` header or `?key=` param) |
| `SECURITYTRAILS_API_KEY` | SecurityTrails for subdomain discovery, DNS history, WHOIS |
| `PAGESPEED_API_KEY` | Lighthouse/PSI (from `n8n-google-psi-api-key` secret) |
| `RECAPTCHA_SECRET_KEY` | reCAPTCHA v3 server-side secret |
| `RECAPTCHA_SITE_KEY` | reCAPTCHA v3 client-side site key |
| `GCP_PROJECT_ID` | GCP project (default: `pantheon-psapps`) |
| `VERTEX_AI_REGION` | Default: `us-east5` (Claude) / `us-east1` (Gemini) |
| `VERTEX_AI_MODEL` | Default AI model (default: `claude-opus-4-6@default`) |
