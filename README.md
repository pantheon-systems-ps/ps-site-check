# ps-site-check

Comprehensive site analysis tool with a Go API and Remix frontend. Checks DNS, HTTP headers, TLS certificates, security posture, SEO, performance (Lighthouse/CrUX), email authentication, Pantheon platform detection, and more -- with AI-powered analysis via Vertex AI.

**API:** https://api.site-check.ps-pantheon.com
**Frontend:** https://site-check.ps-pantheon.com

## API Endpoints

### Core check

```
GET /check?url=pantheon.io
```

Full site inspection: DNS (A/AAAA/CNAME/MX/NS/TXT, multi-resolver, CAA, DNSSEC), HTTP headers with AGCDN/Fastly debug, TLS certificate and cipher analysis, security headers scorecard, cookie audit, email authentication (SPF/DKIM/DMARC), and Pantheon platform detection.

#### Query parameters

| Param | Type | Description |
|-------|------|-------------|
| `url` | string | **(required)** Domain or URL to check |
| `double` | bool | Make two requests with 2s delay to test MISS-to-HIT cache behavior |
| `follow` | bool | Trace redirect chain (up to 10 hops) |
| `warmup` | int | Cache warmup: make N requests (2-20) and report hit ratio |
| `resolve` | string | Force HTTP/TLS to connect to this IP (like `curl --resolve`) |
| `client_ip` | string | Send `Fastly-Client-IP` header for geo-routing tests |
| `user_agent` | string | Custom User-Agent string (default: `ps-site-check/1.0`) |
| `debug` | bool | Send `Pantheon-Debug: 1` header (default: true) |
| `fdebug` | bool | Send `Fastly-Debug: 1` header (default: true) |
| `key` | string | API key (if `API_KEY` env var is set) |

#### Examples

```
GET /check?url=pantheon.io&double=true&follow=true
GET /check?url=pantheon.io&warmup=5
GET /check?url=pantheon.io&client_ip=203.0.113.1
GET /check?url=site.com&resolve=192.0.2.1
GET /check?url=site.com&user_agent=Googlebot/2.1
GET /check?url=site.com&debug=false&fdebug=false
```

### Batch check

```
POST /check-batch
Content-Type: application/json

{"urls": ["pantheon.io", "example.com", "docs.pantheon.io"]}
```

Check up to 10 URLs in parallel.

### SEO audit

```
GET /seo?url=pantheon.io
```

Title, meta description, Open Graph, headings hierarchy, image alt text, robots.txt, sitemap.xml, structured data (JSON-LD), mixed content detection.

### Lighthouse / PageSpeed Insights

```
GET /lighthouse?url=pantheon.io
GET /lighthouse?url=pantheon.io&strategy=desktop
```

Lighthouse scores (performance, accessibility, best-practices, SEO), Core Web Vitals, filmstrip timeline, waterfall, asset breakdown by type/domain, render-blocking resources, third-party impact, unused JS/CSS, cache policy audit, LCP/CLS element identification, DOM size stats.

### Chrome UX Report (CrUX)

```
GET /crux?origin=https://pantheon.io
```

Real-user field metrics from Google CrUX API. Requires `CRUX_API_KEY` (same as `PAGESPEED_API_KEY`).

### Subdomain discovery

```
GET /subdomains?domain=pantheon.io
GET /subdomains?domain=pantheon.io&source=crtsh
```

Uses SecurityTrails when `SECURITYTRAILS_API_KEY` is set (up to 31k+ results), falls back to crt.sh Certificate Transparency logs.

### AI analysis

```
POST /analyze
Content-Type: application/json

{"check_result": {...}, "seo_result": {...}, "lighthouse_result": {...}}
```

AI-powered analysis via Vertex AI. Default model: Gemini 2.5 Flash (~$0.001/analysis). Protected by reCAPTCHA v3.

### List AI models

```
GET /models
```

Returns available AI models with pricing and region info.

### Pre-migration readiness

```
POST /migration-check
Content-Type: application/json

{"url": "example.com"}
```

10-point migration readiness checklist: DNS provider, CDN detection, TLS issuer, HSTS policy, redirect chains, mixed content, security headers, email auth, CMS detection, performance baseline.

### HSTS preload check

```
GET /hsts-preload?domain=pantheon.io
```

Checks if a domain is on the HSTS preload list.

### AGCDN feature probe

```
GET /agcdn-probe?domain=pantheon.io
```

Active detection of AGCDN features: WAF, Image Optimization, rate limiting, geoblocking, edge redirects.

### Bot protection detection

```
GET /bot-protection?domain=pantheon.io
```

Detects bot mitigation services (Fastly Bot Management, Cloudflare Bot Management, etc.) via response analysis.

### Broken resource audit

```
GET /resources?url=pantheon.io
```

Audits CSS, JS, images, and fonts for broken links (4xx/5xx), mixed content, and accessibility issues.

### Site crawler

```
POST /crawl
Content-Type: application/json

{"url": "https://example.com", "depth": 2, "max_pages": 50}
```

