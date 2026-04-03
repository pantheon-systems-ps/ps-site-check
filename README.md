# ps-site-check

Fast site inspection API built in Go. Checks DNS, HTTP headers, and TLS certificates with curated insights for AGCDN investigation.

**Live:** https://ps-site-check-272623337619.us-east1.run.app
**Custom domain:** https://site-check.ps-pantheon.com

## API Endpoints

### Check a single URL

```
GET /check?url=pantheon.io
GET /check?url=pantheon.io/docs&follow=true       # follow redirect chain
GET /check?url=pantheon.io&double=true             # cache test (MISS→HIT)
GET /check?url=pantheon.io&double=true&follow=true # both
```

### Batch check (up to 10 URLs)

```bash
curl -X POST /check-batch \
  -H "Content-Type: application/json" \
  -d '{"urls": ["pantheon.io", "example.com", "docs.pantheon.io"]}'
```

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
| **DNS** | A, AAAA, CNAME records + multi-resolver comparison (Google, Cloudflare, Quad9) |
| **HTTP** | Response headers with `Pantheon-Debug: 1` and `Fastly-Debug: 1`, 34 AGCDN-relevant headers with per-header insights |
| **TLS** | Certificate subject, issuer, SANs, validity dates, protocol version |
| **Insights** | Curated observations across cache, CDN, security, TLS, DNS categories |

### Insights engine covers

- AGCDN/GCDN/Fastly detection
- Cache effectiveness (HIT/MISS analysis, Cache-Control, Vary: Cookie, Set-Cookie)
- Double-request MISS→HIT comparison with response time acceleration
- Redirect chain analysis (HTTP→HTTPS, loops, long chains)
- DNS consistency across resolvers
- TLS certificate expiry warnings (7/30 day thresholds)
- TLS version checks (deprecated 1.0/1.1)
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

## Rate limiting

30 requests per minute per IP address (in-memory token bucket).

## Architecture

- **Go stdlib only** — zero external dependencies
- DNS, HTTP, TLS, and multi-resolver checks run in parallel goroutines
- In-memory result cache (LRU, 1000 entries, 24h TTL)
- Structured JSON logging (Cloud Run compatible)
- ~150-300ms typical response time

## Dashboard integration

The AGCDN Dashboard (agcdn-dash-v2) has a `/check` page that consumes this API server-side. Available at `agcdn.ps-pantheon.com/check`.
