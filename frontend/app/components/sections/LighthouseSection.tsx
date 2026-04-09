import { useState } from "react";
import { Panel, Callout } from "@pantheon-systems/pds-toolkit-react";
import Badge from "~/components/ui/Badge";

export function LighthouseStrategyTabs({ mobile, desktop, mobileLoading, desktopLoading, crux }: { mobile: any; desktop: any; mobileLoading: boolean; desktopLoading: boolean; crux?: any }) {
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
              color: isActive ? "var(--color-white)" : "var(--color-text-secondary)",
              fontSize: "0.78rem", fontWeight: 600, cursor: "pointer",
              display: "flex", alignItems: "center", gap: "0.35rem", textTransform: "capitalize",
            }}>
              {s}
              {loading && (
                <svg viewBox="0 0 50 50" width="12" height="12">
                  <circle cx="25" cy="25" r="20" fill="none" stroke={isActive ? "var(--color-white)" : "var(--color-primary)"} strokeWidth="6" strokeDasharray="90 60" strokeLinecap="round">
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

      {!isLoading && data && !data.error && <LighthouseTab lighthouse={data} crux={crux} />}
    </div>
  );
}

// -- Helpers for CrUX --

function formatCruxValue(value: number, unit: string): string {
  if (unit === "ms" || unit === "millisecond") {
    if (value >= 1000) return `${(value / 1000).toFixed(2)}`;
    return `${(value / 1000).toFixed(2)}`;
  }
  return value.toFixed(2);
}

function formatCruxUnit(value: number, unit: string): string {
  if (unit === "ms" || unit === "millisecond") return "s";
  return "";
}

function ratingLabel(rating: string): string {
  if (rating === "good") return "Good";
  if (rating === "needs-improvement") return "Needs Improvement";
  if (rating === "poor") return "Poor";
  return rating;
}

function ratingColor(rating: string): string {
  if (rating === "good") return "var(--color-success)";
  if (rating === "needs-improvement") return "var(--color-warning)";
  if (rating === "poor") return "var(--color-danger)";
  return "var(--color-text-muted)";
}

// -- WPT-style Real-World Usage Metrics --