Crawls a site (configurable depth 1-3) and reports page status, broken links, and structure.

### Crawl-based site comparison

```
POST /compare
Content-Type: application/json

{"source_url": "https://old.example.com", "target_url": "https://new.example.com", "depth": 1}
```

Crawls two sites and compares structure, status codes, and content differences.

### DNS history (SecurityTrails)

```
GET /dns-history?domain=pantheon.io
GET /dns-history?domain=pantheon.io&type=ns
```

Historical DNS record changes. Supported types: `a`, `aaaa`, `mx`, `ns`, `soa`, `txt`.

### WHOIS (SecurityTrails)

```
GET /whois?domain=pantheon.io
```

Domain registration history: registrar, expiry, nameservers, contacts.

### Domain details (SecurityTrails)

```
GET /domain?domain=pantheon.io
```

Current authoritative DNS data with organization attribution.

### HAR file analysis

```
POST /check-har
Content-Type: application/json

<HAR file contents>
```

Analyzes HAR files for slow requests, errors, cache hit ratio, and per-domain/content-type stats.

### Permalinks

```
GET /result/{id}
```

Retrieve a persisted check result. Results are stored in GCS bucket `ps-site-check-results` with no expiration (forever retention).

### Usage analytics

```
GET /analytics
```

In-memory usage analytics: request counts, top domains, endpoint breakdown, response times.

### Health check

```
GET /health
```

## Architecture

- **Go stdlib only** -- zero external dependencies
- DNS, HTTP, TLS, and multi-resolver checks run in parallel via goroutines
- Tiered rate limiting per endpoint (5-30 requests/min per IP, in-memory token bucket)
- CORS restricted to `site-check.ps-pantheon.com` and `localhost`
- Permalink storage in GCS bucket `ps-site-check-results` (forever retention)
- AI analysis via Vertex AI (Gemini 2.5 Flash default, supports Claude Opus/Sonnet via model param)
- reCAPTCHA v3 on `/analyze` endpoint
- Structured JSON logging (Cloud Run compatible)
- ~150-300ms typical response time for core checks

## Frontend

Remix React Router 7 app in the `frontend/` directory, deployed as a separate Cloud Run service (`ps-site-check-web`) at `site-check.ps-pantheon.com`.

**Pages:**

| Route | Description |
|-------|-------------|
| `/` (Check) | Main check page with score dashboard, insights, AI analysis, collapsible section cards |
| `/batch` | Batch check up to 10 URLs |
| `/compare` | Quick compare (side-by-side) + crawl-based comparison |
| `/migration` | Pre-migration readiness checklist |
| `/analytics` | Usage analytics dashboard |
| `/har` | HAR file upload and analysis |
| `/lighthouse` | Standalone Lighthouse/PSI page |
| `/seo` | Standalone SEO audit page |

**Design:** Section-card layout with status-based borders (red/amber/green), CSS custom properties design system, client-side async loading for SEO and Lighthouse data, PDS Toolkit React components.

## Environment Variables

| Env var | Description | Required |
|---------|-------------|----------|
| `PORT` | Server port (default: 8080) | No |
| `API_KEY` | API key for authentication. When set, requests must include `X-API-Key` header or `?key=` param | No |
| `SECURITYTRAILS_API_KEY` | SecurityTrails API key. Enables `/dns-history`, `/whois`, `/domain` endpoints and enhanced `/subdomains` | No |
| `PAGESPEED_API_KEY` | Lighthouse/PSI API key (from `n8n-google-psi-api-key` secret in GCP) | No |
| `RECAPTCHA_SECRET_KEY` | reCAPTCHA v3 server-side secret for `/analyze` | No |
| `RECAPTCHA_SITE_KEY` | reCAPTCHA v3 client-side site key | No |
| `GCP_PROJECT_ID` | GCP project (default: `pantheon-psapps`) | No |
| `VERTEX_AI_REGION` | Vertex AI region (default: `us-east5` for Claude, `us-east1` for Gemini) | No |
| `VERTEX_AI_MODEL` | Default AI model (default: `claude-opus-4-6@default`) | No |
| `CRUX_API_KEY` | Chrome UX Report API key (same key as `PAGESPEED_API_KEY`) | No |

## Local Development

```bash
# API (runs on :8080)
go run .

# Frontend (runs on :5173)
cd frontend && npm install && npm run dev
```

## Deploy to Cloud Run

```bash
# API
gcloud run deploy ps-site-check \
  --source . \
  --region us-east1 \
  --project pantheon-psapps \
  --allow-unauthenticated

# Frontend
cd frontend && gcloud run deploy ps-site-check-web \
  --source . \
  --region us-east1 \
  --project pantheon-psapps \
  --allow-unauthenticated
```

CI/CD: `cloudbuild.yaml` (API) and `cloudbuild-frontend.yaml` (frontend) are included. Connect the repo to Cloud Build in the GCP console for auto-deploy on push.
