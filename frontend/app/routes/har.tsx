import { useState, useCallback } from "react";
import { Panel, Button, Callout } from "@pantheon-systems/pds-toolkit-react";

const SITE_CHECK_API =
  process.env.SITE_CHECK_API_URL ||
  "https://api.site-check.ps-pantheon.com";

type HARRequestInfo = {
  url: string;
  method: string;
  status: number;
  time_ms: number;
  size_kb: number;
  mime_type: string;
  wait_ms?: number;
};

type HARDomainStats = {
  domain: string;
  requests: number;
  size_kb: number;
  avg_ms: number;
};

type HARTypeStats = {
  type: string;
  requests: number;
  size_kb: number;
};

type HARAnalysis = {
  summary: {
    total_requests: number;
    total_size_kb: number;
    total_time_ms: number;
    domains: number;
    pages: number;
    creator: string;
  };
  slow_requests: HARRequestInfo[];
  error_entries: HARRequestInfo[];
  by_domain: HARDomainStats[];
  by_type: HARTypeStats[];
  cache_stats: {
    cache_hits: number;
    cache_misses: number;
    no_cache: number;
  };
  insights: { severity: string; category: string; message: string }[];
};

export default function HAR() {
  const [analysis, setAnalysis] = useState<HARAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const uploadHAR = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setFileName(file.name);

    try {
      const text = await file.text();
      const resp = await fetch(`${SITE_CHECK_API}/check-har`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      });

      if (!resp.ok) {
        const err = await resp.json();
        setError(err.error || `API returned ${resp.status}`);
      } else {
        setAnalysis(await resp.json());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    }
    setLoading(false);
  }, []);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadHAR(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadHAR(file);
  };

  return (
    <>
      <h2>HAR Analyzer</h2>
      <Callout type="info" title="HTTP Archive Analysis" className="pds-spacing-mar-block-end-l">
        <p>
          Upload a HAR file exported from your browser's DevTools to analyze
          request counts, page weight, slow requests, error responses, cache
          behavior, and third-party domain impact.
        </p>
      </Callout>

      {/* Upload zone */}
      <Panel className="pds-spacing-mar-block-end-l">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={{
            border: `2px dashed ${dragOver ? "#4f46e5" : "#d1d5db"}`,
            borderRadius: "12px",
            padding: "3rem 2rem",
            textAlign: "center",
            background: dragOver ? "#f0f0ff" : "#fafafa",
            transition: "all 0.15s ease",
            cursor: "pointer",
          }}
          onClick={() => document.getElementById("har-file-input")?.click()}
        >
          <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>{"\uD83D\uDCC2"}</div>
          <p style={{ fontWeight: 600, fontSize: "1rem", marginBottom: "0.5rem" }}>
            {loading ? "Analyzing..." : "Drop a .har file here or click to browse"}
          </p>
          <p style={{ color: "#999", fontSize: "0.85rem" }}>
            Export from Chrome DevTools: Network tab {"\u2192"} right-click {"\u2192"} Save all as HAR
          </p>
          <input
            id="har-file-input"
            type="file"
            accept=".har,application/json"
            onChange={handleFile}
            style={{ display: "none" }}
          />
          {fileName && !loading && (
            <p style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "#4f46e5", fontWeight: 500 }}>
              {fileName}
            </p>
          )}
        </div>
      </Panel>

      {loading && (
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <svg viewBox="0 0 50 50" width="40" height="40">
            <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeWidth="4" strokeDasharray="90 60" strokeLinecap="round">
              <animateTransform attributeName="transform" type="rotate" dur="0.8s" from="0 25 25" to="360 25 25" repeatCount="indefinite" />
            </circle>
          </svg>
          <p style={{ color: "#666", marginTop: "0.5rem" }}>Analyzing HAR file...</p>
        </div>
      )}

      {error && (
        <Callout type="critical" title="Analysis failed">
          <p>{error}</p>
        </Callout>
      )}

      {analysis && !loading && <HARResults analysis={analysis} />}
    </>
  );
}

// -- Results display --

