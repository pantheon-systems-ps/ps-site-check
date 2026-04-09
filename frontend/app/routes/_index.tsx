import type { Route } from "./+types/_index";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Form, useNavigation, Link } from "react-router";
import { Panel, Button, Callout } from "@pantheon-systems/pds-toolkit-react";
import SectionCard from "~/components/SectionCard";
import type { SiteCheckResult, SubdomainResult } from "~/types/site-check";
import { CLIENT_API } from "~/lib/constants";
import InsightRow from "~/components/ui/InsightRow";
import AIAnalysisPanel from "~/components/sections/AIAnalysisPanel";
import ResponseTab from "~/components/sections/ResponseTab";
import DnsTab from "~/components/sections/DnsTab";
import TlsTab from "~/components/sections/TlsTab";
import PantheonTab from "~/components/sections/PantheonTab";
import SubdomainsTab from "~/components/sections/SubdomainsTab";
import SEOTab from "~/components/sections/SEOTab";
import { LighthouseStrategyTabs } from "~/components/sections/LighthouseSection";
import SecurityTab from "~/components/sections/SecurityTab";
import EmailAuthTab from "~/components/sections/EmailAuthTab";
import AGCDNProbeTab from "~/components/sections/AGCDNProbeTab";
import BotProtectionTab from "~/components/sections/BotProtectionTab";
import ResourceAuditTab from "~/components/sections/ResourceAuditTab";
import ProServicesCTA from "~/components/ProServicesCTA";

// -- Check history helpers --

const HISTORY_KEY = "site-check-history";
const MAX_HISTORY = 5;

function getCheckHistory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch { return []; }
}

