# ps-site-check

Fast site inspection API. Checks DNS, HTTP headers, and TLS certificates with curated insights for AGCDN investigation.

## Usage

```
GET /check?url=pantheon.io
```

Returns JSON with DNS resolution, HTTP response headers (with AGCDN-specific analysis), TLS certificate details, and actionable insights.

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
  --allow-unauthenticated
```

## API Response

```json
{
  "url": "https://pantheon.io",
  "timestamp": "2026-04-03T12:00:00Z",
  "duration_ms": 342,
  "dns": {
    "a": ["23.185.0.253"],
    "aaaa": ["2620:12a:8001::253"],
    "cname": [],
    "duration_ms": 12
  },
  "http": {
    "status_code": 200,
    "headers": { "...": "..." },
    "agcdn_headers": [
      { "header": "x-cache", "value": "HIT, MISS", "insight": "Edge: cache hit; Shield: cache miss" }
    ],
    "duration_ms": 280
  },
  "tls": {
    "protocol": "TLS 1.3",
    "subject": "pantheon.io",
    "issuer": "R3 (Let's Encrypt)",
    "valid_from": "...",
    "valid_to": "...",
    "sans": ["pantheon.io", "www.pantheon.io"],
    "duration_ms": 50
  },
  "insights": [
    { "severity": "info", "category": "cdn", "message": "AGCDN is active (agcdn-info header present)" }
  ]
}
```

## Health check

```
GET /health
```