function HARResults({ analysis }: { analysis: HARAnalysis }) {
  const s = analysis.summary;
  const cacheTotal = analysis.cache_stats.cache_hits + analysis.cache_stats.cache_misses;
  const cacheRatio = cacheTotal > 0 ? (analysis.cache_stats.cache_hits / cacheTotal * 100) : 0;

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <StatCard label="Requests" value={s.total_requests.toString()} />
        <StatCard label="Page Weight" value={formatKB(s.total_size_kb)} />
        <StatCard label="Domains" value={s.domains.toString()} />
        <StatCard label="Cache Hit Rate" value={cacheTotal > 0 ? `${cacheRatio.toFixed(0)}%` : "N/A"} color={cacheRatio >= 70 ? "#16a34a" : cacheRatio >= 40 ? "#ca8a04" : "#dc2626"} />
        <StatCard label="Errors" value={(analysis.error_entries?.length || 0).toString()} color={analysis.error_entries?.length ? "#dc2626" : "#16a34a"} />
        <StatCard label="Slow (>1s)" value={(analysis.slow_requests?.length || 0).toString()} color={analysis.slow_requests?.length > 5 ? "#dc2626" : analysis.slow_requests?.length ? "#ca8a04" : "#16a34a"} />
      </div>

      {/* Insights */}
      {analysis.insights && analysis.insights.length > 0 && (
        <Panel className="pds-spacing-mar-block-end-l">
          <h3>Insights</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            {analysis.insights.map((insight, i) => (
              <div key={i} style={{
                padding: "0.5rem 0.75rem", borderRadius: "4px", fontSize: "0.85rem",
                background: insight.severity === "error" ? "#fef2f2" : insight.severity === "warning" ? "#fffbeb" : "#f0f9ff",
                borderLeft: `3px solid ${insight.severity === "error" ? "#dc2626" : insight.severity === "warning" ? "#ca8a04" : "#2563eb"}`,
              }}>
                <strong>{insight.category.toUpperCase()}</strong> {"\u2014"} {insight.message}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Error entries */}
      {analysis.error_entries && analysis.error_entries.length > 0 && (
        <Panel className="pds-spacing-mar-block-end-l">
          <h3 style={{ color: "#dc2626" }}>Error Responses ({analysis.error_entries.length})</h3>
          <table className="pds-table" style={{ fontSize: "0.85rem" }}>
            <thead>
              <tr><th>Status</th><th>Method</th><th>URL</th><th>Type</th><th>Size</th></tr>
            </thead>
            <tbody>
              {analysis.error_entries.map((req, i) => (
                <tr key={i} style={{ backgroundColor: "#fef2f2" }}>
                  <td><StatusBadge code={req.status} /></td>
                  <td>{req.method}</td>
                  <td style={{ wordBreak: "break-all", maxWidth: "400px" }}>{req.url}</td>
                  <td>{req.mime_type}</td>
                  <td>{formatKB(req.size_kb)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {/* Slow requests */}
      {analysis.slow_requests && analysis.slow_requests.length > 0 && (
        <Panel className="pds-spacing-mar-block-end-l">
          <h3>Slow Requests ({analysis.slow_requests.length})</h3>
          <p style={{ fontSize: "0.8rem", color: "#666", marginBottom: "0.5rem" }}>Requests taking over 1 second, sorted by duration.</p>
          <table className="pds-table" style={{ fontSize: "0.85rem" }}>
            <thead>
              <tr><th>Time</th><th>Wait</th><th>Status</th><th>URL</th><th>Type</th><th>Size</th></tr>
            </thead>
            <tbody>
              {analysis.slow_requests.map((req, i) => (
                <tr key={i} style={{ backgroundColor: req.time_ms > 3000 ? "#fef2f2" : "#fffbeb" }}>
                  <td style={{ fontWeight: 600, color: req.time_ms > 3000 ? "#dc2626" : "#ca8a04" }}>{formatMS(req.time_ms)}</td>
                  <td>{req.wait_ms ? formatMS(req.wait_ms) : "\u2014"}</td>
                  <td><StatusBadge code={req.status} /></td>
                  <td style={{ wordBreak: "break-all", maxWidth: "350px" }}>{req.url}</td>
                  <td>{req.mime_type}</td>
                  <td>{formatKB(req.size_kb)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {/* By domain */}
      {analysis.by_domain && analysis.by_domain.length > 0 && (
        <Panel className="pds-spacing-mar-block-end-l">
          <h3>Requests by Domain ({analysis.by_domain.length})</h3>
          <table className="pds-table" style={{ fontSize: "0.85rem" }}>
            <thead>
              <tr><th>Domain</th><th>Requests</th><th>Size</th><th>Avg Time</th></tr>
            </thead>
            <tbody>
              {analysis.by_domain.map((d, i) => {
                const pct = s.total_requests > 0 ? (d.requests / s.total_requests * 100).toFixed(0) : "0";
                return (
                  <tr key={i}>
                    <td style={{ fontWeight: i === 0 ? 600 : 400 }}>{d.domain}</td>
                    <td>
                      {d.requests}
                      <span style={{ color: "#999", fontSize: "0.75rem", marginLeft: "0.25rem" }}>({pct}%)</span>
                    </td>
                    <td>{formatKB(d.size_kb)}</td>
                    <td style={{ color: d.avg_ms > 1000 ? "#dc2626" : d.avg_ms > 500 ? "#ca8a04" : "#666" }}>{formatMS(d.avg_ms)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}

      {/* By type */}
      {analysis.by_type && analysis.by_type.length > 0 && (
        <Panel className="pds-spacing-mar-block-end-l">
          <h3>Requests by Content Type</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {analysis.by_type.map((t, i) => (
              <div key={i} style={{
                padding: "0.5rem 1rem", borderRadius: "8px", background: "#f8fafc",
                border: "1px solid #e5e7eb", textAlign: "center", minWidth: "100px",
              }}>
                <div style={{ fontSize: "0.75rem", color: "#999", textTransform: "uppercase", fontWeight: 600 }}>{typeIcon(t.type)} {t.type}</div>
                <div style={{ fontSize: "1.2rem", fontWeight: 700, margin: "0.25rem 0" }}>{t.requests}</div>
                <div style={{ fontSize: "0.75rem", color: "#666" }}>{formatKB(t.size_kb)}</div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Cache stats */}
      {cacheTotal > 0 && (
        <Panel className="pds-spacing-mar-block-end-l">
          <h3>Cache Performance</h3>
          <div style={{ display: "flex", gap: "1.5rem", alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <div style={{ height: "24px", borderRadius: "12px", overflow: "hidden", background: "#fee2e2", display: "flex" }}>
                <div style={{ width: `${cacheRatio}%`, background: "#16a34a", borderRadius: "12px 0 0 12px", transition: "width 0.3s" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.35rem", fontSize: "0.8rem", color: "#666" }}>
                <span>Hits: {analysis.cache_stats.cache_hits}</span>
                <span>Misses: {analysis.cache_stats.cache_misses}</span>
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "2rem", fontWeight: 700, color: cacheRatio >= 70 ? "#16a34a" : cacheRatio >= 40 ? "#ca8a04" : "#dc2626" }}>
                {cacheRatio.toFixed(0)}%
              </div>
              <div style={{ fontSize: "0.75rem", color: "#666" }}>Hit Rate</div>
            </div>
          </div>
          {analysis.cache_stats.no_cache > 0 && (
            <p style={{ fontSize: "0.8rem", color: "#ca8a04", marginTop: "0.5rem" }}>
              {analysis.cache_stats.no_cache} request{analysis.cache_stats.no_cache > 1 ? "s" : ""} with no-cache / no-store directives
            </p>
          )}
        </Panel>
      )}

      {s.creator && (
        <p style={{ fontSize: "0.75rem", color: "#999", textAlign: "center" }}>
          HAR captured by {s.creator} {"\u00B7"} {s.pages > 0 ? `${s.pages} page${s.pages > 1 ? "s" : ""}` : ""}
        </p>
      )}
    </div>
  );
}

// -- Utilities --

function StatusBadge({ code }: { code: number }) {
  const color = code < 300 ? "#16a34a" : code < 400 ? "#ca8a04" : "#dc2626";
  return <span style={{ color, fontWeight: 700 }}>{code}</span>;
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ padding: "1rem", background: "#fff", borderRadius: "8px", border: "1px solid #e5e7eb", textAlign: "center" }}>
      <div style={{ fontSize: "1.5rem", fontWeight: 700, color: color || "#1a1a1a" }}>{value}</div>
      <div style={{ fontSize: "0.8rem", color: "#666", marginTop: "0.25rem" }}>{label}</div>
    </div>
  );
}

function formatKB(kb: number): string {
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb.toFixed(0)} KB`;
}

function formatMS(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms.toFixed(0)}ms`;
}

function typeIcon(type: string): string {
  const icons: Record<string, string> = {
    javascript: "\u2699\uFE0F",
    css: "\uD83C\uDFA8",
    html: "\uD83D\uDCC4",
    image: "\uD83D\uDDBC\uFE0F",
    font: "\uD83D\uDD24",
    json: "{ }",
    xml: "\uD83D\uDCCB",
    video: "\uD83C\uDFA5",
  };
  return icons[type] || "\uD83D\uDCC1";
}