function addToHistory(domain: string) {
  if (typeof window === "undefined") return;
  const history = getCheckHistory().filter(d => d !== domain);
  history.unshift(domain);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

// -- Typo suggestion --

const TLD_TYPOS: Record<string, string> = {
  ".oi": ".io", ".ocm": ".com", ".con": ".com", ".rog": ".org",
  ".nte": ".net", ".cmo": ".com", ".ogr": ".org", ".oi.": ".io",
};

function suggestDomain(domain: string): string | null {
  for (const [typo, fix] of Object.entries(TLD_TYPOS)) {
    if (domain.endsWith(typo)) return domain.slice(0, -typo.length) + fix;
  }
  return null;
}

// -- Progress steps --

const CHECK_STEPS = [
  "Resolving DNS...",
  "Connecting to server...",
  "Analyzing HTTP headers...",
  "Checking TLS certificate...",
  "Evaluating security...",
];

const SITE_CHECK_API =
  process.env.SITE_CHECK_API_URL ||
  "https://api.site-check.ps-pantheon.com";

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
  if (!tls || tls.error) return { label: "Unknown", color: "var(--color-text-secondary)", description: "Could not determine certificate type" };
  const issuer = (tls.issuer || "").toLowerCase();
  if (issuer.includes("let's encrypt") || issuer.includes("letsencrypt") || /\b(r3|r10|r11|e1|e5|e6|e7)\b/i.test(issuer)) {
    return { label: "Let's Encrypt (Managed)", color: "var(--color-success)", description: "Pantheon-managed Let's Encrypt certificate -- auto-renewed" };
  }
  if (issuer.includes("globalsign")) {
    return { label: "Platform (GlobalSign)", color: "var(--color-info)", description: "Fastly platform certificate -- shared SAN" };
  }
  return { label: "Custom Certificate", color: "var(--color-purple)", description: "Customer-provided or third-party certificate" };
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

function truncateValue(value: string, max: number) {
  if (value.length <= max) return value;
  return value.slice(0, max) + "...";
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
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [urlValue, setUrlValue] = useState(result?.url?.replace(/^https?:\/\//, "") || "");
  const [history, setHistory] = useState<string[]>([]);
  const [checkStep, setCheckStep] = useState(0);

  // Load history + auto-focus + reCAPTCHA
  useEffect(() => {
    setHistory(getCheckHistory());
    if (!result && inputRef.current) inputRef.current.focus();
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

  // Save to history when result loads
  useEffect(() => {
    if (result?.url) {
      const domain = result.url.replace(/^https?:\/\//, "").split("/")[0];
      addToHistory(domain);
      setHistory(getCheckHistory());
    }
  }, [result?.url]);

  // Progress step animation
  useEffect(() => {
    if (!isChecking) { setCheckStep(0); return; }
    const interval = setInterval(() => setCheckStep(s => (s + 1) % CHECK_STEPS.length), 800);
    return () => clearInterval(interval);
  }, [isChecking]);

  // Keyboard shortcut: Ctrl/Cmd+Enter to submit
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && formRef.current) {
        e.preventDefault();
        formRef.current.requestSubmit();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const urlError = useMemo(() => {
    if (!urlValue) return null;
    if (/\s/.test(urlValue)) return "Domain cannot contain spaces";
    if (!/\./.test(urlValue.replace(/^https?:\/\//, ""))) return "Enter a valid domain (e.g., example.com)";
    return null;
  }, [urlValue]);

  const suggestion = useMemo(() => suggestDomain(urlValue), [urlValue]);

  return (
    <>
      <Panel className="pds-spacing-mar-block-end-l">
        <Form method="get" ref={formRef}>
          {/* Primary row: URL + Resolve + Check button */}
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "250px" }}>
              <label htmlFor="url-input" style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}>
                Domain or URL
              </label>
              <input
                ref={inputRef}
                id="url-input"
                name="url"
                type="text"
                placeholder="example.com"
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
                required
                className="pds-input"
                aria-invalid={!!urlError}
                aria-describedby={urlError ? "url-error" : undefined}
                style={{ width: "100%", padding: "0.6rem 0.75rem", border: `1px solid ${urlError ? "var(--color-danger)" : "var(--color-border)"}`, borderRadius: "var(--radius-sm)", fontSize: "0.95rem" }}
              />
              {urlError && <p id="url-error" role="alert" style={{ fontSize: "0.75rem", color: "var(--color-danger)", marginTop: "0.2rem" }}>{urlError}</p>}
              {suggestion && !urlError && (
                <p style={{ fontSize: "0.75rem", color: "var(--color-warning)", marginTop: "0.2rem" }}>
                  Did you mean <button type="button" onClick={() => setUrlValue(suggestion)} style={{ color: "var(--color-primary)", background: "none", border: "none", cursor: "pointer", fontWeight: 600, textDecoration: "underline", padding: 0, fontSize: "inherit", minHeight: "auto", minWidth: "auto" }}>{suggestion}</button>?
                </p>
              )}
              {!result && history.length > 0 && (
                <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginTop: "0.35rem" }}>
                  {history.map(d => (
                    <button key={d} type="button" onClick={() => setUrlValue(d)}
                      style={{ fontSize: "0.7rem", padding: "0.15rem 0.5rem", borderRadius: "var(--radius-full)", border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text-secondary)", cursor: "pointer", minHeight: "auto", minWidth: "auto" }}>
                      {d}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div style={{ minWidth: "180px" }}>
              <label htmlFor="resolve-select" style={{ display: "block", fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.25rem" }} title="Override DNS resolution to test against a specific server IP">
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
          <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.75rem", fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
              <input type="checkbox" name="follow" value="true" defaultChecked /> Follow redirects
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.3rem" }} title="Send a second request after 2s to verify caching behavior">
              <input type="checkbox" name="double" value="true" /> Cache test
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.3rem" }} title="Send Pantheon-Debug: 1 header to reveal platform details (site UUID, environment, PHP version)">
              <input type="checkbox" name="debug" value="true" defaultChecked={options ? options.debug : true} /> Pantheon Debug
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.3rem" }} title="Send Fastly-Debug: 1 header to reveal CDN cache state, POP, and timing details">
              <input type="checkbox" name="fdebug" value="true" defaultChecked={options ? options.fdebug : true} /> Fastly Debug
            </label>
          </div>

          {/* Advanced options — collapsed by default */}
          <details style={{ marginTop: "0.75rem" }}>
            <summary style={{ cursor: "pointer", fontSize: "0.85rem", fontWeight: 600, color: "var(--color-primary)" }}>
              Advanced Options
            </summary>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap", marginTop: "0.5rem", padding: "0.75rem", background: "var(--color-surface)", borderRadius: "6px" }}>
              <div style={{ minWidth: "100px", maxWidth: "130px" }}>
                <label htmlFor="warmup-input" style={{ display: "block", fontWeight: 600, fontSize: "0.8rem", marginBottom: "0.25rem" }} title="Number of sequential requests to send before the main check — tests cache warm-up behavior">
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
        <div className="loading-center" role="status" aria-live="polite">
          <div style={{ margin: "0 auto 1rem" }}>
            <svg aria-hidden="true" viewBox="0 0 50 50" width="40" height="40">
              <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeWidth="4" strokeDasharray="90 60" strokeLinecap="round">
                <animateTransform attributeName="transform" type="rotate" dur="0.8s" from="0 25 25" to="360 25 25" repeatCount="indefinite" />
              </circle>
            </svg>
          </div>
          <p style={{ fontWeight: 600 }}>{CHECK_STEPS[checkStep]}</p>
          <p style={{ fontSize: "0.75rem", color: "var(--color-text-faint)", marginTop: "0.25rem" }}>Usually takes 3–5 seconds</p>
        </div>
      )}

      {error && (
        <Callout type="critical" title="Check failed">
          <p>{error}</p>
          <div style={{ marginTop: "0.5rem" }}>
            <Button label="Retry" variant="brand" onClick={() => formRef.current?.requestSubmit()} />
          </div>
        </Callout>
      )}

      {result && !isChecking && <CheckResults result={result} options={options} />}

      {/* Landing page when no check has been run */}
      {!result && !isChecking && !error && (
        <div className="landing">
          <h2>How healthy is your website?</h2>
          <p>
            Get a comprehensive audit in seconds — DNS, security headers, TLS, SEO, performance, and email authentication analyzed in one check.
          </p>

          <div className="landing-features">
            {[
              {
                title: "Security & Infrastructure",
                desc: "TLS certificates, security headers scorecard, DNS records, and Pantheon platform detection.",
                icon: (
                  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  </svg>
                ),
              },
              {
                title: "Performance & SEO",
                desc: "Lighthouse scores, Core Web Vitals, meta tags, sitemap, structured data, and content analysis.",
                icon: (
                  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                  </svg>
                ),
              },
              {
                title: "AI-Powered Insights",
                desc: "Prioritized findings and actionable next steps generated by AI analysis of your full site report.",
                icon: (
                  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5v1h-4v-1C8.8 8.8 8 7.5 8 6a4 4 0 0 1 4-4z"/>
                    <path d="M10 14h4"/><path d="M10 18h4"/><path d="M11 22h2"/>
                  </svg>
                ),
              },
            ].map((item, i) => (
              <div key={i} className="landing-feature">
                <div className="landing-feature__icon">{item.icon}</div>
                <div className="landing-feature__title">{item.title}</div>
                <div className="landing-feature__desc">{item.desc}</div>
              </div>
            ))}
          </div>

          <p className="landing-footer">
            Free and open to everyone. Powered by Pantheon.
          </p>
        </div>
      )}
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

  const gradeColor = useCallback((grade: string) => grade <= "B" ? "var(--color-success)" : grade <= "C" ? "var(--color-warning)" : "var(--color-danger)", []);
  const scoreColor = useCallback((score: number) => score >= 80 ? "var(--color-success)" : score >= 50 ? "var(--color-warning)" : "var(--color-danger)", []);
  const errors = useMemo(() => result.insights.filter(i => i.severity === "error"), [result.insights]);
  const warnings = useMemo(() => result.insights.filter(i => i.severity === "warning"), [result.insights]);
  const infos = useMemo(() => result.insights.filter(i => i.severity === "info"), [result.insights]);
  const domainHost = result.url.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];

  return (
    <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {/* ── Score Dashboard ── */}
      <div className="score-dashboard">
        {[
          { label: "HTTP", target: "sec-response", value: result.http?.status_code || "\u2014", color: result.http?.status_code && result.http.status_code < 300 ? "var(--color-success)" : result.http?.status_code && result.http.status_code < 400 ? "var(--color-warning)" : "var(--color-danger)",
            hint: result.http?.status_code === 200 ? "Site responding normally" : result.http?.status_code ? `Status ${result.http.status_code}` : "" },
          { label: "Security", target: "sec-security", value: result.security?.grade || "\u2014", color: result.security ? gradeColor(result.security.grade) : "var(--color-text-muted)",
            hint: result.security ? `${result.security.headers.filter(h => h.present).length} of ${result.security.headers.length} headers present` : "" },
          { label: "SEO", target: "sec-seo", value: seo?.score ?? (seoLoading ? "\u2026" : "\u2014"), color: seo ? scoreColor(seo.score) : "var(--color-text-muted)",
            hint: seo ? `${seo.issues?.length || 0} issues found` : seoLoading ? "Analyzing..." : "" },
          { label: "Performance", target: "sec-perf", value: lighthouse?.performance ?? (lhLoading ? "\u2026" : "\u2014"), color: lighthouse?.performance ? scoreColor(lighthouse.performance) : "var(--color-text-muted)",
            hint: lighthouse ? `LCP ${lighthouse.lcp || "\u2014"}` : lhLoading ? "Running audit..." : "" },
          { label: "Email", target: "sec-email", value: result.email_auth?.grade || "\u2014", color: result.email_auth ? gradeColor(result.email_auth.grade) : "var(--color-text-muted)",
            hint: result.email_auth ? `SPF ${result.email_auth.spf.found ? "\u2713" : "\u2717"} DMARC ${result.email_auth.dmarc.found ? "\u2713" : "\u2717"}` : "" },
          { label: "Pantheon", target: "sec-infra", value: pantheon.isPantheon ? "\u2713" : "\u2717", color: pantheon.isPantheon ? "var(--color-primary)" : "var(--color-text-muted)",
            hint: pantheon.isPantheon ? (pantheon.cms || "Detected") : "Not detected" },
        ].map((s, i) => (
          <button
            key={i}
            className="score-card"
            onClick={() => document.getElementById(s.target)?.scrollIntoView({ behavior: "smooth", block: "start" })}
            aria-label={`${s.label}: ${s.value}${s.hint ? ` — ${s.hint}` : ""}. Click to jump to section.`}
          >
            <div className="score-card__value" style={{ color: s.color }}>{s.value}</div>
            <div className="score-card__label">{s.label}</div>
            {s.hint && <div className="score-card__hint">{s.hint}</div>}
          </button>
        ))}
      </div>

      {/* ── Context line ── */}
      <div className="context-line">
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
      <div id="ai-analysis">
        <AIAnalysisPanel result={result} seo={seo} lighthouse={lighthouse} />
      </div>

      {/* ── Login nudge ── */}
      <ProServicesCTA variant="inline" />

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
        <div className="section-group-label">Advanced Tools</div>
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
                <Button label="Discover Subdomains" onClick={discoverSubdomains} variant="secondary" />
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

      {/* ── Bottom AI trigger ── */}
      <div style={{ textAlign: "center", padding: "0.75rem 0" }}>
        <button
          onClick={() => {
            const el = document.getElementById("ai-analysis");
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.4rem",
            padding: "0.5rem 1rem", borderRadius: "var(--radius-sm)",
            border: "1px solid var(--color-ai-border)", background: "var(--color-ai-surface)",
            cursor: "pointer", fontSize: "0.8rem", fontWeight: 600, color: "var(--color-primary)",
          }}
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5v1h-4v-1C8.8 8.8 8 7.5 8 6a4 4 0 0 1 4-4z"/>
            <path d="M10 14h4"/><path d="M10 18h4"/><path d="M11 22h2"/>
          </svg>
          Analyze with AI
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 9 6 15"/>
          </svg>
        </button>
      </div>

      {/* ── Professional Services CTA ── */}
      <ProServicesCTA variant="footer" />
    </div>
  );
}
