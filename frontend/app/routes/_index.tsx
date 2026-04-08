import type { Route } from "./+types/_index";
import { useState, useEffect } from "react";
import { Form, useNavigation, Link } from "react-router";
import { Panel, Button, Callout } from "@pantheon-systems/pds-toolkit-react";
import SectionCard from "~/components/SectionCard";

const SITE_CHECK_API =
  process.env.SITE_CHECK_API_URL ||
  "https://api.site-check.ps-pantheon.com";

// Public API URL for client-side fetches (CORS enabled)
const CLIENT_API = "https://api.site-check.ps-pantheon.com";

/**
 * Pantheon infrastructure resolve targets — mirrors the `hurl` CLI flags.
 * When selected, the site-check API resolves the domain to this IP instead of DNS.
 */
const RESOLVE_TARGETS = [
  { value: "", label: "Default (DNS)", ip: "" },
  { value: "151.101.2.133", label: "AGCDN Legacy", ip: "151.101.2.133" },
  { value: "151.101.2.228", label: "AGCDN2 Custom Cert", ip: "151.101.2.228" },
  { value: "23.185.0.1", label: "FE1", ip: "23.185.0.1" },
  { value: "23.185.0.2", label: "FE2", ip: "23.185.0.2" },
  { value: "23.185.0.3", label: "FE3", ip: "23.185.0.3" },
  { value: "23.185.0.4", label: "FE4", ip: "23.185.0.4" },
  { value: "23.185.0.252", label: "FE252 (Canary)", ip: "23.185.0.252" },
  { value: "23.185.0.253", label: "FE253 (Canary)", ip: "23.185.0.253" },
  { value: "23.185.0.254", label: "FE254 (Canary)", ip: "23.185.0.254" },
] as const;

