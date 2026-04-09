export type SiteCheckResult = {
  id: string;
  url: string;
  resolve_ip?: string;
  timestamp: string;
  duration_ms: number;
  dns: {
    a: string[];
    aaaa: string[];
    cname: string[];
    mx?: { host: string; priority: number }[];
    ns?: string[];
    txt?: string[];
    duration_ms: number;
    error?: string;
  };
  http: {
    status_code: number;
    headers: Record<string, string>;
    agcdn_headers: { header: string; value: string; insight?: string }[];
    duration_ms: number;
    error?: string;
  };
  second_http?: {
    status_code: number;
    headers: Record<string, string>;
    agcdn_headers: { header: string; value: string; insight?: string }[];
    duration_ms: number;
    error?: string;
  };
  warmup?: {
    total_requests: number;
    hits: number;
    misses: number;
    hit_ratio: number;
    requests: { sequence: number; x_cache: string; status_code: number; duration_ms: number }[];
  };
  redirect_chain?: { url: string; status_code: number; location: string; duration_ms: number }[];
  dns_multi?: { resolver: string; label: string; a: string[]; aaaa: string[]; duration_ms: number; error?: string }[];
  tls: {
    protocol: string;
    cipher_suite?: string;
    cipher_security?: string;
    subject: string;
    issuer: string;
    valid_from: string;
    valid_to: string;
    sans: string[];
    duration_ms: number;
    error?: string;
  };
  insights: { severity: string; category: string; message: string }[];
  security?: {
    grade: string;
    score: number;
    headers: { name: string; present: boolean; value?: string; rating: string; description: string }[];
    cookies?: { name: string; secure: boolean; http_only: boolean; same_site: string; issues?: string[] }[];
  };
  email_auth?: {
    grade: string;
    spf: { found: boolean; record?: string; valid: boolean; lookups?: number; issues?: string[] };
    dkim: { found: boolean; note: string };
    dmarc: { found: boolean; record?: string; policy?: string; pct?: number; rua?: string; issues?: string[] };
  };
  pantheon?: {
    detected: boolean;
    cdn_tier?: string;
    cms?: string;
    cms_version?: string;
    environment?: string;
    site_uuid?: string;
    is_multidev: boolean;
    redis: boolean;
    new_relic: boolean;
    php_version?: string;
    plan_tier?: string;
  };
};

export type SubdomainResult = {
  domain: string;
  subdomains: string[];
  count: number;
  source: string;
  duration_ms: number;
  error?: string;
};
