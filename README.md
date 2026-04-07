# ps-site-check

Fast site inspection API built in Go. Checks DNS, HTTP headers, and TLS certificates with curated insights for AGCDN investigation.

**API:** https://api.site-check.ps-pantheon.com
**Frontend:** https://site-check.ps-pantheon.com

## API Endpoints

### Check a single URL

```
GET /check?url=pantheon.io
GET /check?url=pantheon.io/docs&follow=true       # follow redirect chain
GET /check?url=pantheon.io&double=true             # cache test (MISS→HIT)
GET /check?url=pantheon.io&double=true&follow=true # both
GET /check?url=pantheon.io&warmup=5                # cache warmup (5 requests, report hit ratio)
GET /check?url=pantheon.io&client_ip=203.0.113.1   # spoof Fastly-Client-IP for geo-routing test
GET /check?url=site.com&resolve=192.0.2.1          # force-resolve to specific IP
GET /check?url=site.com&debug=false&fdebug=false   # disable debug headers
GET /check?url=site.com&user_agent=Googlebot/2.1   # spoof User-Agent
```

#### Query parameters

| Param | Type | Description |
|-------|------|-------------|
| `url` | string | **(required)** Domain or URL to check |
| `double` | bool | Make two requests with 2s delay to test MISS→HIT |
| `follow` | bool | Trace redirect chain (up to 10 hops) |
| `warmup` | int | Cache warmup test: make N requests (2-20) and report hit ratio |
| `resolve` | string | Force HTTP/TLS to connect to this IP (like `curl --resolve`) |
| `client_ip` | string | Send `Fastly-Client-IP` header for geo-routing tests |
| `user_agent` | string | Custom User-Agent string (default: `ps-site-check/1.0`). Use to simulate browser-specific behavior |
| `debug` | bool | Send `Pantheon-Debug: 1` header (default: true) |
| `fdebug` | bool | Send `Fastly-Debug: 1` header (default: true) |
| `key` | string | API key (if `API_KEY` env var is set) |

### Subdomain discovery

Discover subdomains. Uses SecurityTrails when `SECURITYTRAILS_API_KEY` is set (up to 31k+ results), falls back to crt.sh Certificate Transparency logs.

```
GET /subdomains?domain=pantheon.io             # auto-select best source
GET /subdomains?domain=pantheon.io&source=crtsh  # force crt.sh
```

### DNS history (SecurityTrails)

View historical DNS record changes — useful for migration debugging.

```
GET /dns-history?domain=pantheon.io              # defaults to A records
GET /dns-history?domain=pantheon.io&type=ns       # NS record history
GET /dns-history?domain=pantheon.io&type=mx       # MX record history
```

Supported types: `a`, `aaaa`, `mx`, `ns`, `soa`, `txt`

### WHOIS history (SecurityTrails)

Domain registration history — registrar, expiry, nameservers, contacts.

```
GET /whois?domain=pantheon.io
```

### Domain details (SecurityTrails)

Current authoritative DNS data with organization attribution.

```
GET /domain?domain=pantheon.io
```

### Batch check (up to 10 URLs)

```bash
curl -X POST /check-batch \
  -H "Content-Type: application/json" \
  -d '{"urls": ["pantheon.io", "example.com", "docs.pantheon.io"]}'
```

### HAR file analysis

```bash
curl -X POST /check-har \
  -H "Content-Type: application/json" \
  -d @recording.har
```

Analyzes HAR files for slow requests, errors, cache hit ratio, and per-domain/content-type stats.

### Retrieve cached result (permalink)

```
GET /result/{id}   # results cached for 24 hours
```

### Health check

```
GET /health
```

## What it checks

| Check | Details |
|-------|---------|
| **DNS** | A, AAAA, CNAME, MX, NS, TXT records + multi-resolver comparison (Google, Cloudflare, Quad9) |
| **HTTP** | Response headers with `Pantheon-Debug: 1` and `Fastly-Debug: 1`, 34 AGCDN-relevant headers with per-header insights |
| **TLS** | Certificate subject, issuer, SANs, validity dates, protocol version, cipher suite with security classification |
| **Cache** | Double-request MISS→HIT test, warmup test with N-request hit ratio analysis |
| **Subdomains** | SecurityTrails (preferred) or crt.sh Certificate Transparency |
| **DNS History** | Historical DNS record changes via SecurityTrails |
| **WHOIS** | Domain registration history via SecurityTrails |
| **Insights** | Curated observations across cache, CDN, security, TLS, DNS categories |

### Insights engine covers

- AGCDN/GCDN/Fastly detection
- Cache effectiveness (HIT/MISS analysis, Cache-Control, Vary: Cookie, Set-Cookie)
- Cache warmup hit ratio analysis with cache acceleration detection
- Double-request MISS→HIT comparison with response time acceleration
- Redirect chain analysis (HTTP→HTTPS, loops, long chains)
- DNS consistency across resolvers
- DNS provider detection (Route 53, Cloudflare, Google Cloud DNS, GoDaddy)
- SPF, DMARC, and domain verification TXT record detection
- TLS certificate expiry warnings (7/30 day thresholds)
- TLS version checks (deprecated 1.0/1.1)
- TLS cipher suite security classification (recommended/secure/weak/insecure)
- Certificate issuer identification (Let's Encrypt, GlobalSign, Certainly)
- Security headers (HSTS, X-Frame-Options, CSP, X-Content-Type-Options)
- Pantheon platform detection (Styx, pcontext-backend, HTTPS enforcement)

## Run locally

```bash
go run .
curl "http://localhost:8080/check?url=pantheon.io"
```

## Deploy to Cloud Run

```bash
gcloud run deploy ps-site-check \
  --source . \
  --region us-east1 \
  --allow-unauthenticated \
  --memory 256Mi \
  --cpu 1 \
  --max-instances 3
```

CI/CD: `cloudbuild.yaml` is included. Connect the repo to Cloud Build in the GCP console to enable auto-deploy on push.

## Configuration

| Env var | Description | Required |
|---------|-------------|----------|
| `PORT` | Server port (default: 8080) | No |
| `API_KEY` | API key for authentication. When set, requests must include `X-API-Key` header or `?key=` param | No |
| `SECURITYTRAILS_API_KEY` | SecurityTrails API key. Enables `/dns-history`, `/whois`, `/domain` endpoints and enhanced `/subdomains`. Free tier: 50 queries/month at [securitytrails.com](https://securitytrails.com/app/signup) | No |

## Rate limiting

30 requests per minute per IP address (in-memory token bucket).

## Architecture

- **Go stdlib only** — zero external dependencies
- DNS, HTTP, TLS, and multi-resolver checks run in parallel goroutines
- In-memory result cache (LRU, 1000 entries, 24h TTL)
- Structured JSON logging (Cloud Run compatible)
- ~150-300ms typical response time

## Frontend

The Site Check frontend is a Remix React Router 7 app in the `frontend/` directory, deployed as a separate Cloud Run service (`ps-site-check-web`) at `site-check.ps-pantheon.com`. It consumes the Go API at `api.site-check.ps-pantheon.com` server-side.

See `frontend/README.md` for setup instructions.