function CrUXFieldMetrics({ crux }: { crux: any }) {
  const metrics = [
    { label: "First Contentful Paint", metric: crux.fcp },
    { label: "Largest Contentful Paint", metric: crux.lcp },
    { label: "Cumulative Layout Shift", metric: crux.cls },
    { label: "Time To First Byte", metric: crux.ttfb },
    { label: "Interaction to Next Paint", metric: crux.inp },
  ].filter(m => m.metric);

  if (metrics.length === 0) return null;

  return (
    <Panel>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h4 style={{ margin: 0 }}>Real-World Usage Metrics</h4>
        <span style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
          Chrome UX Report — 75th percentile of real visits
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem" }}>
        {metrics.map((m) => {
          const color = ratingColor(m.metric.rating);
          const total = m.metric.good + m.metric.ni + m.metric.poor;
          const goodPct = total > 0 ? (m.metric.good / total * 100) : 0;
          const niPct = total > 0 ? (m.metric.ni / total * 100) : 0;
          const poorPct = total > 0 ? (m.metric.poor / total * 100) : 0;
          const isUnitless = m.metric.unit === "unitless" || m.metric.unit === "";
          const displayValue = isUnitless
            ? m.metric.p75.toFixed(2)
            : (m.metric.p75 / 1000).toFixed(2);
          const displayUnit = isUnitless ? "" : "s";

          return (
            <div key={m.label} style={{
              padding: "0.75rem",
              borderRadius: "8px",
              border: "1px solid var(--color-border)",
              background: "var(--color-bg)",
            }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: "0.35rem" }}>
                {m.label}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: "0.25rem", marginBottom: "0.15rem" }}>
                <span style={{ fontSize: "1.6rem", fontWeight: 700, color, lineHeight: 1.1 }}>
                  {displayValue}
                </span>
                <span style={{ fontSize: "0.85rem", fontWeight: 600, color }}>{displayUnit}</span>
                <span style={{
                  fontSize: "0.7rem", fontWeight: 600, color,
                  marginLeft: "0.35rem",
                }}>
                  {ratingLabel(m.metric.rating)}
                </span>
              </div>
              <div style={{ fontSize: "0.65rem", color: "var(--color-text-muted)", marginBottom: "0.5rem" }}>
                At 75th percentile of visits
              </div>
              {/* Distribution bar */}
              <div style={{ display: "flex", height: "18px", borderRadius: "3px", overflow: "hidden", fontSize: "0.6rem", fontWeight: 600 }}>
                {goodPct > 0 && (
                  <div style={{
                    width: `${goodPct}%`, backgroundColor: "var(--color-success)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#fff", minWidth: goodPct > 8 ? "auto" : "0",
                  }}>
                    {goodPct >= 8 && `${goodPct.toFixed(0)}%`}
                  </div>
                )}
                {niPct > 0 && (
                  <div style={{
                    width: `${niPct}%`, backgroundColor: "var(--color-warning)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#fff", minWidth: niPct > 8 ? "auto" : "0",
                  }}>
                    {niPct >= 8 && `${niPct.toFixed(0)}%`}
                  </div>
                )}
                {poorPct > 0 && (
                  <div style={{
                    width: `${poorPct}%`, backgroundColor: "var(--color-danger)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#fff", minWidth: poorPct > 8 ? "auto" : "0",
                  }}>
                    {poorPct >= 8 && `${poorPct.toFixed(0)}%`}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// -- WPT-style Individual Runs table --

function IndividualRunsTable({ lighthouse }: { lighthouse: any }) {
  // Parse timing values from lighthouse strings (e.g., "1.2 s" → 1200)
  const parseMs = (val: string | undefined): number | null => {
    if (!val) return null;
    const match = val.match(/([\d.]+)\s*s/i);
    if (match) return parseFloat(match[1]) * 1000;
    const msMatch = val.match(/([\d.]+)\s*ms/i);
    if (msMatch) return parseFloat(msMatch[1]);
    return null;
  };

  const fcp = parseMs(lighthouse.fcp);
  const lcp = parseMs(lighthouse.lcp);
  const tti = parseMs(lighthouse.tti);
  const si = parseMs(lighthouse.speed_index);
  const tbt = parseMs(lighthouse.tbt);
  const pageWeight = lighthouse.page_weight || 0;

  // Build timing entries — only include ones we have
  const entries: { label: string; value: number; display: string; color: string }[] = [];
  if (fcp != null) entries.push({ label: "First Contentful Paint", value: fcp, display: `${Math.round(fcp)}`, color: "#e37400" });
  if (si != null) entries.push({ label: "Speed Index", value: si, display: `${Math.round(si)}`, color: "#c04b86" });
  if (lcp != null) entries.push({ label: "Largest Contentful Paint", value: lcp, display: `${Math.round(lcp)}`, color: "#1a73e8" });
  if (tti != null) entries.push({ label: "Time to Interactive", value: tti, display: `${Math.round(tti)}`, color: "#6d4cc7" });
  if (tbt != null) entries.push({ label: "Total Blocking Time", value: tbt, display: `${Math.round(tbt)}`, color: "#d93025" });

  if (entries.length === 0) return null;

  const maxVal = Math.max(...entries.map(e => e.value), 1);

  return (
    <Panel>
      <h4>Lab Run Results</h4>
      <p style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", margin: "-0.25rem 0 0.75rem" }}>
        Simulated page load via PageSpeed Insights ({lighthouse.strategy}) — values in ms
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--color-border)" }}>
              <th style={{ textAlign: "left", padding: "0.4rem 0.5rem", fontWeight: 600, fontSize: "0.75rem", color: "var(--color-text-secondary)" }}>Metric</th>
              <th style={{ textAlign: "left", padding: "0.4rem 0.5rem", fontWeight: 600, fontSize: "0.75rem", color: "var(--color-text-secondary)", minWidth: "250px" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Timing</span>
                </div>
              </th>
              <th style={{ textAlign: "right", padding: "0.4rem 0.5rem", fontWeight: 600, fontSize: "0.75rem", color: "var(--color-text-secondary)", width: "60px" }}>ms</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const barWidth = (entry.value / maxVal) * 100;
              return (
                <tr key={entry.label} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <td style={{ padding: "0.5rem", fontWeight: 500, whiteSpace: "nowrap" }}>{entry.label}</td>
                  <td style={{ padding: "0.5rem" }}>
                    <div style={{ display: "flex", alignItems: "center", height: "20px" }}>
                      <div style={{
                        width: `${Math.max(barWidth, 2)}%`,
                        height: "14px",
                        backgroundColor: entry.color,
                        borderRadius: "2px",
                        transition: "width 0.3s ease",
                      }} />
                    </div>
                  </td>
                  <td style={{ padding: "0.5rem", textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{entry.display}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {/* Page weight + requests row */}
        {(pageWeight > 0 || lighthouse.total_requests > 0) && (
          <div style={{ display: "flex", gap: "1.5rem", marginTop: "0.75rem", padding: "0.5rem", background: "var(--color-surface)", borderRadius: "6px", fontSize: "0.78rem" }}>
            {pageWeight > 0 && (
              <div>
                <span style={{ color: "var(--color-text-muted)" }}>Total Bytes: </span>
                <strong style={{ fontVariantNumeric: "tabular-nums" }}>{pageWeight.toLocaleString()}</strong>
                <span style={{ color: "var(--color-text-muted)", marginLeft: "0.25rem" }}>({(pageWeight / (1024 * 1024)).toFixed(1)} MB)</span>
              </div>
            )}
            {lighthouse.total_requests > 0 && (
              <div>
                <span style={{ color: "var(--color-text-muted)" }}>Requests: </span>
                <strong>{lighthouse.total_requests}</strong>
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

function LighthouseTab({ lighthouse, crux }: { lighthouse: any; crux?: any }) {
  const gaugeColor = (score: number) => score >= 90 ? "var(--color-success)" : score >= 50 ? "var(--color-warning)" : "var(--color-danger)";
  const assessColor = (rating: string) => rating === "Good" ? "var(--color-success)" : rating === "Not Bad" ? "var(--color-info)" : rating === "Needs Improvement" ? "var(--color-warning)" : "var(--color-danger)";

  const ScoreGauge = ({ score, label }: { score: number; label: string }) => {
    const color = gaugeColor(score);
    const circumference = 2 * Math.PI * 40;
    const offset = circumference - (score / 100) * circumference;
    return (
      <div style={{ textAlign: "center" }}>
        <svg width="90" height="90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" fill="none" stroke="var(--color-border)" strokeWidth="6" />
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
        <p style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)", margin: "0 0 0.35rem", lineHeight: 1.4 }}>{assessment.summary}</p>
        {assessment.details?.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.78rem", color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
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

      {/* CrUX Real-World Usage Metrics (WPT-style) */}
      {crux && <CrUXFieldMetrics crux={crux} />}

      {/* Lab Run Results (WPT-style Individual Runs) */}
      <IndividualRunsTable lighthouse={lighthouse} />

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
            <div key={i} style={{ textAlign: "center", padding: "0.4rem", background: "var(--color-surface)", borderRadius: "6px" }}>
              <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--color-text)" }}>{m.value}</div>
              <div style={{ fontSize: "0.7rem", color: "var(--color-text-faint)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{m.label}</div>
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
                  const typeColor: Record<string, string> = { Script: "var(--color-res-script)", Stylesheet: "var(--color-res-stylesheet)", Image: "var(--color-res-image)", Font: "var(--color-res-font)", Document: "var(--color-res-document)", XHR: "var(--color-res-xhr)", Fetch: "var(--color-res-xhr)" };
                  const color = typeColor[req.resource_type] || "var(--color-text-faint)";
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
                <span><span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "2px", background: "var(--color-res-document)", marginRight: "3px" }} />Document</span>
                <span><span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "2px", background: "var(--color-res-script)", marginRight: "3px" }} />Script</span>
                <span><span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "2px", background: "var(--color-res-stylesheet)", marginRight: "3px" }} />Stylesheet</span>
                <span><span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "2px", background: "var(--color-res-image)", marginRight: "3px" }} />Image</span>
                <span><span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "2px", background: "var(--color-res-font)", marginRight: "3px" }} />Font</span>
                <span><span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "2px", background: "var(--color-res-xhr)", marginRight: "3px" }} />XHR/Fetch</span>
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