const BROWSER_USER_AGENTS = [
  { value: "", label: "Default (ps-site-check)" },
  { value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", label: "Chrome (Windows)" },
  { value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", label: "Chrome (macOS)" },
  { value: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36", label: "Chrome (Android)" },
  { value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0", label: "Firefox (Windows)" },
  { value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0", label: "Firefox (macOS)" },
  { value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15", label: "Safari (macOS)" },
  { value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1", label: "Safari (iPhone)" },
  { value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0", label: "Edge (Windows)" },
  { value: "Googlebot/2.1 (+http://www.google.com/bot.html)", label: "Googlebot" },
  { value: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)", label: "Bingbot" },
] as const;

type SiteCheckResult = {
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

type SubdomainResult = {
  domain: string;
  subdomains: string[];
  count: number;
  source: string;
  duration_ms: number;
  error?: string;
};

// -- Detection helpers --

function detectImageOptimization(headers: Record<string, string>) {
  const ioInfo = headers["fastly-io-info"];
  const ioApi = headers["x-fastly-imageopto-api"];
  if (ioInfo || ioApi) {
    return { detected: true, details: ioInfo || `API version: ${ioApi}` };
  }
  return { detected: false, details: "" };
}

function classifyCertificate(tls: SiteCheckResult["tls"]) {
  if (!tls || tls.error) return { label: "Unknown", color: "#666", description: "Could not determine certificate type" };
  const issuer = (tls.issuer || "").toLowerCase();
  if (issuer.includes("let's encrypt") || issuer.includes("letsencrypt") || /\b(r3|r10|r11|e1|e5|e6|e7)\b/i.test(issuer)) {
    return { label: "Let's Encrypt (Managed)", color: "#16a34a", description: "Pantheon-managed Let's Encrypt certificate -- auto-renewed" };
  }
  if (issuer.includes("globalsign")) {
    return { label: "Platform (GlobalSign)", color: "#2563eb", description: "Fastly platform certificate -- shared SAN" };
  }
  return { label: "Custom Certificate", color: "#7c3aed", description: "Customer-provided or third-party certificate" };
}

function detectPantheonSite(headers: Record<string, string>) {
  const pantheonHeaders: { header: string; value: string }[] = [];
  let isPantheon = false;
  let cms: string | undefined;
  let siteUuid: string | undefined;
  let environment: string | undefined;

  for (const [key, value] of Object.entries(headers)) {
    const lk = key.toLowerCase();
    if (
      lk.startsWith("x-pantheon-") ||
      lk.startsWith("x-styx-") ||
      lk === "x-drupal-cache" ||
      lk === "x-drupal-dynamic-cache"
    ) {
      pantheonHeaders.push({ header: key, value });
      isPantheon = true;
    }
  }

  if (headers["x-pantheon-site"]) siteUuid = headers["x-pantheon-site"];
  if (headers["x-pantheon-environment"]) environment = headers["x-pantheon-environment"];

  const xGenerator = headers["x-generator"] || "";
  const xDrupalCache = headers["x-drupal-cache"];
  if (xGenerator.toLowerCase().includes("wordpress")) {
    cms = "WordPress";
  } else if (xGenerator.toLowerCase().includes("drupal") || xDrupalCache) {
    cms = "Drupal";
  }

  return { isPantheon, pantheonHeaders, siteUuid, environment, cms };
}

// -- Loader --

export async function loader({ request }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams;
  const url = params.get("url");
  const resultId = params.get("id");

  // Permalink: fetch cached result by ID
  if (resultId) {
    try {
      const resp = await fetch(`${SITE_CHECK_API}/result/${resultId}`);
      if (!resp.ok) {
        return { result: null, error: "Result not found or expired", options: null };
      }
      const result: SiteCheckResult = await resp.json();
      return { result, error: null, options: null };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : "Unknown error", options: null };
    }
  }

  if (!url) {
    return { result: null, error: null, options: null };
  }

  const double = params.get("double") === "true";
  const follow = params.get("follow") === "true";
  const resolve = params.get("resolve") || "";
  const debug = params.get("debug") === "true";
  const fdebug = params.get("fdebug") === "true";
  const warmup = parseInt(params.get("warmup") || "0", 10) || 0;
  const clientIp = params.get("client_ip") || "";
  const userAgent = params.get("user_agent") || "";

  try {
    const apiURL = new URL(`${SITE_CHECK_API}/check`);
    apiURL.searchParams.set("url", url);
    if (double) apiURL.searchParams.set("double", "true");
    if (follow) apiURL.searchParams.set("follow", "true");
    if (resolve) apiURL.searchParams.set("resolve", resolve);
    if (debug) apiURL.searchParams.set("debug", "true");
    if (fdebug) apiURL.searchParams.set("fdebug", "true");
    if (warmup >= 2) apiURL.searchParams.set("warmup", String(warmup));
    if (clientIp) apiURL.searchParams.set("client_ip", clientIp);
    if (userAgent) apiURL.searchParams.set("user_agent", userAgent);

    // Server-side: only fetch the core check (fast ~300ms)
    // SEO, Lighthouse, Subdomains load client-side on demand
    const checkResp = await fetch(apiURL.toString());

    if (!checkResp.ok) {
      return { result: null, error: `API returned ${checkResp.status}`, options: null };
    }

    const result: SiteCheckResult = await checkResp.json();
    const resolveLabel = RESOLVE_TARGETS.find((t) => t.value === resolve)?.label || "";

    return {
      result,
      error: null,
      options: { resolve, resolveLabel, debug, fdebug, warmup, clientIp, userAgent },
    };
  } catch (e) {
    return {
      result: null,
      error: e instanceof Error ? e.message : "Unknown error",
      options: null,
      subdomains: null,
    };
  }
}

// -- Main component --

export default function Check({ loaderData }: Route.ComponentProps) {
  const { result, error, options } = loaderData;
  const navigation = useNavigation();
  const isChecking = navigation.state === "loading";

  // Load reCAPTCHA v3 script dynamically (if configured on API)
  useEffect(() => {
    fetch(`${CLIENT_API}/models`)
      .then(r => r.json())
      .then(data => {
        const siteKey = data.recaptcha_site_key;
        if (siteKey && !document.getElementById("recaptcha-script")) {
          (window as any).__RECAPTCHA_SITE_KEY = siteKey;
          const script = document.createElement("script");
          script.id = "recaptcha-script";
          script.src = `https://www.google.com/recaptcha/api.js?render=${siteKey}`;
          script.async = true;
          document.head.appendChild(script);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <>
      <Panel className="pds-spacing-mar-block-end-l">
        <Form method="get">
          {/* Primary row: URL + Resolve + Check button */}
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "250px" }}>
              <label htmlFor="url-input" style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}>
                Domain or URL
              </label>
              <input
                id="url-input"
                name="url"
                type="text"
                placeholder="example.com"
                defaultValue={result?.url?.replace(/^https?:\/\//, "") || ""}
                required
                className="pds-input"
                style={{ width: "100%", padding: "0.6rem 0.75rem", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", fontSize: "0.95rem" }}
              />
            </div>
            <div style={{ minWidth: "180px" }}>
              <label htmlFor="resolve-select" style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.25rem" }}>
                Resolve Target
              </label>
              <select id="resolve-select" name="resolve" className="pds-input"
                defaultValue={options?.resolve || ""} style={{ width: "100%", padding: "0.5rem 0.75rem" }}>
                {RESOLVE_TARGETS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}{t.ip ? ` (${t.ip})` : ""}</option>
                ))}
              </select>
            </div>
            <Button label={isChecking ? "Checking..." : "Check"} buttonType="submit" variant="brand" disabled={isChecking} />
          </div>

          {/* Quick toggles */}
          <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.75rem", fontSize: "0.85rem", color: "#555" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
              <input type="checkbox" name="follow" value="true" defaultChecked /> Follow redirects
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
              <input type="checkbox" name="double" value="true" /> Cache test
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.3rem" }} title="Pantheon-Debug: 1">
              <input type="checkbox" name="debug" value="true" defaultChecked={options ? options.debug : true} /> Pantheon Debug
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.3rem" }} title="Fastly-Debug: 1">
              <input type="checkbox" name="fdebug" value="true" defaultChecked={options ? options.fdebug : true} /> Fastly Debug
            </label>
          </div>

          {/* Advanced options — collapsed by default */}
          <details style={{ marginTop: "0.75rem" }}>
            <summary style={{ cursor: "pointer", fontSize: "0.85rem", fontWeight: 600, color: "#4f46e5" }}>
              Advanced Options
            </summary>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap", marginTop: "0.5rem", padding: "0.75rem", background: "#f9fafb", borderRadius: "6px" }}>
              <div style={{ minWidth: "100px", maxWidth: "130px" }}>
                <label htmlFor="warmup-input" style={{ display: "block", fontWeight: 600, fontSize: "0.8rem", marginBottom: "0.25rem" }}>
                  Warmup
                </label>
                <input id="warmup-input" name="warmup" type="number" min="0" max="20" placeholder="0"
                  defaultValue={options?.warmup || ""} className="pds-input" style={{ width: "100%", padding: "0.4rem 0.6rem" }} />
              </div>
              <div style={{ minWidth: "140px", maxWidth: "180px" }}>
                <label htmlFor="client-ip-input" style={{ display: "block", fontWeight: 600, fontSize: "0.8rem", marginBottom: "0.25rem" }}>
                  Client IP
                </label>
                <input id="client-ip-input" name="client_ip" type="text" placeholder="203.0.113.1"
                  defaultValue={options?.clientIp || ""} className="pds-input" style={{ width: "100%", padding: "0.4rem 0.6rem" }} />
              </div>
              <div style={{ minWidth: "160px", maxWidth: "200px" }}>
                <label htmlFor="user-agent-select" style={{ display: "block", fontWeight: 600, fontSize: "0.8rem", marginBottom: "0.25rem" }}>
                  User-Agent
                </label>
                <select id="user-agent-select" name="user_agent" className="pds-input"
                  defaultValue={options?.userAgent || ""} style={{ width: "100%", padding: "0.4rem 0.6rem" }}>
                  {BROWSER_USER_AGENTS.map((b) => (
                    <option key={b.label} value={b.value}>{b.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </details>
        </Form>
      </Panel>

      {isChecking && (
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <div style={{ margin: "0 auto 1rem" }}>
            <svg viewBox="0 0 50 50" width="40" height="40">
              <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeWidth="4" strokeDasharray="90 60" strokeLinecap="round">
                <animateTransform attributeName="transform" type="rotate" dur="0.8s" from="0 25 25" to="360 25 25" repeatCount="indefinite" />
              </circle>
            </svg>
          </div>
          <p style={{ color: "#666" }}>Checking site...</p>
        </div>
      )}

      {error && (
        <Callout type="critical" title="Check failed">
          <p>{error}</p>
        </Callout>
      )}

      {result && !isChecking && <CheckResults result={result} options={options} />}
    </>
  );
}

// -- Results (tabbed layout) --

type CheckOptions = { resolve: string; resolveLabel: string; debug: boolean; fdebug: boolean; warmup: number; clientIp: string; userAgent: string } | null;

function CheckResults({ result, options }: { result: SiteCheckResult; options?: CheckOptions }) {
  const permalinkURL = `/?id=${result.id}`;
  const resolveIP = options?.resolve || result.resolve_ip || "";
  const resolveLabel = resolveIP
    ? (RESOLVE_TARGETS.find((t) => t.value === resolveIP)?.label || "Custom IP")
    : "";
  const hasOverride = !!resolveIP;
  const hasDebug = options && (options.debug || options.fdebug || options.clientIp || options.warmup || options.userAgent);

  const headers = result.http?.headers || {};
  const io = detectImageOptimization(headers);
  const cert = classifyCertificate(result.tls);
  const pantheon = detectPantheonSite(headers);

  // Client-side: load SEO and Lighthouse in background
  const [seo, setSeo] = useState<any>(null);
  const [seoLoading, setSeoLoading] = useState(true);
  const [lhMobile, setLhMobile] = useState<any>(null);
  const [lhDesktop, setLhDesktop] = useState<any>(null);
  const [lhMobileLoading, setLhMobileLoading] = useState(true);
  const [lhDesktopLoading, setLhDesktopLoading] = useState(true);
  const [subdomains, setSubdomains] = useState<SubdomainResult | null>(null);
  const [subLoading, setSubLoading] = useState(false);

  const domain = result.url.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];

  const discoverSubdomains = async () => {
    setSubLoading(true);
    try {
      const resp = await fetch(`${CLIENT_API}/subdomains?domain=${encodeURIComponent(domain)}`);
      if (resp.ok) setSubdomains(await resp.json());
    } catch { /* ignore */ }
    setSubLoading(false);
  };

  useEffect(() => {
    const lhUrl = `${CLIENT_API}/lighthouse?url=${encodeURIComponent("https://" + domain)}`;

    // SEO audit (fast, ~1-2s)
    fetch(`${CLIENT_API}/seo?url=${encodeURIComponent(domain)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { setSeo(data); setSeoLoading(false); })
      .catch(() => setSeoLoading(false));

    // Lighthouse — run mobile + desktop in parallel
    fetch(`${lhUrl}&strategy=mobile`)
      .then(r => r.json())
      .then(data => { setLhMobile(data); setLhMobileLoading(false); })
      .catch(() => setLhMobileLoading(false));

    fetch(`${lhUrl}&strategy=desktop`)
      .then(r => r.json())
      .then(data => { setLhDesktop(data); setLhDesktopLoading(false); })
      .catch(() => setLhDesktopLoading(false));
  }, [domain]);

  // Use mobile as the primary for score dashboard; either for AI analysis
  const lighthouse = lhMobile || lhDesktop;
  const lhLoading = lhMobileLoading && lhDesktopLoading;

  const gradeColor = (grade: string) => grade <= "B" ? "#16a34a" : grade <= "C" ? "#ca8a04" : "#dc2626";
  const scoreColor = (score: number) => score >= 80 ? "#16a34a" : score >= 50 ? "#ca8a04" : "#dc2626";
  const errors = result.insights.filter(i => i.severity === "error");
  const warnings = result.insights.filter(i => i.severity === "warning");
  const infos = result.insights.filter(i => i.severity === "info");
  const domainHost = result.url.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];

  return (
    <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {/* ── Score Dashboard ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "0.5rem" }}>
        {[
          { label: "HTTP", value: result.http?.status_code || "\u2014", color: result.http?.status_code && result.http.status_code < 300 ? "var(--color-success)" : result.http?.status_code && result.http.status_code < 400 ? "var(--color-warning)" : "var(--color-danger)" },
          { label: "Security", value: result.security?.grade || "\u2014", color: result.security ? gradeColor(result.security.grade) : "var(--color-text-muted)" },
          { label: "SEO", value: seo?.score ?? (seoLoading ? "\u2026" : "\u2014"), color: seo ? scoreColor(seo.score) : "var(--color-text-muted)" },
          { label: "Performance", value: lighthouse?.performance ?? (lhLoading ? "\u2026" : "\u2014"), color: lighthouse?.performance ? scoreColor(lighthouse.performance) : "var(--color-text-muted)" },
          { label: "Email", value: result.email_auth?.grade || "\u2014", color: result.email_auth ? gradeColor(result.email_auth.grade) : "var(--color-text-muted)" },
          { label: "Pantheon", value: pantheon.isPantheon ? "\u2713" : "\u2717", color: pantheon.isPantheon ? "var(--color-primary)" : "var(--color-text-muted)" },
        ].map((s, i) => (
          <div key={i} className="score-card">
            <div className="score-card__value" style={{ color: s.color }}>{s.value}</div>
            <div className="score-card__label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Context line ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.75rem", color: "var(--color-text-muted)", padding: "0 0.25rem" }}>
        <span>
          <strong style={{ color: "var(--color-text-secondary)" }}>{result.url}</strong>
          <span style={{ margin: "0 0.3rem" }}>&middot;</span>{result.duration_ms}ms
          {result.tls?.protocol && <><span style={{ margin: "0 0.3rem" }}>&middot;</span>{result.tls.protocol}</>}
          {cert.label !== "Unknown" && <><span style={{ margin: "0 0.3rem" }}>&middot;</span>{cert.label}</>}
          {pantheon.cms && <><span style={{ margin: "0 0.3rem" }}>&middot;</span>{pantheon.cms}</>}
        </span>
        <span><Link to={permalinkURL} style={{ color: "var(--color-text-muted)" }}>Permalink</Link> &middot; <code style={{ fontSize: "0.7rem" }}>{result.id}</code></span>
      </div>

      {/* ── Insights ── */}
      {result.insights.length > 0 && (
        <div className="section-card" style={{ padding: "0.75rem 1rem" }}>
          <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.82rem", color: "var(--color-text)", fontWeight: 600 }}>
            Insights
            <span style={{ fontWeight: 400, color: "var(--color-text-muted)", marginLeft: "0.35rem" }}>({result.insights.length})</span>
          </h4>
          {errors.length > 0 && (
            <div style={{ marginBottom: "0.5rem" }}>
              <div style={{ fontSize: "0.6rem", fontWeight: 700, textTransform: "uppercase", color: "var(--color-danger)", marginBottom: "0.2rem", letterSpacing: "0.05em" }}>
                Critical ({errors.length})
              </div>
              {errors.map((insight, i) => <InsightRow key={`e${i}`} insight={insight} />)}
            </div>
          )}
          {warnings.length > 0 && (
            <div style={{ marginBottom: "0.5rem" }}>
              <div style={{ fontSize: "0.6rem", fontWeight: 700, textTransform: "uppercase", color: "var(--color-warning)", marginBottom: "0.2rem", letterSpacing: "0.05em" }}>
                Warnings ({warnings.length})
              </div>
              {warnings.map((insight, i) => <InsightRow key={`w${i}`} insight={insight} />)}
            </div>
          )}
          {infos.length > 0 && (
            <details>
              <summary style={{ fontSize: "0.6rem", fontWeight: 700, textTransform: "uppercase", color: "var(--color-info)", cursor: "pointer", letterSpacing: "0.05em" }}>
                Info ({infos.length})
              </summary>
              <div style={{ marginTop: "0.25rem" }}>
                {infos.map((insight, i) => <InsightRow key={`i${i}`} insight={insight} />)}
              </div>
            </details>
          )}
        </div>
      )}

      {/* ── AI Analysis ── */}
      <AIAnalysisPanel result={result} seo={seo} lighthouse={lighthouse} />

      {/* ── Sections ── */}

      <SectionCard id="sec-perf" title="Performance"
        status={lighthouse?.performance ? (lighthouse.performance >= 80 ? "good" : lighthouse.performance >= 50 ? "warning" : "problem") : lhLoading ? "loading" : "neutral"}
        score={lighthouse?.performance != null ? { value: lighthouse.performance, color: scoreColor(lighthouse.performance) } : undefined}
        summary={lighthouse ? `FCP ${lighthouse.fcp || "\u2014"} \u00b7 LCP ${lighthouse.lcp || "\u2014"} \u00b7 ${lighthouse.total_requests || 0} requests` : undefined}
        loading={lhMobileLoading && lhDesktopLoading} loadingMessage="Running Lighthouse audits (mobile + desktop)...">
        <LighthouseStrategyTabs mobile={lhMobile} desktop={lhDesktop} mobileLoading={lhMobileLoading} desktopLoading={lhDesktopLoading} />
      </SectionCard>

      <SectionCard id="sec-seo" title="SEO"
        status={seo?.score ? (seo.score >= 80 ? "good" : seo.score >= 50 ? "warning" : "problem") : seoLoading ? "loading" : "neutral"}
        score={seo?.score != null ? { value: seo.score, color: scoreColor(seo.score) } : undefined}
        summary={seo ? `Title: ${seo.title?.rating || "\u2014"} \u00b7 Sitemap: ${seo.sitemap?.found ? "\u2713" : "\u2717"} \u00b7 ${seo.issues?.length || 0} issues` : undefined}
        loading={seoLoading} loadingMessage="Running SEO audit...">
        {seo && <SEOTab seo={seo} />}
      </SectionCard>

      {result.security && (
        <SectionCard id="sec-security" title="Security"
          status={result.security.score >= 70 ? "good" : result.security.score >= 40 ? "warning" : "problem"}
          score={{ value: result.security.grade, color: gradeColor(result.security.grade) }}
          summary={`${result.security.score}/100 \u00b7 ${result.security.headers.filter(h => h.present).length}/${result.security.headers.length} headers present`}>
          <SecurityTab security={result.security} />
        </SectionCard>
      )}

      <SectionCard id="sec-infra" title="Infrastructure"
        status={pantheon.isPantheon ? "good" : "neutral"}
        score={pantheon.isPantheon ? { value: "\u2713", color: "var(--color-primary)" } : undefined}
        summary={`${result.dns?.a?.[0] || "\u2014"} \u00b7 ${result.tls?.protocol || "\u2014"} \u00b7 ${cert.label}${pantheon.isPantheon ? ` \u00b7 ${result.pantheon?.cdn_tier || "Pantheon"}` : ""}`}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <DnsTab result={result} />
          <TlsTab result={result} cert={cert} />
          {pantheon.isPantheon && <PantheonTab result={result} pantheon={pantheon} />}
        </div>
      </SectionCard>

      {result.email_auth && (
        <SectionCard id="sec-email" title="Email Authentication"
          status={result.email_auth.grade <= "B" ? "good" : result.email_auth.grade <= "C" ? "warning" : "problem"}
          score={{ value: result.email_auth.grade, color: gradeColor(result.email_auth.grade) }}
          summary={`SPF: ${result.email_auth.spf.found ? "\u2713" : "\u2717"} \u00b7 DMARC: ${result.email_auth.dmarc.found ? result.email_auth.dmarc.policy || "\u2713" : "\u2717"}`}>
          <EmailAuthTab emailAuth={result.email_auth} />
        </SectionCard>
      )}

      <SectionCard id="sec-response" title="Response Details"
        score={result.http?.agcdn_headers?.length ? { value: result.http.agcdn_headers.length, color: "var(--color-text-secondary)" } : undefined}
        summary={`${result.http?.status_code || "\u2014"} \u00b7 ${Object.keys(result.http?.headers || {}).length} headers \u00b7 ${result.http?.duration_ms || 0}ms`}>
        <ResponseTab result={result} io={io} />
      </SectionCard>

      {/* ── Advanced Tools (grouped) ── */}
      <div style={{ marginTop: "0.5rem" }}>
        <div style={{ fontSize: "0.65rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-muted)", marginBottom: "0.4rem", paddingLeft: "0.25rem" }}>
          Advanced Tools
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <SectionCard id="sec-subdomains" title="Subdomains"
            score={subdomains?.count ? { value: subdomains.count, color: "var(--color-text-secondary)" } : undefined}
            summary={subdomains?.count ? `${subdomains.count} found via ${subdomains.source}` : "Uses SecurityTrails / CT logs"}
            loading={subLoading} loadingMessage="Discovering subdomains...">
            {subdomains ? (
              <SubdomainsTab subdomains={subdomains} />
            ) : (
              <div style={{ textAlign: "center", padding: "1rem" }}>
                <p style={{ fontSize: "0.82rem", color: "var(--color-text-muted)", marginBottom: "0.75rem" }}>
                  Discover subdomains via SecurityTrails or Certificate Transparency logs.
                </p>
                <button
                  onClick={discoverSubdomains}
                  style={{
                    padding: "0.4rem 1rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)",
                    background: "var(--color-bg)", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600, color: "var(--color-primary)",
                  }}
                >
                  Discover Subdomains
                </button>
              </div>
            )}
          </SectionCard>

          <SectionCard id="sec-agcdn" title="AGCDN Probe" summary="Active feature detection (WAF, IO, Rate Limiting)">
            <AGCDNProbeTab domain={domainHost} />
          </SectionCard>

          <SectionCard id="sec-bot" title="Bot Protection" summary="Challenge page and cookie detection">
            <BotProtectionTab domain={domainHost} />
          </SectionCard>

          <SectionCard id="sec-resources" title="Resources" summary="Broken CSS, JS, and image audit">
            <ResourceAuditTab url={result.url} />
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

// -- AI Analysis Panel --

type AIAnalysis = {
  summary: string;
  findings: string[];
  next_steps: string[];
  risk: string;
  raw: string;
  duration_ms: number;
  error: string;
};

const AI_MODELS = [
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", cost: "~$0.001" },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", cost: "~$0.014" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", cost: "~$0.024" },
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", cost: "~$0.12" },
];

function AIAnalysisPanel({ result, seo, lighthouse }: { result: SiteCheckResult; seo?: any; lighthouse?: any }) {
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState("gemini-2.5-flash");

  const handleAnalyze = async () => {
    setLoading(true);
    setAnalysis(null);
    try {
      // Get reCAPTCHA token if available
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (typeof window !== "undefined" && (window as any).grecaptcha) {
        try {
          const token = await (window as any).grecaptcha.execute(
            (window as any).__RECAPTCHA_SITE_KEY,
            { action: "analyze" }
          );
          headers["X-Recaptcha-Token"] = token;
        } catch { /* reCAPTCHA not loaded, continue without */ }
      }

      const resp = await fetch(`${CLIENT_API}/analyze`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          mode: "check",
          model: selectedModel,
          check: result,
          seo: seo || undefined,
          lighthouse: lighthouse || undefined,
        }),
      });
      const data = await resp.json();
      setAnalysis(data);
    } catch (e) {
      setAnalysis({ summary: "", findings: [], next_steps: [], risk: "", model: "", duration_ms: 0, error: e instanceof Error ? e.message : "Unknown error" });
    }
    setLoading(false);
  };

  const riskColor = (risk: string) => {
    switch (risk) {
      case "low": return "#16a34a";
      case "medium": return "#ca8a04";
      case "high": return "#dc2626";
      default: return "#666";
    }
  };

  if (!analysis && !loading) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
        padding: "0.5rem 0.75rem", borderRadius: "8px", border: "1px solid #e5e7eb", background: "#fff",
      }}>
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          style={{
            padding: "0.35rem 0.4rem", borderRadius: "4px", border: "1px solid #ddd",
            fontSize: "0.75rem", color: "#555", background: "#f9fafb", maxWidth: "160px",
          }}
        >
          {AI_MODELS.map(m => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <button
          onClick={handleAnalyze}
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.4rem",
            padding: "0.4rem 1rem", borderRadius: "6px", border: "none",
            background: "#4f46e5", color: "#fff",
            cursor: "pointer", fontSize: "0.8rem", fontWeight: 600,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5v1h-4v-1C8.8 8.8 8 7.5 8 6a4 4 0 0 1 4-4z"/>
            <path d="M10 14h4"/><path d="M10 18h4"/><path d="M11 22h2"/>
          </svg>
          Analyze with AI
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "1.5rem", marginBottom: "1rem", background: "#f9fafb", borderRadius: "8px" }}>
        <svg viewBox="0 0 50 50" width="28" height="28" style={{ margin: "0 auto" }}>
          <circle cx="25" cy="25" r="20" fill="none" stroke="#4f46e5" strokeWidth="4" strokeDasharray="90 60" strokeLinecap="round">
            <animateTransform attributeName="transform" type="rotate" dur="0.8s" from="0 25 25" to="360 25 25" repeatCount="indefinite" />
          </circle>
        </svg>
        <p style={{ color: "#666", fontSize: "0.85rem", marginTop: "0.5rem" }}>Analyzing with {AI_MODELS.find(m => m.id === selectedModel)?.name || "AI"}...</p>
      </div>
    );
  }

  if (analysis?.error) {
    return (
      <Callout type="warning" title="AI Analysis Error" className="pds-spacing-mar-block-end-l">
        <p>{analysis.error}</p>
      </Callout>
    );
  }

  if (!analysis) return null;

  return (
    <div className="ai-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <h4 style={{ margin: 0, fontSize: "0.95rem", color: "#4f46e5" }}>AI Analysis</h4>
          {analysis.model && <span style={{ fontSize: "0.7rem", color: "#999", background: "#f3f4f6", padding: "0.1rem 0.4rem", borderRadius: "3px" }}>{analysis.model}</span>}
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          {analysis.risk && (
            <Badge color={riskColor(analysis.risk)} label={`Risk: ${analysis.risk}`} />
          )}
          <span style={{ fontSize: "0.7rem", color: "#aaa" }}>{(analysis.duration_ms / 1000).toFixed(1)}s</span>
        </div>
      </div>

      {analysis.summary && (
        <p style={{ fontSize: "0.9rem", color: "#333", lineHeight: 1.5, margin: "0 0 0.75rem" }}>
          {analysis.summary}
        </p>
      )}

      {analysis.findings && analysis.findings.length > 0 && (
        <div style={{ marginBottom: "0.75rem" }}>
          <h5 style={{ margin: "0 0 0.35rem", fontSize: "0.7rem", textTransform: "uppercase", color: "#888", letterSpacing: "0.05em" }}>
            Findings ({analysis.findings.length})
          </h5>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            {analysis.findings.map((f, i) => {
              const isCritical = f.startsWith("CRITICAL:") || /critical|score of \d|grade.?f\b|severe/i.test(f.toLowerCase());
              const isWarning = f.startsWith("WARNING:") || /warning|leaky|insufficient|weak|expir/i.test(f.toLowerCase());
              const cls = isCritical ? "ai-finding--critical" : isWarning ? "ai-finding--warning" : "ai-finding--info";
              let displayText = f;
              if (f.startsWith("CRITICAL: ")) displayText = f.slice(10);
              else if (f.startsWith("WARNING: ")) displayText = f.slice(9);
              return (
                <div key={i} className={`ai-finding ${cls}`} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
                  {isCritical && <span className="insight-row__category" style={{ color: "var(--color-danger)" }}>CRITICAL</span>}
                  {isWarning && !isCritical && <span className="insight-row__category" style={{ color: "var(--color-warning)" }}>WARNING</span>}
                  <RenderMarkdown text={displayText} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {analysis.next_steps && analysis.next_steps.length > 0 && (
        <div>
          <h5 style={{ margin: "0 0 0.35rem", fontSize: "0.7rem", textTransform: "uppercase", color: "#888", letterSpacing: "0.05em" }}>
            Next Steps ({analysis.next_steps.length})
          </h5>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            {analysis.next_steps.map((s, i) => (
              <div key={i} className="ai-step">
                <span style={{ fontWeight: 700, color: "var(--color-success)", flexShrink: 0 }}>{i + 1}.</span>
                <RenderMarkdown text={s} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Re-analyze with different model */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.75rem", paddingTop: "0.5rem", borderTop: "1px solid #e8e8f0" }}>
        <span style={{ fontSize: "0.75rem", color: "#999" }}>Re-analyze:</span>
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          style={{ padding: "0.2rem 0.4rem", borderRadius: "3px", border: "1px solid #ddd", fontSize: "0.75rem", color: "#555" }}
        >
          {AI_MODELS.map(m => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <button
          onClick={handleAnalyze}
          disabled={loading}
          style={{
            padding: "0.2rem 0.6rem", borderRadius: "4px", border: "none",
            background: "#4f46e5", color: "#fff", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600,
          }}
        >
          {loading ? "..." : "Re-analyze"}
        </button>
      </div>
    </div>
  );
}

// -- Tab: Response --

function ResponseTab({
  result,
  io,
}: {
  result: SiteCheckResult;
  io: { detected: boolean; details: string };
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", paddingTop: "1rem" }}>
      {/* Redirect Chain */}
      {result.redirect_chain && result.redirect_chain.length > 0 && (
        <Panel>
          <h4>Redirect Chain</h4>
          <table className="pds-table">
            <thead>
              <tr>
                <th>Step</th>
                <th>Status</th>
                <th>URL</th>
                <th>Location</th>
                <th>Time (ms)</th>
              </tr>
            </thead>
            <tbody>
              {result.redirect_chain.map((hop, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td><StatusBadge code={hop.status_code} /></td>
                  <td style={{ wordBreak: "break-all", fontSize: "0.85rem" }}>{hop.url}</td>
                  <td style={{ wordBreak: "break-all", fontSize: "0.85rem" }}>{hop.location || "\u2014"}</td>
                  <td>{hop.duration_ms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {/* AGCDN Headers */}
      {result.http?.agcdn_headers && result.http.agcdn_headers.length > 0 && (
        <Panel>
          <h4>AGCDN Headers</h4>
          <table className="pds-table">
            <thead>
              <tr>
                <th style={{ width: "20%" }}>Header</th>
                <th style={{ width: "35%" }}>Value</th>
                <th style={{ width: "45%" }}>Insight</th>
              </tr>
            </thead>
            <tbody>
              {result.http.agcdn_headers.map((h, i) => (
                <tr key={i}>
                  <td><code style={{ fontSize: "0.8rem" }}>{h.header}</code></td>
                  <td style={{ wordBreak: "break-all", fontSize: "0.85rem", maxWidth: "300px" }}>
                    {truncateValue(h.value, 200)}
                  </td>
                  <td style={{ fontSize: "0.85rem", color: "#555" }}>{h.insight || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {/* Image Optimization */}
      <Panel>
        <h4>Image Optimization (Fastly IO)</h4>
        {io.detected ? (
          <>
            <Callout type="info" title="IO Enabled">
              <p>Fastly Image Optimization is active on this response.</p>
            </Callout>
            <table className="pds-table" style={{ marginTop: "0.75rem" }}>
              <tbody>
                <tr>
                  <td style={{ fontWeight: 600 }}>IO Info</td>
                  <td style={{ wordBreak: "break-all", fontSize: "0.85rem" }}>{io.details}</td>
                </tr>
              </tbody>
            </table>
          </>
        ) : (
          <Callout type="warning" title="IO Not Detected">
            <p>
              No Fastly IO headers found on this response. IO headers (<code>fastly-io-info</code>,{" "}
              <code>x-fastly-imageopto-api</code>) only appear on <strong>image responses</strong>.
              To verify IO status, check an actual image URL from the site (e.g.,{" "}
              <code>example.com/sites/default/files/image.jpg</code>).
            </p>
          </Callout>
        )}
      </Panel>

      {/* Warmup Test */}
      {result.warmup && (
        <Panel>
          <h4>Cache Warmup Test</h4>
          <p style={{ color: "#666", fontSize: "0.85rem" }}>
            {result.warmup.total_requests} sequential requests \u2014 hit ratio:{" "}
            <strong>{(result.warmup.hit_ratio * 100).toFixed(0)}%</strong>{" "}
            ({result.warmup.hits} hits, {result.warmup.misses} misses)
          </p>
          <table className="pds-table">
            <thead>
              <tr>
                <th>#</th>
                <th>X-Cache</th>
                <th>Status</th>
                <th>Time (ms)</th>
              </tr>
            </thead>
            <tbody>
              {result.warmup.requests.map((r) => (
                <tr key={r.sequence}>
                  <td>{r.sequence}</td>
                  <td>
                    <code style={{ color: r.x_cache === "HIT" ? "#16a34a" : r.x_cache === "MISS" ? "#dc2626" : "#666" }}>
                      {r.x_cache || "\u2014"}
                    </code>
                  </td>
                  <td><StatusBadge code={r.status_code} /></td>
                  <td>{r.duration_ms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {/* Cache Test */}
      {result.second_http && (
        <Panel>
          <h4>Cache Test (Double Request)</h4>
          <p style={{ color: "#666", fontSize: "0.85rem" }}>
            Second request made after 2-second delay to verify caching behavior.
          </p>
          <table className="pds-table">
            <thead>
              <tr>
                <th>Request</th>
                <th>Status</th>
                <th>X-Cache</th>
                <th>Age</th>
                <th>Time (ms)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>1st</strong></td>
                <td><StatusBadge code={result.http?.status_code} /></td>
                <td><code>{result.http?.headers?.["x-cache"] || "\u2014"}</code></td>
                <td>{result.http?.headers?.["age"] || "\u2014"}</td>
                <td>{result.http?.duration_ms}</td>
              </tr>
              <tr>
                <td><strong>2nd</strong></td>
                <td><StatusBadge code={result.second_http.status_code} /></td>
                <td><code>{result.second_http.headers?.["x-cache"] || "\u2014"}</code></td>
                <td>{result.second_http.headers?.["age"] || "\u2014"}</td>
                <td>{result.second_http.duration_ms}</td>
              </tr>
            </tbody>
          </table>
        </Panel>
      )}

      {/* All Response Headers */}
      <Panel>
        <details>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>
            All Response Headers ({Object.keys(result.http?.headers || {}).length})
          </summary>
          <table className="pds-table" style={{ marginTop: "0.75rem" }}>
            <thead>
              <tr>
                <th style={{ width: "25%" }}>Header</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(result.http?.headers || {})
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, value], i) => (
                  <tr key={i}>
                    <td><code style={{ fontSize: "0.8rem" }}>{key}</code></td>
                    <td style={{ wordBreak: "break-all", fontSize: "0.85rem", maxWidth: "500px" }}>
                      {truncateValue(value, 300)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </details>
      </Panel>
    </div>
  );
}

// -- Tab: DNS --

function DnsTab({ result }: { result: SiteCheckResult }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", paddingTop: "1rem" }}>
      <Panel>
        <h4>DNS Resolution</h4>
        {result.dns?.error ? (
          <Callout type="critical" title="DNS Error">
            <p>{result.dns.error}</p>
          </Callout>
        ) : (
          <table className="pds-table">
            <thead>
              <tr>
                <th>A (IPv4)</th>
                <th>AAAA (IPv6)</th>
                <th>CNAME</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{result.dns?.a?.map((ip, i) => <div key={i}>{ip}</div>) || "\u2014"}</td>
                <td>{result.dns?.aaaa?.map((ip, i) => <div key={i}>{ip}</div>) || "\u2014"}</td>
                <td>
                  {result.dns?.cname?.length
                    ? result.dns.cname.map((c, i) => <div key={i}>{c}</div>)
                    : "\u2014"}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </Panel>

      {/* MX, NS, TXT Records */}
      {!result.dns?.error && (result.dns?.mx?.length || result.dns?.ns?.length || result.dns?.txt?.length) && (
        <Panel>
          <h4>Additional DNS Records</h4>
          <table className="pds-table">
            <thead>
              <tr>
                <th style={{ width: "15%" }}>Type</th>
                <th>Records</th>
              </tr>
            </thead>
            <tbody>
              {result.dns.ns && result.dns.ns.length > 0 && (
                <tr>
                  <td style={{ fontWeight: 600 }}>NS</td>
                  <td style={{ fontSize: "0.85rem" }}>
                    {result.dns.ns.map((ns, i) => <div key={i}>{ns}</div>)}
                  </td>
                </tr>
              )}
              {result.dns.mx && result.dns.mx.length > 0 && (
                <tr>
                  <td style={{ fontWeight: 600 }}>MX</td>
                  <td style={{ fontSize: "0.85rem" }}>
                    {result.dns.mx.map((mx, i) => (
                      <div key={i}>{mx.priority} {mx.host}</div>
                    ))}
                  </td>
                </tr>
              )}
              {result.dns.txt && result.dns.txt.length > 0 && (
                <tr>
                  <td style={{ fontWeight: 600 }}>TXT</td>
                  <td style={{ fontSize: "0.85rem" }}>
                    <details>
                      <summary style={{ cursor: "pointer" }}>
                        {result.dns.txt.length} record{result.dns.txt.length !== 1 ? "s" : ""}
                      </summary>
                      <div style={{ marginTop: "0.5rem" }}>
                        {result.dns.txt.map((txt, i) => (
                          <div key={i} style={{ wordBreak: "break-all", marginBottom: "0.25rem", padding: "0.25rem 0", borderBottom: "1px solid #eee" }}>
                            <code style={{ fontSize: "0.8rem" }}>{txt}</code>
                          </div>
                        ))}
                      </div>
                    </details>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Panel>
      )}

      {result.dns_multi && result.dns_multi.length > 0 && (
        <Panel>
          <h4>DNS Multi-Resolver Comparison</h4>
          <table className="pds-table">
            <thead>
              <tr>
                <th>Resolver</th>
                <th>A (IPv4)</th>
                <th>AAAA (IPv6)</th>
                <th>Time (ms)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {result.dns_multi.map((r, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600, fontSize: "0.85rem" }}>{r.label}</td>
                  <td style={{ fontSize: "0.85rem" }}>{r.error ? "\u2014" : r.a?.join(", ") || "\u2014"}</td>
                  <td style={{ fontSize: "0.85rem" }}>{r.error ? "\u2014" : r.aaaa?.join(", ") || "\u2014"}</td>
                  <td>{r.duration_ms}</td>
                  <td>{r.error ? <span style={{ color: "#dc2626" }}>{r.error}</span> : "OK"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

// -- Tab: TLS Certificate --

function TlsTab({
  result,
  cert,
}: {
  result: SiteCheckResult;
  cert: { label: string; color: string; description: string };
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", paddingTop: "1rem" }}>
      <Panel>
        <h4>Certificate Type</h4>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
          <Badge color={cert.color} label={cert.label} />
        </div>
        <p style={{ color: "#666", fontSize: "0.85rem", margin: 0 }}>{cert.description}</p>
      </Panel>

      <Panel>
        <h4>Certificate Details</h4>
        {result.tls?.error ? (
          <Callout type="critical" title="TLS Error">
            <p>{result.tls.error}</p>
          </Callout>
        ) : (
          <table className="pds-table">
            <tbody>
              <tr><td style={{ fontWeight: 600, width: "20%" }}>Subject</td><td>{result.tls?.subject}</td></tr>
              <tr><td style={{ fontWeight: 600 }}>Issuer</td><td>{result.tls?.issuer}</td></tr>
              <tr><td style={{ fontWeight: 600 }}>Protocol</td><td>{result.tls?.protocol}</td></tr>
              {result.tls?.cipher_suite && (
                <tr>
                  <td style={{ fontWeight: 600 }}>Cipher Suite</td>
                  <td>
                    <code style={{ fontSize: "0.85rem" }}>{result.tls.cipher_suite}</code>{" "}
                    {result.tls.cipher_security && (
                      <Badge
                        color={
                          result.tls.cipher_security === "recommended" ? "#16a34a"
                            : result.tls.cipher_security === "secure" ? "#2563eb"
                              : result.tls.cipher_security === "weak" ? "#ca8a04"
                                : "#dc2626"
                        }
                        label={result.tls.cipher_security}
                      />
                    )}
                  </td>
                </tr>
              )}
              <tr>
                <td style={{ fontWeight: 600 }}>Valid From</td>
                <td>{result.tls?.valid_from ? new Date(result.tls.valid_from).toLocaleDateString() : "\u2014"}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Valid To</td>
                <td>{result.tls?.valid_to ? new Date(result.tls.valid_to).toLocaleDateString() : "\u2014"}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>SANs ({result.tls?.sans?.length || 0})</td>
                <td style={{ wordBreak: "break-all", fontSize: "0.85rem" }}>
                  {result.tls?.sans?.length ? (
                    <details>
                      <summary style={{ cursor: "pointer" }}>
                        {result.tls.sans.slice(0, 3).join(", ")}
                        {result.tls.sans.length > 3 && ` + ${result.tls.sans.length - 3} more`}
                      </summary>
                      <div style={{ marginTop: "0.5rem" }}>
                        {result.tls.sans.map((san, i) => <div key={i}>{san}</div>)}
                      </div>
                    </details>
                  ) : "\u2014"}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

// -- Tab: Pantheon --

function PantheonTab({
  result,
  pantheon,
}: {
  result: SiteCheckResult;
  pantheon: ReturnType<typeof detectPantheonSite>;
}) {
  const headers = result.http?.headers || {};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", paddingTop: "1rem" }}>
      <Panel>
        <h4>Platform Detection</h4>
        {pantheon.isPantheon ? (
          <Callout type="info" title="Pantheon Site Detected">
            <p>
              This site is hosted on <strong>Pantheon</strong>.
              {pantheon.cms && <> Framework: <strong>{pantheon.cms}</strong>.</>}
              {pantheon.environment && <> Environment: <strong>{pantheon.environment}</strong>.</>}
            </p>
          </Callout>
        ) : (
          <Callout type="warning" title="Not a Pantheon Site (or debug headers disabled)">
            <p>
              No Pantheon-specific headers detected. This may not be a Pantheon site, or
              the <strong>Pantheon Debug</strong> header was not enabled. Re-check with
              "Pantheon Debug" enabled to get full Pantheon diagnostic headers.
            </p>
          </Callout>
        )}
      </Panel>

      {pantheon.isPantheon && (
        <Panel>
          <h4>Site Identity</h4>
          <table className="pds-table">
            <tbody>
              {pantheon.siteUuid && (
                <tr>
                  <td style={{ fontWeight: 600, width: "20%" }}>Site UUID</td>
                  <td>
                    <code>{pantheon.siteUuid}</code>
                    <a
                      href={`https://dashboard.pantheon.io/sites/${pantheon.siteUuid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ marginLeft: "0.75rem", fontSize: "0.85rem" }}
                    >
                      Open Dashboard
                    </a>
                  </td>
                </tr>
              )}
              {pantheon.environment && (
                <tr>
                  <td style={{ fontWeight: 600 }}>Environment</td>
                  <td><code>{pantheon.environment}</code></td>
                </tr>
              )}
              {pantheon.cms && (
                <tr>
                  <td style={{ fontWeight: 600 }}>Framework</td>
                  <td>{pantheon.cms}</td>
                </tr>
              )}
              {headers["x-pantheon-styx-hostname"] && (
                <tr>
                  <td style={{ fontWeight: 600 }}>Styx Hostname</td>
                  <td><code style={{ fontSize: "0.85rem" }}>{headers["x-pantheon-styx-hostname"]}</code></td>
                </tr>
              )}
              {headers["x-pantheon-endpoint"] && (
                <tr>
                  <td style={{ fontWeight: 600 }}>Endpoint</td>
                  <td><code>{headers["x-pantheon-endpoint"]}</code></td>
                </tr>
              )}
            </tbody>
          </table>
        </Panel>
      )}

      {pantheon.pantheonHeaders.length > 0 && (
        <Panel>
          <h4>Pantheon Response Headers</h4>
          <table className="pds-table">
            <thead>
              <tr>
                <th style={{ width: "30%" }}>Header</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {pantheon.pantheonHeaders.map((h, i) => (
                <tr key={i}>
                  <td><code style={{ fontSize: "0.8rem" }}>{h.header}</code></td>
                  <td style={{ wordBreak: "break-all", fontSize: "0.85rem" }}>
                    {truncateValue(h.value, 300)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {pantheon.cms && (
        <Panel>
          <h4>{pantheon.cms} Details</h4>
          <table className="pds-table">
            <tbody>
              {headers["x-generator"] && (
                <tr>
                  <td style={{ fontWeight: 600, width: "20%" }}>Generator</td>
                  <td>{headers["x-generator"]}</td>
                </tr>
              )}
              {headers["x-drupal-cache"] && (
                <tr>
                  <td style={{ fontWeight: 600 }}>Drupal Cache</td>
                  <td>{headers["x-drupal-cache"]}</td>
                </tr>
              )}
              {headers["x-drupal-dynamic-cache"] && (
                <tr>
                  <td style={{ fontWeight: 600 }}>Dynamic Cache</td>
                  <td>{headers["x-drupal-dynamic-cache"]}</td>
                </tr>
              )}
              {headers["x-powered-by"] && (
                <tr>
                  <td style={{ fontWeight: 600 }}>Powered By</td>
                  <td>{headers["x-powered-by"]}</td>
                </tr>
              )}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

// -- Tab: Subdomains --

function SubdomainsTab({ subdomains }: { subdomains: SubdomainResult | null }) {
  if (!subdomains) {
    return (
      <div style={{ paddingTop: "1rem" }}>
        <Panel>
          <Callout type="info" title="Subdomain Discovery">
            <p>
              Subdomain data was not available for this check. This feature queries
              Certificate Transparency logs to discover subdomains.
            </p>
          </Callout>
        </Panel>
      </div>
    );
  }

  if (subdomains.error) {
    return (
      <div style={{ paddingTop: "1rem" }}>
        <Panel>
          <Callout type="critical" title="Subdomain Lookup Error">
            <p>{subdomains.error}</p>
          </Callout>
        </Panel>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", paddingTop: "1rem" }}>
      <Panel>
        <h4>Certificate Transparency — Subdomain Discovery</h4>
        <p style={{ color: "#666", fontSize: "0.85rem" }}>
          Found <strong>{subdomains.count}</strong> subdomain{subdomains.count !== 1 ? "s" : ""} for{" "}
          <strong>{subdomains.domain}</strong> via {subdomains.source} in {subdomains.duration_ms}ms.
        </p>
        {subdomains.subdomains.length > 0 && (
          <table className="pds-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Subdomain</th>
              </tr>
            </thead>
            <tbody>
              {subdomains.subdomains.map((sub, i) => (
                <tr key={i}>
                  <td style={{ width: "50px", color: "#999" }}>{i + 1}</td>
                  <td>
                    <code style={{ fontSize: "0.85rem" }}>{sub}</code>
                    <Link
                      to={`/?url=${encodeURIComponent(sub)}&debug=true&fdebug=true&follow=true`}
                      style={{ marginLeft: "0.75rem", fontSize: "0.8rem" }}
                    >
                      Check
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

// -- Tab: SEO --

function SEOTab({ seo }: { seo: any }) {
  const scoreColor = seo.score >= 80 ? "#16a34a" : seo.score >= 50 ? "#ca8a04" : "#dc2626";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", paddingTop: "1rem" }}>
      <Panel>
        <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
          <div style={{
            width: "64px", height: "64px", borderRadius: "50%",
            border: `4px solid ${scoreColor}`, display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "1.5rem", fontWeight: 700, color: scoreColor,
          }}>
            {seo.score}
          </div>
          <div>
            <h4 style={{ margin: 0 }}>SEO Score</h4>
            <p style={{ color: "#666", fontSize: "0.85rem", margin: 0 }}>Completed in {seo.duration_ms}ms</p>
          </div>
        </div>
      </Panel>

      {seo.issues && seo.issues.length > 0 && (
        <Panel>
          <h4>Issues ({seo.issues.length})</h4>
          {seo.issues.map((issue: string, i: number) => (
            <Callout key={i} type="warning" title={issue}><span /></Callout>
          ))}
        </Panel>
      )}

      <Panel>
        <h4>Meta Tags</h4>
        <table className="pds-table">
          <tbody>
            <tr>
              <td style={{ fontWeight: 600, width: "15%" }}>Title</td>
              <td>{seo.title?.value || "\u2014"}</td>
              <td style={{ width: "15%" }}>
                {seo.title && <Badge color={seo.title.rating === "good" ? "#16a34a" : "#ca8a04"} label={`${seo.title.length} chars`} />}
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>Description</td>
              <td style={{ fontSize: "0.85rem" }}>{seo.description?.value || "\u2014"}</td>
              <td>
                {seo.description && <Badge color={seo.description.rating === "good" ? "#16a34a" : "#ca8a04"} label={`${seo.description.length} chars`} />}
              </td>
            </tr>
            {seo.canonical && (
              <tr>
                <td style={{ fontWeight: 600 }}>Canonical</td>
                <td colSpan={2} style={{ fontSize: "0.85rem", wordBreak: "break-all" }}>{seo.canonical}</td>
              </tr>
            )}
          </tbody>
        </table>
      </Panel>

      <Panel>
        <h4>Headings</h4>
        <table className="pds-table">
          <thead><tr><th>Type</th><th>Count</th><th>Content</th></tr></thead>
          <tbody>
            <tr>
              <td style={{ fontWeight: 600 }}>H1</td>
              <td>{seo.headings?.h1_count || 0}</td>
              <td style={{ fontSize: "0.85rem" }}>{seo.headings?.h1s?.join(", ") || "\u2014"}</td>
            </tr>
            <tr><td style={{ fontWeight: 600 }}>H2</td><td>{seo.headings?.h2_count || 0}</td><td></td></tr>
            <tr><td style={{ fontWeight: 600 }}>H3</td><td>{seo.headings?.h3_count || 0}</td><td></td></tr>
          </tbody>
        </table>
      </Panel>

      {seo.images && (
        <Panel>
          <h4>Images: Alt Text Audit</h4>
          <p style={{ fontSize: "0.85rem", color: "#666" }}>
            {seo.images.with_alt}/{seo.images.total} images have alt text
          </p>
          <div style={{ background: "#e5e7eb", borderRadius: "4px", height: "8px", marginTop: "0.5rem" }}>
            <div style={{
              background: seo.images.rating === "good" ? "#16a34a" : seo.images.rating === "warning" ? "#ca8a04" : "#dc2626",
              height: "100%", borderRadius: "4px",
              width: seo.images.total > 0 ? `${(seo.images.with_alt / seo.images.total) * 100}%` : "0%",
            }} />
          </div>
        </Panel>
      )}

      <Panel>
        <h4>Technical SEO</h4>
        <table className="pds-table">
          <tbody>
            <tr>
              <td style={{ fontWeight: 600, width: "20%" }}>robots.txt</td>
              <td>
                <Badge color={seo.robots_txt?.found ? "#16a34a" : "#dc2626"} label={seo.robots_txt?.found ? "Found" : "Missing"} />
                {seo.robots_txt?.sitemaps?.length > 0 && (
                  <span style={{ marginLeft: "0.5rem", fontSize: "0.85rem", color: "#666" }}>
                    Sitemaps: {seo.robots_txt.sitemaps.length}
                  </span>
                )}
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>sitemap.xml</td>
              <td>
                <Badge color={seo.sitemap?.found ? "#16a34a" : "#dc2626"} label={seo.sitemap?.found ? "Found" : "Missing"} />
                {seo.sitemap?.url_count > 0 && (
                  <span style={{ marginLeft: "0.5rem", fontSize: "0.85rem", color: "#666" }}>
                    {seo.sitemap.url_count} URLs
                  </span>
                )}
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>Structured Data</td>
              <td>
                {seo.structured_data?.length > 0
                  ? seo.structured_data.map((sd: any, i: number) => <Badge key={i} color="#4f46e5" label={sd.type} />)
                  : <span style={{ color: "#999" }}>None detected</span>}
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>Mixed Content</td>
              <td>
                {seo.mixed_content?.length > 0
                  ? <Badge color="#dc2626" label={`${seo.mixed_content.length} issues`} />
                  : <Badge color="#16a34a" label="Clean" />}
              </td>
            </tr>
          </tbody>
        </table>
      </Panel>

      {Object.keys(seo.open_graph || {}).length > 0 && (
        <Panel>
          <h4>Open Graph Tags</h4>
          <table className="pds-table">
            <tbody>
              {Object.entries(seo.open_graph).map(([key, value]: [string, any]) => (
                <tr key={key}>
                  <td style={{ fontWeight: 600, width: "20%" }}>{key}</td>
                  <td style={{ fontSize: "0.85rem", wordBreak: "break-all" }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

// -- Tab: Lighthouse --

function LighthouseStrategyTabs({ mobile, desktop, mobileLoading, desktopLoading }: { mobile: any; desktop: any; mobileLoading: boolean; desktopLoading: boolean }) {
  const [active, setActive] = useState<"mobile" | "desktop">("mobile");
  const data = active === "mobile" ? mobile : desktop;
  const isLoading = active === "mobile" ? mobileLoading : desktopLoading;

  return (
    <div>
      {/* Tab buttons */}
      <div style={{ display: "flex", gap: "0.25rem", marginBottom: "1rem" }}>
        {(["mobile", "desktop"] as const).map(s => {
          const d = s === "mobile" ? mobile : desktop;
          const loading = s === "mobile" ? mobileLoading : desktopLoading;
          const isActive = s === active;
          return (
            <button key={s} onClick={() => setActive(s)} style={{
              padding: "0.4rem 1rem", borderRadius: "var(--radius-full)",
              border: isActive ? "1px solid var(--color-primary)" : "1px solid var(--color-border)",
              background: isActive ? "var(--color-primary)" : "var(--color-bg)",
              color: isActive ? "#fff" : "var(--color-text-secondary)",
              fontSize: "0.78rem", fontWeight: 600, cursor: "pointer",
              display: "flex", alignItems: "center", gap: "0.35rem", textTransform: "capitalize",
            }}>
              {s}
              {loading && (
                <svg viewBox="0 0 50 50" width="12" height="12">
                  <circle cx="25" cy="25" r="20" fill="none" stroke={isActive ? "#fff" : "var(--color-primary)"} strokeWidth="6" strokeDasharray="90 60" strokeLinecap="round">
                    <animateTransform attributeName="transform" type="rotate" dur="0.8s" from="0 25 25" to="360 25 25" repeatCount="indefinite" />
                  </circle>
                </svg>
              )}
              {!loading && d?.performance != null && (
                <span style={{ fontSize: "0.7rem", opacity: 0.8 }}>({d.performance})</span>
              )}
            </button>
          );
        })}
      </div>

      {isLoading && (
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <svg viewBox="0 0 50 50" width="24" height="24" style={{ margin: "0 auto" }}>
            <circle cx="25" cy="25" r="20" fill="none" stroke="var(--color-primary)" strokeWidth="4" strokeDasharray="90 60" strokeLinecap="round">
              <animateTransform attributeName="transform" type="rotate" dur="0.8s" from="0 25 25" to="360 25 25" repeatCount="indefinite" />
            </circle>
          </svg>
          <p style={{ color: "var(--color-text-muted)", fontSize: "0.82rem", marginTop: "0.5rem" }}>Running {active} Lighthouse audit...</p>
        </div>
      )}

      {!isLoading && data?.error && (
        <Callout type="warning" title="Lighthouse Unavailable"><p>{data.error}</p></Callout>
      )}

      {!isLoading && data && !data.error && <LighthouseTab lighthouse={data} />}
    </div>
  );
}

function LighthouseTab({ lighthouse }: { lighthouse: any }) {
  const gaugeColor = (score: number) => score >= 90 ? "#16a34a" : score >= 50 ? "#ca8a04" : "#dc2626";
  const assessColor = (rating: string) => rating === "Good" ? "#16a34a" : rating === "Not Bad" ? "#2563eb" : rating === "Needs Improvement" ? "#ca8a04" : "#dc2626";

  const ScoreGauge = ({ score, label }: { score: number; label: string }) => {
    const color = gaugeColor(score);
    const circumference = 2 * Math.PI * 40;
    const offset = circumference - (score / 100) * circumference;
    return (
      <div style={{ textAlign: "center" }}>
        <svg width="90" height="90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" fill="none" stroke="#e5e7eb" strokeWidth="6" />
          <circle cx="50" cy="50" r="40" fill="none" stroke={color} strokeWidth="6"
            strokeDasharray={circumference} strokeDashoffset={offset}
            strokeLinecap="round" transform="rotate(-90 50 50)" />
          <text x="50" y="55" textAnchor="middle" fontSize="22" fontWeight="700" fill={color}>{score}</text>
        </svg>
        <p style={{ fontSize: "0.75rem", fontWeight: 600, margin: "0.25rem 0 0" }}>{label}</p>
      </div>
    );
  };

  const AssessmentCard = ({ title, assessment }: { title: string; assessment: any }) => {
    if (!assessment) return null;
    const color = assessColor(assessment.rating);
    return (
      <div style={{ flex: "1 1 280px", padding: "0.75rem 1rem", borderRadius: "8px", border: `2px solid ${color}20`, background: `${color}08` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
          <h5 style={{ margin: 0, fontSize: "0.9rem" }}>{title}</h5>
          <Badge color={color} label={assessment.rating} />
        </div>
        <p style={{ fontSize: "0.8rem", color: "#555", margin: "0 0 0.35rem", lineHeight: 1.4 }}>{assessment.summary}</p>
        {assessment.details?.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.78rem", color: "#666", lineHeight: 1.5 }}>
            {assessment.details.map((d: string, i: number) => <li key={i}>{d}</li>)}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", paddingTop: "1rem" }}>
      {/* Quick / Usable / Resilient assessment cards */}
      {(lighthouse.is_quick || lighthouse.is_usable || lighthouse.is_resilient) && (
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <AssessmentCard title="Is It Quick?" assessment={lighthouse.is_quick} />
          <AssessmentCard title="Is It Usable?" assessment={lighthouse.is_usable} />
          <AssessmentCard title="Is It Resilient?" assessment={lighthouse.is_resilient} />
        </div>
      )}

      {/* Lighthouse score gauges */}
      <Panel>
        <div style={{ display: "flex", justifyContent: "space-around", flexWrap: "wrap", gap: "0.75rem", padding: "0.5rem 0" }}>
          <ScoreGauge score={lighthouse.performance} label="Performance" />
          <ScoreGauge score={lighthouse.accessibility} label="Accessibility" />
          <ScoreGauge score={lighthouse.best_practices} label="Best Practices" />
          <ScoreGauge score={lighthouse.seo} label="SEO" />
        </div>
      </Panel>

      {/* Performance metrics + page stats */}
      <Panel>
        <h4>Metrics</h4>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.5rem", marginBottom: "0.75rem" }}>
          {[
            { label: "TTFB", value: lighthouse.ttfb },
            { label: "FCP", value: lighthouse.fcp },
            { label: "LCP", value: lighthouse.lcp },
            { label: "TBT", value: lighthouse.tbt },
            { label: "CLS", value: lighthouse.cls },
            { label: "Speed Index", value: lighthouse.speed_index },
            { label: "Interactive", value: lighthouse.tti },
            { label: "Page Weight", value: lighthouse.page_weight ? `${(lighthouse.page_weight / (1024 * 1024)).toFixed(1)} MB` : null },
            { label: "Requests", value: lighthouse.total_requests ? `${lighthouse.total_requests}` : null },
          ].filter(m => m.value).map((m, i) => (
            <div key={i} style={{ textAlign: "center", padding: "0.4rem", background: "#f9fafb", borderRadius: "6px" }}>
              <div style={{ fontSize: "1rem", fontWeight: 700, color: "#1a1a1a" }}>{m.value}</div>
              <div style={{ fontSize: "0.7rem", color: "#999", textTransform: "uppercase", letterSpacing: "0.05em" }}>{m.label}</div>
            </div>
          ))}
        </div>
      </Panel>

      {/* Filmstrip + Screenshot */}
      {(lighthouse.filmstrip?.length > 0 || lighthouse.final_screenshot) && (
        <Panel>
          {lighthouse.filmstrip?.length > 0 && (
            <>
              <h4>Visual Progress</h4>
              <div style={{ display: "flex", gap: "2px", overflowX: "auto", padding: "0.25rem 0 0.5rem" }}>
                {lighthouse.filmstrip.filter((_: any, i: number) => i % 3 === 0).map((frame: any, i: number) => (
                  <div key={i} style={{ flexShrink: 0, textAlign: "center" }}>
                    <img src={frame.data} alt={`${frame.timing}ms`} style={{ height: "80px", borderRadius: "2px", border: "1px solid var(--color-border)" }} />
                    <div style={{ fontSize: "0.6rem", color: "var(--color-text-muted)", marginTop: "2px" }}>{(frame.timing / 1000).toFixed(1)}s</div>
                  </div>
                ))}
              </div>
            </>
          )}
          {lighthouse.final_screenshot && (
            <details style={{ marginTop: lighthouse.filmstrip?.length > 0 ? "0.5rem" : 0 }}>
              <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "0.85rem" }}>Full Page Screenshot</summary>
              <div style={{ textAlign: "center", background: "var(--color-surface)", padding: "0.5rem", borderRadius: "var(--radius-sm)", marginTop: "0.5rem" }}>
                <img src={lighthouse.final_screenshot} alt="Final page screenshot" style={{ maxWidth: "100%", maxHeight: "400px", borderRadius: "4px", border: "1px solid var(--color-border)" }} />
              </div>
            </details>
          )}
        </Panel>
      )}

      {/* LCP & CLS Elements */}
      {(lighthouse.lcp_element || lighthouse.cls_elements?.length > 0) && (
        <Panel>
          <h4>Performance Bottlenecks</h4>
          {lighthouse.lcp_element && (
            <div style={{ marginBottom: "0.75rem" }}>
              <div style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", color: "var(--color-text-muted)", marginBottom: "0.25rem" }}>Largest Contentful Paint Element</div>
              <code style={{ fontSize: "0.78rem", background: "var(--color-surface)", padding: "0.4rem 0.6rem", borderRadius: "var(--radius-sm)", display: "block", wordBreak: "break-all", border: "1px solid var(--color-border)" }}>
                {lighthouse.lcp_element}
              </code>
            </div>
          )}
          {lighthouse.cls_elements?.length > 0 && (
            <div>
              <div style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", color: "var(--color-text-muted)", marginBottom: "0.25rem" }}>Layout Shift Elements</div>
              {lighthouse.cls_elements.map((el: string, i: number) => (
                <code key={i} style={{ fontSize: "0.78rem", background: "var(--color-surface)", padding: "0.3rem 0.6rem", borderRadius: "var(--radius-sm)", display: "block", wordBreak: "break-all", marginBottom: "0.2rem", border: "1px solid var(--color-border)" }}>
                  {el}
                </code>
              ))}
            </div>
          )}
          {lighthouse.dom_size > 0 && (
            <p style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", marginTop: "0.5rem" }}>
              DOM size: <strong style={{ color: lighthouse.dom_size > 1500 ? "var(--color-danger)" : "var(--color-text)" }}>{lighthouse.dom_size.toLocaleString()}</strong> elements
              {lighthouse.dom_size > 1500 && " (large)"}
            </p>
          )}
        </Panel>
      )}

      {/* Resource Summary (Asset Breakdown) */}
      {lighthouse.resource_summary?.length > 0 && (
        <Panel>
          <h4>Asset Breakdown</h4>
          <table className="pds-table">
            <thead><tr><th>Type</th><th>Requests</th><th>Size</th><th></th></tr></thead>
            <tbody>
              {lighthouse.resource_summary.filter((r: any) => r.request_count > 0).map((r: any, i: number) => {
                const totalBytes = lighthouse.resource_summary.reduce((sum: number, item: any) => sum + item.transfer_size, 0);
                const pct = totalBytes > 0 ? (r.transfer_size / totalBytes * 100) : 0;
                return (
                  <tr key={i}>
                    <td style={{ fontWeight: 600, fontSize: "0.82rem" }}>{r.label}</td>
                    <td style={{ fontSize: "0.82rem" }}>{r.request_count}</td>
                    <td style={{ fontSize: "0.82rem" }}>{(r.transfer_size / 1024).toFixed(1)} KB</td>
                    <td style={{ width: "120px" }}>
                      <div style={{ background: "var(--color-border)", borderRadius: "2px", height: "6px" }}>
                        <div style={{ background: "var(--color-primary)", height: "100%", borderRadius: "2px", width: `${Math.min(pct, 100)}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}

      {/* Network Waterfall */}
      {lighthouse.network_requests?.length > 0 && (
        <Panel>
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "0.9rem" }}>
              Network Waterfall ({lighthouse.network_requests.length} requests)
            </summary>
            <div style={{ marginTop: "0.5rem", overflowX: "auto" }}>
              {(() => {
                const maxTime = Math.max(...lighthouse.network_requests.map((r: any) => r.end_time || 0));
                return lighthouse.network_requests.slice(0, 60).map((req: any, i: number) => {
                  const left = maxTime > 0 ? (req.start_time / maxTime * 100) : 0;
                  const width = maxTime > 0 ? (Math.max((req.end_time - req.start_time) / maxTime * 100, 0.5)) : 0;
                  const typeColor: Record<string, string> = { Script: "#f59e0b", Stylesheet: "#8b5cf6", Image: "#10b981", Font: "#3b82f6", Document: "#ef4444", XHR: "#6366f1", Fetch: "#6366f1" };
                  const color = typeColor[req.resource_type] || "#9ca3af";
                  const shortUrl = req.url.replace(/^https?:\/\/[^/]+/, "").slice(0, 60);
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.72rem", height: "18px" }}>
                      <span style={{ width: "50px", flexShrink: 0, color: "var(--color-text-muted)", textAlign: "right" }}>{req.start_time.toFixed(0)}ms</span>
                      <span style={{ width: "200px", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-text-secondary)" }} title={req.url}>
                        {shortUrl || "/"}
                      </span>
                      <div style={{ flex: 1, position: "relative", height: "10px", background: "var(--color-surface)", borderRadius: "2px" }}>
                        <div style={{ position: "absolute", left: `${left}%`, width: `${width}%`, height: "100%", background: color, borderRadius: "2px", minWidth: "2px" }} title={`${req.resource_type} · ${(req.transfer_size / 1024).toFixed(1)}KB · ${(req.end_time - req.start_time).toFixed(0)}ms`} />
                      </div>
                      <span style={{ width: "50px", flexShrink: 0, fontSize: "0.65rem", color: "var(--color-text-muted)" }}>{(req.transfer_size / 1024).toFixed(0)}KB</span>
                    </div>
                  );
                });
              })()}
              <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem", fontSize: "0.65rem", color: "var(--color-text-muted)" }}>
                <span><span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "2px", background: "#ef4444", marginRight: "3px" }} />Document</span>
                <span><span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "2px", background: "#f59e0b", marginRight: "3px" }} />Script</span>
                <span><span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "2px", background: "#8b5cf6", marginRight: "3px" }} />Stylesheet</span>
                <span><span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "2px", background: "#10b981", marginRight: "3px" }} />Image</span>
                <span><span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "2px", background: "#3b82f6", marginRight: "3px" }} />Font</span>
                <span><span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "2px", background: "#6366f1", marginRight: "3px" }} />XHR/Fetch</span>
              </div>
            </div>
          </details>
        </Panel>
      )}

      {/* Render-Blocking + Third-Party (collapsed) */}
      {(lighthouse.render_blocking?.length > 0 || lighthouse.third_party_summary?.length > 0) && (
        <Panel>
          {lighthouse.render_blocking?.length > 0 && (
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "0.9rem" }}>
                Render-Blocking Resources ({lighthouse.render_blocking.length})
              </summary>
              <table className="pds-table" style={{ marginTop: "0.5rem" }}>
                <thead><tr><th>URL</th><th>Wasted (ms)</th></tr></thead>
                <tbody>
                  {lighthouse.render_blocking.map((rb: any, i: number) => (
                    <tr key={i}>
                      <td style={{ fontSize: "0.78rem", wordBreak: "break-all", maxWidth: "500px" }}>{rb.url}</td>
                      <td style={{ fontWeight: 600, color: rb.wasted_ms > 500 ? "var(--color-danger)" : "var(--color-text-secondary)" }}>{rb.wasted_ms}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          {lighthouse.third_party_summary?.length > 0 && (
            <details style={{ marginTop: lighthouse.render_blocking?.length > 0 ? "0.75rem" : 0 }}>
              <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "0.9rem" }}>
                Third-Party Dependencies ({lighthouse.third_party_summary.length})
                {lighthouse.third_party_blocking_ms > 0 && (
                  <span style={{ fontWeight: 400, fontSize: "0.78rem", color: "var(--color-text-muted)", marginLeft: "0.5rem" }}>
                    {lighthouse.third_party_blocking_ms}ms blocking
                  </span>
                )}
              </summary>
              <table className="pds-table" style={{ marginTop: "0.5rem" }}>
                <thead><tr><th>Entity</th><th>Size</th><th>Blocking</th></tr></thead>
                <tbody>
                  {lighthouse.third_party_summary.map((tp: any, i: number) => (
                    <tr key={i}>
                      <td style={{ fontSize: "0.82rem" }}>{tp.entity}</td>
                      <td style={{ fontSize: "0.82rem" }}>{(tp.transfer_size / 1024).toFixed(1)} KB</td>
                      <td style={{ fontWeight: 600, color: tp.blocking_time_ms > 250 ? "var(--color-danger)" : "var(--color-text-secondary)" }}>{tp.blocking_time_ms}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </Panel>
      )}

      {/* Main Thread Work */}
      {lighthouse.main_thread_work?.length > 0 && (
        <Panel>
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "0.9rem" }}>
              Main Thread Work
            </summary>
            <table className="pds-table" style={{ marginTop: "0.5rem" }}>
              <thead><tr><th>Category</th><th>Duration</th><th></th></tr></thead>
              <tbody>
                {lighthouse.main_thread_work.sort((a: any, b: any) => b.duration - a.duration).map((item: any, i: number) => {
                  const totalMs = lighthouse.main_thread_work.reduce((s: number, it: any) => s + it.duration, 0);
                  const pct = totalMs > 0 ? (item.duration / totalMs * 100) : 0;
                  return (
                    <tr key={i}>
                      <td style={{ fontSize: "0.82rem" }}>{item.group}</td>
                      <td style={{ fontSize: "0.82rem", fontWeight: 600 }}>{item.duration.toFixed(0)}ms</td>
                      <td style={{ width: "100px" }}>
                        <div style={{ background: "var(--color-border)", borderRadius: "2px", height: "6px" }}>
                          <div style={{ background: "var(--color-warning)", height: "100%", borderRadius: "2px", width: `${Math.min(pct, 100)}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </details>
        </Panel>
      )}

      {/* Unused JS/CSS */}
      {(lighthouse.unused_js?.length > 0 || lighthouse.unused_css?.length > 0) && (
        <Panel>
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "0.9rem" }}>
              Unused Code
              {lighthouse.unused_js?.length > 0 && ` · ${lighthouse.unused_js.length} JS files`}
              {lighthouse.unused_css?.length > 0 && ` · ${lighthouse.unused_css.length} CSS files`}
            </summary>
            <div style={{ marginTop: "0.5rem" }}>
              {lighthouse.unused_js?.length > 0 && (
                <>
                  <div style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", color: "var(--color-text-muted)", marginBottom: "0.25rem" }}>Unused JavaScript</div>
                  <table className="pds-table">
                    <thead><tr><th>URL</th><th>Wasted</th></tr></thead>
                    <tbody>
                      {lighthouse.unused_js.slice(0, 15).map((r: any, i: number) => (
                        <tr key={i}>
                          <td style={{ fontSize: "0.75rem", wordBreak: "break-all", maxWidth: "400px" }}>{r.url.replace(/^https?:\/\/[^/]+/, "")}</td>
                          <td style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--color-danger)" }}>{(r.wasted_bytes / 1024).toFixed(0)} KB</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              {lighthouse.unused_css?.length > 0 && (
                <>
                  <div style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", color: "var(--color-text-muted)", marginBottom: "0.25rem", marginTop: "0.75rem" }}>Unused CSS</div>
                  <table className="pds-table">
                    <thead><tr><th>URL</th><th>Wasted</th></tr></thead>
                    <tbody>
                      {lighthouse.unused_css.slice(0, 10).map((r: any, i: number) => (
                        <tr key={i}>
                          <td style={{ fontSize: "0.75rem", wordBreak: "break-all", maxWidth: "400px" }}>{r.url.replace(/^https?:\/\/[^/]+/, "")}</td>
                          <td style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--color-danger)" }}>{(r.wasted_bytes / 1024).toFixed(0)} KB</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </details>
        </Panel>
      )}

      {/* Cache Policy */}
      {lighthouse.cache_policy?.length > 0 && (
        <Panel>
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "0.9rem" }}>
              Cache Policy Issues ({lighthouse.cache_policy.length} resources)
            </summary>
            <table className="pds-table" style={{ marginTop: "0.5rem" }}>
              <thead><tr><th>URL</th><th>TTL</th><th>Size</th></tr></thead>
              <tbody>
                {lighthouse.cache_policy.slice(0, 20).map((r: any, i: number) => (
                  <tr key={i}>
                    <td style={{ fontSize: "0.75rem", wordBreak: "break-all", maxWidth: "400px" }}>{r.url.replace(/^https?:\/\/[^/]+/, "")}</td>
                    <td style={{ fontSize: "0.82rem", color: r.cache_ttl < 86400 ? "var(--color-danger)" : "var(--color-text-secondary)" }}>
                      {r.cache_ttl < 3600 ? `${r.cache_ttl.toFixed(0)}s` : `${(r.cache_ttl / 3600).toFixed(1)}h`}
                    </td>
                    <td style={{ fontSize: "0.82rem" }}>{(r.total_bytes / 1024).toFixed(0)} KB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </Panel>
      )}

      <p style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", textAlign: "right", marginTop: "0.25rem" }}>
        {lighthouse.strategy} &middot; {(lighthouse.duration_ms / 1000).toFixed(1)}s via PageSpeed Insights API
      </p>
    </div>
  );
}

// -- Tab: Security --

function SecurityTab({ security }: { security: NonNullable<SiteCheckResult["security"]> }) {
  const ratingColor = (rating: string) => {
    switch (rating) {
      case "good": return "#16a34a";
      case "warning": return "#ca8a04";
      case "missing": return "#9ca3af";
      case "bad": return "#dc2626";
      default: return "#666";
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", paddingTop: "1rem" }}>
      <Panel>
        <h4>Security Score: {security.score}/100 (Grade {security.grade})</h4>
        <table className="pds-table">
          <thead>
            <tr>
              <th>Header</th>
              <th>Status</th>
              <th>Value</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {security.headers.map((h, i) => (
              <tr key={i}>
                <td><code style={{ fontSize: "0.8rem" }}>{h.name}</code></td>
                <td>
                  <Badge color={ratingColor(h.rating)} label={h.rating} />
                </td>
                <td style={{ fontSize: "0.85rem", maxWidth: "200px", wordBreak: "break-all" }}>
                  {h.present ? truncateValue(h.value || "", 80) : "\u2014"}
                </td>
                <td style={{ fontSize: "0.85rem", color: "#555" }}>{h.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {security.cookies && security.cookies.length > 0 && (
        <Panel>
          <h4>Cookie Audit</h4>
          <table className="pds-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Secure</th>
                <th>HttpOnly</th>
                <th>SameSite</th>
                <th>Issues</th>
              </tr>
            </thead>
            <tbody>
              {security.cookies.map((c, i) => (
                <tr key={i}>
                  <td><code style={{ fontSize: "0.8rem" }}>{c.name}</code></td>
                  <td style={{ color: c.secure ? "#16a34a" : "#dc2626" }}>{c.secure ? "Yes" : "No"}</td>
                  <td style={{ color: c.http_only ? "#16a34a" : "#dc2626" }}>{c.http_only ? "Yes" : "No"}</td>
                  <td>{c.same_site || "\u2014"}</td>
                  <td style={{ fontSize: "0.85rem", color: "#dc2626" }}>{c.issues?.join("; ") || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

// -- Tab: Email Auth --

function EmailAuthTab({ emailAuth }: { emailAuth: NonNullable<SiteCheckResult["email_auth"]> }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", paddingTop: "1rem" }}>
      <Panel>
        <h4>Email Authentication Grade: {emailAuth.grade}</h4>
      </Panel>

      <Panel>
        <h4>SPF (Sender Policy Framework)</h4>
        {emailAuth.spf.found ? (
          <>
            <Callout type={emailAuth.spf.valid ? "info" : "warning"} title={emailAuth.spf.valid ? "SPF Record Found" : "SPF Issues Detected"}>
              <p><code style={{ fontSize: "0.8rem", wordBreak: "break-all" }}>{emailAuth.spf.record}</code></p>
            </Callout>
            {emailAuth.spf.lookups ? (
              <p style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.5rem" }}>
                DNS lookups: {emailAuth.spf.lookups}/10
              </p>
            ) : null}
            {emailAuth.spf.issues && emailAuth.spf.issues.length > 0 && (
              <div style={{ marginTop: "0.5rem" }}>
                {emailAuth.spf.issues.map((issue, i) => (
                  <Callout key={i} type="warning" title={issue}><span /></Callout>
                ))}
              </div>
            )}
          </>
        ) : (
          <Callout type="critical" title="No SPF Record"><p>No SPF record found for this domain.</p></Callout>
        )}
      </Panel>

      <Panel>
        <h4>DMARC</h4>
        {emailAuth.dmarc.found ? (
          <>
            <Callout type="info" title={`DMARC Policy: ${emailAuth.dmarc.policy || "unknown"}`}>
              <p><code style={{ fontSize: "0.8rem", wordBreak: "break-all" }}>{emailAuth.dmarc.record}</code></p>
            </Callout>
            {emailAuth.dmarc.issues && emailAuth.dmarc.issues.length > 0 && (
              <div style={{ marginTop: "0.5rem" }}>
                {emailAuth.dmarc.issues.map((issue, i) => (
                  <Callout key={i} type="warning" title={issue}><span /></Callout>
                ))}
              </div>
            )}
          </>
        ) : (
          <Callout type="warning" title="No DMARC Record"><p>No DMARC record found at _dmarc.{"{domain}"}.</p></Callout>
        )}
      </Panel>

      <Panel>
        <h4>DKIM</h4>
        <Callout type="info" title="DKIM Check Limited">
          <p>{emailAuth.dkim.note}</p>
        </Callout>
      </Panel>
    </div>
  );
}

// -- Shared utilities --

// Renders **bold** and `code` from AI output
function RenderMarkdown({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return <code key={i} style={{ fontSize: "0.8rem", background: "#f3f4f6", padding: "0.1rem 0.3rem", borderRadius: "3px" }}>{part.slice(1, -1)}</code>;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

function InsightRow({ insight }: { insight: { severity: string; category: string; message: string } }) {
  const cls = insight.severity === "error" ? "insight-row--error" : insight.severity === "warning" ? "insight-row--warning" : "insight-row--info";
  return (
    <div className={`insight-row ${cls}`}>
      <span className="insight-row__category">{insight.category}</span>
      <span>{insight.message}</span>
    </div>
  );
}

function TabSpinner({ message }: { message: string }) {
  return (
    <div style={{ textAlign: "center", padding: "2rem 1rem" }}>
      <svg viewBox="0 0 50 50" width="28" height="28" style={{ margin: "0 auto" }}>
        <circle cx="25" cy="25" r="20" fill="none" stroke="#4f46e5" strokeWidth="4" strokeDasharray="90 60" strokeLinecap="round">
          <animateTransform attributeName="transform" type="rotate" dur="0.8s" from="0 25 25" to="360 25 25" repeatCount="indefinite" />
        </circle>
      </svg>
      <p style={{ color: "#888", fontSize: "0.85rem", marginTop: "0.5rem" }}>{message}</p>
    </div>
  );
}

function StatusBadge({ code }: { code?: number }) {
  if (!code) return <span>{"\u2014"}</span>;
  const color = code < 300 ? "#16a34a" : code < 400 ? "#ca8a04" : "#dc2626";
  return (
    <span style={{ color, fontWeight: 700, fontSize: "1.1rem" }}>
      {code}
    </span>
  );
}

function Badge({ color, label }: { color: string; label: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.2rem 0.6rem",
        borderRadius: "999px",
        fontSize: "0.75rem",
        fontWeight: 600,
        color: "#fff",
        backgroundColor: color,
      }}
    >
      {label}
    </span>
  );
}

function truncateValue(value: string, max: number) {
  if (value.length <= max) return value;
  return value.slice(0, max) + "...";
}

// -- AGCDN Probe Tab (on-demand) --

function AGCDNProbeTab({ domain }: { domain: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const runProbe = async () => {
    setLoading(true);
    try {
      const resp = await fetch(`${SITE_CHECK_API}/agcdn-probe?domain=${encodeURIComponent(domain)}`);
      setData(await resp.json());
    } catch (e) {
      setData({ error: e instanceof Error ? e.message : "Unknown error" });
    }
    setLoading(false);
  };

  if (!data && !loading) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>
        <p style={{ color: "#666", marginBottom: "1rem", fontSize: "0.9rem" }}>
          Actively probe AGCDN features: WAF, Image Optimization, and Rate Limiting.
        </p>
        <Button label="Run AGCDN Probe" onClick={runProbe} variant="brand" />
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: "2rem", textAlign: "center", color: "#666" }}>Probing AGCDN features...</div>;
  }

  if (data?.error) {
    return <Callout type="warning" title="Probe Error"><p>{data.error}</p></Callout>;
  }

  const features = [
    { label: "AGCDN Active", detected: data.is_agcdn, evidence: data.is_agcdn ? "Domain is served through AGCDN" : "Not detected" },
    { label: "WAF (Web Application Firewall)", detected: data.waf?.detected, evidence: data.waf?.evidence },
    { label: "Image Optimization (IO)", detected: data.io?.detected, evidence: data.io?.evidence, extra: data.io?.transforms ? "Transforms verified" : undefined },
    { label: "Rate Limiting", detected: data.rate_limit?.detected, evidence: data.rate_limit?.evidence },
  ];

  return (
    <div style={{ paddingTop: "1rem" }}>
      <p style={{ fontSize: "0.8rem", color: "#999", marginBottom: "1rem" }}>Probed in {data.duration_ms}ms</p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {features.map((f, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", padding: "0.75rem", borderRadius: "6px", background: f.detected ? "#f0fdf4" : "#fafafa", border: `1px solid ${f.detected ? "#bbf7d0" : "#e5e7eb"}` }}>
            <span style={{ fontSize: "1.2rem" }}>{f.detected ? "\u2705" : "\u274C"}</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{f.label}</div>
              {f.evidence && <div style={{ fontSize: "0.8rem", color: "#666", marginTop: "0.15rem" }}>{f.evidence}</div>}
              {f.extra && <div style={{ fontSize: "0.8rem", color: "#16a34a", marginTop: "0.15rem", fontWeight: 500 }}>{f.extra}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// -- Bot Protection Tab (on-demand) --

function BotProtectionTab({ domain }: { domain: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const runProbe = async () => {
    setLoading(true);
    try {
      const resp = await fetch(`${SITE_CHECK_API}/bot-protection?domain=${encodeURIComponent(domain)}`);
      setData(await resp.json());
    } catch (e) {
      setData({ error: e instanceof Error ? e.message : "Unknown error" });
    }
    setLoading(false);
  };

  if (!data && !loading) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>
        <p style={{ color: "#666", marginBottom: "1rem", fontSize: "0.9rem" }}>
          Detect PoW (Proof-of-Work) or Obolus bot mitigation on this domain.
        </p>
        <Button label="Detect Bot Protection" onClick={runProbe} variant="brand" />
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: "2rem", textAlign: "center", color: "#666" }}>Probing for bot protection...</div>;
  }

  if (data?.error) {
    return <Callout type="warning" title="Detection Error"><p>{data.error}</p></Callout>;
  }

  const typeLabel = data.type === "obolus" ? "Obolus (Edge PoW)" : data.type === "pow-interstitial" ? "PoW Interstitial" : "None detected";

  const probes = [
    { label: "Challenge Endpoint (/obolus-challenge)", ...data.challenge_endpoint },
    { label: "Challenge Page Content", ...data.challenge_page },
    { label: "PoW Cookie Requirement", ...data.cookie_required },
  ];

  return (
    <div style={{ paddingTop: "1rem" }}>
      <div style={{ padding: "1rem", borderRadius: "8px", marginBottom: "1rem", background: data.detected ? "#f0fdf4" : "#fafafa", border: `1px solid ${data.detected ? "#bbf7d0" : "#e5e7eb"}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "1.5rem" }}>{data.detected ? "\uD83D\uDEE1\uFE0F" : "\u2014"}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{data.detected ? "Bot Protection Active" : "No Bot Protection Detected"}</div>
            <div style={{ fontSize: "0.85rem", color: "#666" }}>Type: {typeLabel}</div>
          </div>
        </div>
      </div>

      <p style={{ fontSize: "0.8rem", color: "#999", marginBottom: "0.75rem" }}>Detection probes ({data.duration_ms}ms):</p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {probes.map((p, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", padding: "0.5rem 0.75rem", borderRadius: "4px", background: p.detected ? "#f0fdf4" : "#fafafa", fontSize: "0.85rem" }}>
            <span>{p.detected ? "\u2705" : "\u2796"}</span>
            <div>
              <span style={{ fontWeight: 500 }}>{p.label}</span>
              {p.detail && <div style={{ color: "#666", fontSize: "0.8rem", marginTop: "0.1rem" }}>{p.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// -- Resource Audit Tab (on-demand) --

function ResourceAuditTab({ url }: { url: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const runAudit = async () => {
    setLoading(true);
    try {
      const resp = await fetch(`${SITE_CHECK_API}/resources?url=${encodeURIComponent(url)}`);
      setData(await resp.json());
    } catch (e) {
      setData({ error: e instanceof Error ? e.message : "Unknown error" });
    }
    setLoading(false);
  };

  if (!data && !loading) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>
        <p style={{ color: "#666", marginBottom: "1rem", fontSize: "0.9rem" }}>
          Check all linked CSS, JavaScript, and image resources for broken links (404s, 500s).
        </p>
        <Button label="Audit Resources" onClick={runAudit} variant="brand" />
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: "2rem", textAlign: "center", color: "#666" }}>Checking resources...</div>;
  }

  if (data?.error) {
    return <Callout type="warning" title="Audit Error"><p>{data.error}</p></Callout>;
  }

  const typeIcon: Record<string, string> = { css: "\uD83C\uDFA8", js: "\u2699\uFE0F", image: "\uD83D\uDDBC\uFE0F", other: "\uD83D\uDCC4" };

  return (
    <div style={{ paddingTop: "1rem" }}>
      {/* Summary stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <div style={{ textAlign: "center", padding: "0.75rem", background: "#f8fafc", borderRadius: "6px", border: "1px solid #e5e7eb" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{data.total_resources}</div>
          <div style={{ fontSize: "0.75rem", color: "#666" }}>Total</div>
        </div>
        <div style={{ textAlign: "center", padding: "0.75rem", background: "#f0fdf4", borderRadius: "6px", border: "1px solid #bbf7d0" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#16a34a" }}>{data.healthy}</div>
          <div style={{ fontSize: "0.75rem", color: "#666" }}>Healthy</div>
        </div>
        <div style={{ textAlign: "center", padding: "0.75rem", background: data.broken > 0 ? "#fef2f2" : "#f8fafc", borderRadius: "6px", border: `1px solid ${data.broken > 0 ? "#fecaca" : "#e5e7eb"}` }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: data.broken > 0 ? "#dc2626" : "#666" }}>{data.broken}</div>
          <div style={{ fontSize: "0.75rem", color: "#666" }}>Broken</div>
        </div>
        <div style={{ textAlign: "center", padding: "0.75rem", background: "#f8fafc", borderRadius: "6px", border: "1px solid #e5e7eb" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#666" }}>{data.errors}</div>
          <div style={{ fontSize: "0.75rem", color: "#666" }}>Errors</div>
        </div>
      </div>

      {/* Broken resources first */}
      {data.resources?.filter((r: any) => r.status !== "ok").length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <h4 style={{ fontSize: "0.9rem", color: "#dc2626", marginBottom: "0.5rem" }}>Broken / Error Resources</h4>
          {data.resources.filter((r: any) => r.status !== "ok").map((r: any, i: number) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.4rem 0.6rem", borderRadius: "4px", background: "#fef2f2", marginBottom: "0.25rem", fontSize: "0.8rem" }}>
              <span>{typeIcon[r.type] || "\uD83D\uDCC4"}</span>
              <span style={{ fontWeight: 600, color: "#dc2626", minWidth: "30px" }}>{r.status_code || "ERR"}</span>
              <span style={{ wordBreak: "break-all", flex: 1 }}>{truncateValue(r.url, 100)}</span>
              {r.error && <span style={{ color: "#999", fontSize: "0.75rem" }}>{r.error}</span>}
            </div>
          ))}
        </div>
      )}

      {/* All healthy resources (collapsed) */}
      {data.resources?.filter((r: any) => r.status === "ok").length > 0 && (
        <details>
          <summary style={{ cursor: "pointer", fontSize: "0.85rem", fontWeight: 600, color: "#16a34a" }}>
            Healthy Resources ({data.healthy})
          </summary>
          <div style={{ marginTop: "0.5rem" }}>
            {data.resources.filter((r: any) => r.status === "ok").map((r: any, i: number) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.3rem 0.6rem", fontSize: "0.8rem", borderBottom: "1px solid #f3f4f6" }}>
                <span>{typeIcon[r.type] || "\uD83D\uDCC4"}</span>
                <span style={{ color: "#16a34a", fontWeight: 500, minWidth: "30px" }}>{r.status_code}</span>
                <span style={{ wordBreak: "break-all", flex: 1, color: "#666" }}>{truncateValue(r.url, 100)}</span>
                <span style={{ color: "#999", fontSize: "0.75rem" }}>{r.duration_ms}ms</span>
              </div>
            ))}
          </div>
        </details>
      )}

      <p style={{ fontSize: "0.75rem", color: "#999", marginTop: "1rem" }}>Audit completed in {data.duration_ms}ms</p>
    </div>
  );
}
