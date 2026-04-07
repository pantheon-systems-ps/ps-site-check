import type { Route } from "./+types/compare";
import { useState } from "react";
import { Form, useNavigation } from "react-router";
import { Panel, Button, Callout, Tabs } from "@pantheon-systems/pds-toolkit-react";

const SITE_CHECK_API =
  process.env.SITE_CHECK_API_URL ||
  "https://api.site-check.ps-pantheon.com";

type SiteCheckResult = {
  id: string;
  url: string;
  timestamp: string;
  duration_ms: number;
  dns: {
    a: string[];
    aaaa: string[];
    cname: string[];
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
  tls: {
    protocol: string;
    cipher_suite?: string;
    subject: string;
    issuer: string;
    valid_from: string;
    valid_to: string;
    sans: string[];
    duration_ms: number;
    error?: string;
  };
  insights: { severity: string; category: string; message: string }[];
};

type CrawlPage = {
  url: string;
  status_code: number;
  title?: string;
  duration_ms: number;
  depth: number;
  error?: string;
};

type CrawlResult = {
  url: string;
  depth: number;
  total_pages: number;
  pages: CrawlPage[];
  errors: number;
  duration_ms: number;
  error?: string;
};

type CompareMatch = {
  path: string;
  status_code_a: number;
  status_code_b: number;
  match: boolean;
};

type CompareResult = {
  site_a: CrawlResult;
  site_b: CrawlResult;
  matches: CompareMatch[];
  only_in_a: string[];
  only_in_b: string[];
  status_diffs: CompareMatch[];
  match_rate: number;
  duration_ms: number;
};

// -- Loader (quick compare) --

export async function loader({ request }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams;
  const urlA = params.get("url_a");
  const urlB = params.get("url_b");

  if (!urlA || !urlB) {
    return { resultA: null, resultB: null, error: null };
  }

  const buildApiUrl = (url: string) => {
    const apiURL = new URL(`${SITE_CHECK_API}/check`);
    apiURL.searchParams.set("url", url);
    apiURL.searchParams.set("debug", "true");
    apiURL.searchParams.set("fdebug", "true");
    apiURL.searchParams.set("follow", "true");
    return apiURL.toString();
  };

  try {
    const [respA, respB] = await Promise.all([
      fetch(buildApiUrl(urlA)),
      fetch(buildApiUrl(urlB)),
    ]);

    if (!respA.ok) {
      return { resultA: null, resultB: null, error: `URL A: API returned ${respA.status}` };
    }
    if (!respB.ok) {
      return { resultA: null, resultB: null, error: `URL B: API returned ${respB.status}` };
    }

    const [resultA, resultB]: [SiteCheckResult, SiteCheckResult] = await Promise.all([
      respA.json(),
      respB.json(),
    ]);

    return { resultA, resultB, error: null };
  } catch (e) {
    return {
      resultA: null,
      resultB: null,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

// -- Main component --

export default function Compare({ loaderData }: Route.ComponentProps) {
  const { resultA, resultB, error } = loaderData;
  const navigation = useNavigation();
  const isChecking = navigation.state === "loading";

  // Crawl state (client-side)
  const [crawlResult, setCrawlResult] = useState<CompareResult | null>(null);
  const [crawlLoading, setCrawlLoading] = useState(false);
  const [crawlError, setCrawlError] = useState<string | null>(null);
  const [crawlSiteA, setCrawlSiteA] = useState("");
  const [crawlSiteB, setCrawlSiteB] = useState("");
  const [crawlDepth, setCrawlDepth] = useState(2);

  const runCrawlCompare = async () => {
    setCrawlLoading(true);
    setCrawlError(null);
    setCrawlResult(null);
    try {
      const resp = await fetch(`${SITE_CHECK_API}/compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_a: crawlSiteA, site_b: crawlSiteB, depth: crawlDepth }),
      });
      if (!resp.ok) {
        const err = await resp.json();
        setCrawlError(err.error || `API returned ${resp.status}`);
      } else {
        setCrawlResult(await resp.json());
      }
    } catch (e) {
      setCrawlError(e instanceof Error ? e.message : "Unknown error");
    }
    setCrawlLoading(false);
  };

  const tabItems = [
    {
      id: "quick",
      label: "Quick Compare",
      content: (
        <div className="pds-spacing-mar-block-start-m">
          <Panel className="pds-spacing-mar-block-end-l">
            <Form method="get">
              <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: "200px" }}>
                  <label htmlFor="url-a-input" style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}>URL A</label>
                  <input id="url-a-input" name="url_a" type="text" placeholder="example.com" defaultValue={resultA?.url?.replace(/^https?:\/\//, "") || ""} required className="pds-input" style={{ width: "100%", padding: "0.5rem 0.75rem" }} />
                </div>
                <div style={{ flex: 1, minWidth: "200px" }}>
                  <label htmlFor="url-b-input" style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}>URL B</label>
                  <input id="url-b-input" name="url_b" type="text" placeholder="staging.example.com" defaultValue={resultB?.url?.replace(/^https?:\/\//, "") || ""} required className="pds-input" style={{ width: "100%", padding: "0.5rem 0.75rem" }} />
                </div>
                <div>
                  <Button label={isChecking ? "Comparing..." : "Compare"} buttonType="submit" variant="brand" disabled={isChecking} />
                </div>
              </div>
            </Form>
          </Panel>

          {isChecking && <Spinner message="Comparing sites..." />}
          {error && <Callout type="critical" title="Comparison failed"><p>{error}</p></Callout>}
          {resultA && resultB && !isChecking && <QuickComparisonResults resultA={resultA} resultB={resultB} />}
        </div>
      ),
    },
    {
      id: "crawl",
      label: "Crawl & Compare",
      content: (
        <div className="pds-spacing-mar-block-start-m">
          <Callout type="info" title="Site Crawl Comparison" className="pds-spacing-mar-block-end-m">
            <p>Crawls both sites at the selected depth, discovering all same-domain links, and compares URL paths and status codes. Great for migration validation.</p>
          </Callout>

          <Panel className="pds-spacing-mar-block-end-l">
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: "200px" }}>
                <label htmlFor="crawl-a" style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}>Site A (Source)</label>
                <input id="crawl-a" type="text" placeholder="old-site.example.com" value={crawlSiteA} onChange={e => setCrawlSiteA(e.target.value)} className="pds-input" style={{ width: "100%", padding: "0.5rem 0.75rem" }} />
              </div>
              <div style={{ flex: 1, minWidth: "200px" }}>
                <label htmlFor="crawl-b" style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}>Site B (Destination)</label>
                <input id="crawl-b" type="text" placeholder="new-site.pantheonsite.io" value={crawlSiteB} onChange={e => setCrawlSiteB(e.target.value)} className="pds-input" style={{ width: "100%", padding: "0.5rem 0.75rem" }} />
              </div>
              <div style={{ minWidth: "120px" }}>
                <label htmlFor="crawl-depth" style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}>Depth</label>
                <select id="crawl-depth" value={crawlDepth} onChange={e => setCrawlDepth(parseInt(e.target.value))} className="pds-input" style={{ width: "100%", padding: "0.5rem 0.75rem" }}>
                  <option value={1}>1 (URL only)</option>
                  <option value={2}>2 (+ linked pages)</option>
                  <option value={3}>3 (+ 2nd level)</option>
                </select>
              </div>
              <div>
                <Button label={crawlLoading ? "Crawling..." : "Crawl & Compare"} onClick={runCrawlCompare} variant="brand" disabled={crawlLoading || !crawlSiteA || !crawlSiteB} />
              </div>
            </div>
          </Panel>

          {crawlLoading && <Spinner message="Crawling both sites... this may take a moment." />}
          {crawlError && <Callout type="critical" title="Crawl failed"><p>{crawlError}</p></Callout>}
          {crawlResult && !crawlLoading && <CrawlComparisonResults result={crawlResult} />}
        </div>
      ),
    },
  ];

  return (
    <>
      <h2>Compare Two Sites</h2>
      <Callout type="info" title="Side-by-Side Comparison" className="pds-spacing-mar-block-end-l">
        <p>
          <strong>Quick Compare</strong> checks DNS, HTTP, and TLS for two URLs.{" "}
          <strong>Crawl & Compare</strong> discovers pages at configurable depth and diffs URL paths and status codes for migration validation.
        </p>
      </Callout>

      <Tabs tabItems={tabItems} />
    </>
  );
}

// -- Quick comparison results (existing) --

function QuickComparisonResults({ resultA, resultB }: { resultA: SiteCheckResult; resultB: SiteCheckResult }) {
  const [aiResult, setAiResult] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const analyzeCompare = async () => {
    setAiLoading(true);
    try {
      const resp = await fetch(`${SITE_CHECK_API}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "compare", compare_a: resultA, compare_b: resultB }),
      });
      setAiResult(await resp.json());
    } catch (e) {
      setAiResult({ error: e instanceof Error ? e.message : "Unknown error" });
    }
    setAiLoading(false);
  };

  const headersA = resultA.http?.headers || {};
  const headersB = resultB.http?.headers || {};

  const rows: { label: string; valueA: string; valueB: string }[] = [
    { label: "HTTP Status", valueA: resultA.http?.status_code?.toString() || "\u2014", valueB: resultB.http?.status_code?.toString() || "\u2014" },
    { label: "TLS Protocol", valueA: resultA.tls?.protocol || "\u2014", valueB: resultB.tls?.protocol || "\u2014" },
    { label: "Certificate Issuer", valueA: resultA.tls?.issuer || "\u2014", valueB: resultB.tls?.issuer || "\u2014" },
    { label: "DNS A Records", valueA: resultA.dns?.a?.join(", ") || "\u2014", valueB: resultB.dns?.a?.join(", ") || "\u2014" },
    { label: "X-Cache", valueA: headersA["x-cache"] || "\u2014", valueB: headersB["x-cache"] || "\u2014" },
    { label: "HSTS", valueA: headersA["strict-transport-security"] ? "Present" : "Absent", valueB: headersB["strict-transport-security"] ? "Present" : "Absent" },
    { label: "Server", valueA: headersA["server"] || "\u2014", valueB: headersB["server"] || "\u2014" },
    { label: "Response Time (ms)", valueA: resultA.http?.duration_ms?.toString() || "\u2014", valueB: resultB.http?.duration_ms?.toString() || "\u2014" },
    { label: "Total Duration (ms)", valueA: resultA.duration_ms?.toString() || "\u2014", valueB: resultB.duration_ms?.toString() || "\u2014" },
  ];

  return (
    <div className="pds-spacing-mar-block-start-l">
      {/* AI Analysis */}
      <div style={{ textAlign: "center", marginBottom: "1rem" }}>
        {!aiResult && !aiLoading && (
          <button onClick={analyzeCompare} style={{ padding: "0.5rem 1.25rem", borderRadius: "6px", border: "1px solid #e5e7eb", background: "linear-gradient(135deg, #f0f0ff 0%, #fff 100%)", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600, color: "#4f46e5" }}>
            Analyze Comparison with AI
          </button>
        )}
        {aiLoading && <p style={{ color: "#666", fontSize: "0.85rem" }}>Analyzing with Claude Opus...</p>}
        {aiResult && !aiResult.error && (
          <div style={{ textAlign: "left", padding: "1rem", background: "#f8f7ff", borderRadius: "8px", border: "1px solid #e0e0f0", marginBottom: "1rem" }}>
            <h4 style={{ margin: "0 0 0.5rem", color: "#4f46e5", fontSize: "0.95rem" }}>AI Analysis</h4>
            {aiResult.summary && <p style={{ fontSize: "0.9rem", color: "#333", lineHeight: 1.5 }}>{aiResult.summary}</p>}
            {aiResult.findings?.length > 0 && <ul style={{ fontSize: "0.85rem", color: "#444", lineHeight: 1.6 }}>{aiResult.findings.map((f: string, i: number) => <li key={i}>{f}</li>)}</ul>}
            {aiResult.next_steps?.length > 0 && (
              <>
                <h5 style={{ fontSize: "0.8rem", color: "#888", textTransform: "uppercase", margin: "0.5rem 0 0.25rem" }}>Next Steps</h5>
                <ol style={{ fontSize: "0.85rem", color: "#444", lineHeight: 1.6 }}>{aiResult.next_steps.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol>
              </>
            )}
          </div>
        )}
        {aiResult?.error && <Callout type="warning" title="AI Analysis Error"><p>{aiResult.error}</p></Callout>}
      </div>

      {/* Comparison table */}
      <Panel className="pds-spacing-mar-block-end-l">
        <h3>Comparison</h3>
        <p style={{ color: "#666", fontSize: "0.85rem" }}>
          <strong>A:</strong> {resultA.url} ({resultA.duration_ms}ms) {" \u00B7 "} <strong>B:</strong> {resultB.url} ({resultB.duration_ms}ms)
        </p>
        <table className="pds-table">
          <thead><tr><th style={{ width: "20%" }}>Property</th><th style={{ width: "40%" }}>URL A</th><th style={{ width: "40%" }}>URL B</th></tr></thead>
          <tbody>
            {rows.map((row, i) => {
              const match = row.valueA === row.valueB;
              const cellStyle = { fontSize: "0.85rem", wordBreak: "break-all" as const, backgroundColor: match ? "#f0fdf4" : "#fefce8" };
              const isStatus = row.label === "HTTP Status";
              return (
                <tr key={i}>
                  <td style={{ fontWeight: 600, fontSize: "0.85rem" }}>{row.label}</td>
                  <td style={cellStyle}>{isStatus ? <StatusBadge code={parseInt(row.valueA, 10) || undefined} /> : row.valueA}</td>
                  <td style={cellStyle}>{isStatus ? <StatusBadge code={parseInt(row.valueB, 10) || undefined} /> : row.valueB}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      {/* Insights comparison */}
      <Panel className="pds-spacing-mar-block-end-l">
        <h3>Insights</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <InsightColumn label="URL A" insights={resultA.insights} otherInsights={resultB.insights} tag="A only" />
          <InsightColumn label="URL B" insights={resultB.insights} otherInsights={resultA.insights} tag="B only" />
        </div>
      </Panel>
    </div>
  );
}

// -- Crawl comparison results --

function CrawlComparisonResults({ result }: { result: CompareResult }) {
  const matchPct = (result.match_rate * 100).toFixed(1);
  const matchColor = result.match_rate >= 0.9 ? "#16a34a" : result.match_rate >= 0.7 ? "#ca8a04" : "#dc2626";

  return (
    <div className="pds-spacing-mar-block-start-l">
      {/* Summary stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        <StatCard label="Match Rate" value={`${matchPct}%`} color={matchColor} />
        <StatCard label="Site A Pages" value={result.site_a.total_pages.toString()} />
        <StatCard label="Site B Pages" value={result.site_b.total_pages.toString()} />
        <StatCard label="Status Diffs" value={(result.status_diffs?.length || 0).toString()} color={result.status_diffs?.length ? "#dc2626" : "#16a34a"} />
        <StatCard label="Only in A" value={(result.only_in_a?.length || 0).toString()} color={result.only_in_a?.length ? "#ca8a04" : "#16a34a"} />
        <StatCard label="Only in B" value={(result.only_in_b?.length || 0).toString()} color={result.only_in_b?.length ? "#ca8a04" : "#16a34a"} />
      </div>

      {/* Status diffs */}
      {result.status_diffs && result.status_diffs.length > 0 && (
        <Panel className="pds-spacing-mar-block-end-l">
          <h3 style={{ color: "#dc2626" }}>Status Code Differences</h3>
          <table className="pds-table">
            <thead><tr><th>Path</th><th>Site A</th><th>Site B</th></tr></thead>
            <tbody>
              {result.status_diffs.map((d, i) => (
                <tr key={i} style={{ backgroundColor: "#fef2f2" }}>
                  <td style={{ fontSize: "0.85rem", wordBreak: "break-all" }}>{d.path}</td>
                  <td><StatusBadge code={d.status_code_a} /></td>
                  <td><StatusBadge code={d.status_code_b} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {/* Only in A */}
      {result.only_in_a && result.only_in_a.length > 0 && (
        <Panel className="pds-spacing-mar-block-end-l">
          <h3>Only in Site A ({result.only_in_a.length})</h3>
          <p style={{ fontSize: "0.8rem", color: "#666" }}>Pages found in Site A but not in Site B. These may be missing after migration.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            {result.only_in_a.map((path, i) => (
              <code key={i} style={{ fontSize: "0.8rem", padding: "0.25rem 0.5rem", background: "#fefce8", borderRadius: "4px" }}>{path}</code>
            ))}
          </div>
        </Panel>
      )}

      {/* Only in B */}
      {result.only_in_b && result.only_in_b.length > 0 && (
        <Panel className="pds-spacing-mar-block-end-l">
          <h3>Only in Site B ({result.only_in_b.length})</h3>
          <p style={{ fontSize: "0.8rem", color: "#666" }}>Pages found in Site B but not in Site A. These may be new pages on the destination.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            {result.only_in_b.map((path, i) => (
              <code key={i} style={{ fontSize: "0.8rem", padding: "0.25rem 0.5rem", background: "#f0fdf4", borderRadius: "4px" }}>{path}</code>
            ))}
          </div>
        </Panel>
      )}

      {/* Matching pages */}
      {result.matches && result.matches.length > 0 && (
        <Panel className="pds-spacing-mar-block-end-l">
          <h3>Matching Pages ({result.matches.filter(m => m.match).length}/{result.matches.length})</h3>
          <table className="pds-table">
            <thead><tr><th>Path</th><th>Site A</th><th>Site B</th><th>Match</th></tr></thead>
            <tbody>
              {result.matches.map((m, i) => (
                <tr key={i} style={{ backgroundColor: m.match ? "#f0fdf4" : "#fefce8" }}>
                  <td style={{ fontSize: "0.85rem", wordBreak: "break-all" }}>{m.path}</td>
                  <td><StatusBadge code={m.status_code_a} /></td>
                  <td><StatusBadge code={m.status_code_b} /></td>
                  <td style={{ textAlign: "center" }}>{m.match ? "\u2705" : "\u274C"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <p style={{ color: "#999", fontSize: "0.8rem", textAlign: "center" }}>
        Crawl completed in {result.duration_ms}ms
      </p>
    </div>
  );
}

// -- Shared utilities --

function Spinner({ message }: { message: string }) {
  return (
    <div style={{ textAlign: "center", padding: "2rem" }}>
      <div style={{ margin: "0 auto 1rem" }}>
        <svg viewBox="0 0 50 50" width="40" height="40">
          <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeWidth="4" strokeDasharray="90 60" strokeLinecap="round">
            <animateTransform attributeName="transform" type="rotate" dur="0.8s" from="0 25 25" to="360 25 25" repeatCount="indefinite" />
          </circle>
        </svg>
      </div>
      <p style={{ color: "#666" }}>{message}</p>
    </div>
  );
}

function StatusBadge({ code }: { code?: number }) {
  if (!code) return <span>{"\u2014"}</span>;
  const color = code < 300 ? "#16a34a" : code < 400 ? "#ca8a04" : "#dc2626";
  return <span style={{ color, fontWeight: 700, fontSize: "1.1rem" }}>{code}</span>;
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ padding: "1rem", background: "#fff", borderRadius: "8px", border: "1px solid #e5e7eb", textAlign: "center" }}>
      <div style={{ fontSize: "1.5rem", fontWeight: 700, color: color || "#1a1a1a" }}>{value}</div>
      <div style={{ fontSize: "0.8rem", color: "#666", marginTop: "0.25rem" }}>{label}</div>
    </div>
  );
}

function InsightColumn({ label, insights, otherInsights, tag }: { label: string; insights: SiteCheckResult["insights"]; otherInsights: SiteCheckResult["insights"]; tag: string }) {
  return (
    <div>
      <h4 style={{ fontSize: "0.9rem", marginBottom: "0.5rem" }}>{label} ({insights.length})</h4>
      {insights.length === 0 ? (
        <p style={{ color: "#999", fontSize: "0.85rem" }}>No insights</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {insights.map((insight, i) => {
            const inOther = otherInsights.some(o => o.category === insight.category && o.message === insight.message);
            return (
              <div key={i} style={{ padding: "0.5rem 0.75rem", borderRadius: "4px", fontSize: "0.8rem", backgroundColor: inOther ? "#f0fdf4" : "#fefce8", borderLeft: `3px solid ${insight.severity === "error" ? "#dc2626" : insight.severity === "warning" ? "#ca8a04" : "#3b82f6"}` }}>
                <strong>{insight.category.toUpperCase()}</strong> {"\u2014"} {insight.message}
                {!inOther && <span style={{ marginLeft: "0.5rem", fontSize: "0.7rem", color: "#ca8a04", fontWeight: 600 }}>{tag}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
