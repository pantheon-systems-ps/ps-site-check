import type { Route } from "./+types/analytics";
import { useEffect, useState } from "react";
import { Panel } from "@pantheon-systems/pds-toolkit-react";

const CLIENT_API = "https://api.site-check.ps-pantheon.com";

type AnalyticsData = {
  uptime_seconds: number;
  uptime_human: string;
  total_requests: number;
  today_requests: number;
  top_endpoints: { name: string; count: number }[];
  top_domains: { name: string; count: number }[];
  top_ips: { name: string; count: number }[];
  ai_model_usage: Record<string, number>;
  status_codes: Record<string, number>;
  hourly_distribution: number[];
  daily_hits: Record<string, number>;
};

export default function Analytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    fetch(`${CLIENT_API}/analytics`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  if (loading && !data) {
    return (
      <div style={{ textAlign: "center", padding: "3rem" }}>
        <p style={{ color: "var(--color-text-muted)" }}>Loading analytics...</p>
      </div>
    );
  }

  if (!data) return null;

  const maxHourly = Math.max(...data.hourly_distribution, 1);
  const dailyEntries = Object.entries(data.daily_hits).sort(([a], [b]) => b.localeCompare(a));

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0 }}>Analytics</h2>
        <button
          onClick={refresh}
          style={{
            padding: "0.5rem 0.75rem", borderRadius: "var(--radius-sm)",
            border: "1px solid var(--color-border)", background: "var(--color-bg)",
            cursor: "pointer", fontSize: "0.8rem", fontWeight: 600, color: "var(--color-primary)",
          }}
        >
          Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.5rem", marginBottom: "1rem" }}>
        <div className="score-card">
          <div className="score-card__value" style={{ color: "var(--color-primary)" }}>{data.total_requests.toLocaleString()}</div>
          <div className="score-card__label">Total Requests</div>
        </div>
        <div className="score-card">
          <div className="score-card__value" style={{ color: "var(--color-success)" }}>{data.today_requests.toLocaleString()}</div>
          <div className="score-card__label">Today</div>
        </div>
        <div className="score-card">
          <div className="score-card__value" style={{ color: "var(--color-text)" }}>{data.top_domains?.length || 0}</div>
          <div className="score-card__label">Unique Domains</div>
        </div>
        <div className="score-card">
          <div className="score-card__value" style={{ color: "var(--color-text)" }}>{data.uptime_human}</div>
          <div className="score-card__label">Uptime</div>
        </div>
      </div>

      <div className="analytics-grid">
        {/* Hourly distribution */}
        <Panel>
          <h4 style={{ fontSize: "0.85rem", margin: "0 0 0.5rem" }}>Hourly Distribution (UTC)</h4>
          <div style={{ display: "flex", alignItems: "flex-end", gap: "2px", height: "80px" }}>
            {data.hourly_distribution.map((count, hour) => (
              <div key={hour} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div
                  style={{
                    width: "100%", borderRadius: "2px 2px 0 0",
                    background: count > 0 ? "var(--color-primary)" : "var(--color-border)",
                    height: `${Math.max((count / maxHourly) * 60, 2)}px`,
                    opacity: count > 0 ? 0.7 : 0.3,
                  }}
                  title={`${hour}:00 — ${count} requests`}
                />
                {hour % 6 === 0 && (
                  <span style={{ fontSize: "0.55rem", color: "var(--color-text-muted)", marginTop: "2px" }}>{hour}</span>
                )}
              </div>
            ))}
          </div>
        </Panel>

        {/* Daily hits */}
        <Panel>
          <h4 style={{ fontSize: "0.85rem", margin: "0 0 0.5rem" }}>Daily Requests (Last 7 Days)</h4>
          <table className="pds-table">
            <tbody>
              {dailyEntries.map(([date, count]) => (
                <tr key={date}>
                  <td style={{ fontSize: "0.82rem" }}>{date}</td>
                  <td style={{ fontSize: "0.82rem", fontWeight: 600 }}>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        {/* Top endpoints */}
        <Panel>
          <h4 style={{ fontSize: "0.85rem", margin: "0 0 0.5rem" }}>Top Endpoints</h4>
          <table className="pds-table">
            <tbody>
              {data.top_endpoints?.map((ep, i) => (
                <tr key={i}>
                  <td style={{ fontSize: "0.82rem" }}><code>{ep.name}</code></td>
                  <td style={{ fontSize: "0.82rem", fontWeight: 600 }}>{ep.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        {/* Top domains */}
        <Panel>
          <h4 style={{ fontSize: "0.85rem", margin: "0 0 0.5rem" }}>Top Domains Checked</h4>
          <table className="pds-table">
            <tbody>
              {data.top_domains?.map((d, i) => (
                <tr key={i}>
                  <td style={{ fontSize: "0.82rem" }}>{d.name}</td>
                  <td style={{ fontSize: "0.82rem", fontWeight: 600 }}>{d.count}</td>
                </tr>
              ))}
              {(!data.top_domains || data.top_domains.length === 0) && (
                <tr><td style={{ color: "var(--color-text-muted)", fontSize: "0.82rem" }}>No data yet</td></tr>
              )}
            </tbody>
          </table>
        </Panel>

        {/* AI model usage */}
        <Panel>
          <h4 style={{ fontSize: "0.85rem", margin: "0 0 0.5rem" }}>AI Model Usage</h4>
          <table className="pds-table">
            <tbody>
              {Object.entries(data.ai_model_usage || {}).sort(([, a], [, b]) => (b as number) - (a as number)).map(([model, count]) => (
                <tr key={model}>
                  <td style={{ fontSize: "0.82rem" }}>{model}</td>
                  <td style={{ fontSize: "0.82rem", fontWeight: 600 }}>{count as number}</td>
                </tr>
              ))}
              {Object.keys(data.ai_model_usage || {}).length === 0 && (
                <tr><td style={{ color: "var(--color-text-muted)", fontSize: "0.82rem" }}>No AI usage yet</td></tr>
              )}
            </tbody>
          </table>
        </Panel>

        {/* Status codes */}
        <Panel>
          <h4 style={{ fontSize: "0.85rem", margin: "0 0 0.5rem" }}>Response Status Codes</h4>
          <table className="pds-table">
            <tbody>
              {Object.entries(data.status_codes || {}).sort(([, a], [, b]) => (b as number) - (a as number)).map(([code, count]) => (
                <tr key={code}>
                  <td style={{ fontSize: "0.82rem" }}>{code}</td>
                  <td style={{ fontSize: "0.82rem", fontWeight: 600 }}>{count as number}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <p style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", marginTop: "1rem", textAlign: "center" }}>
        In-memory analytics since last deploy. Data resets on service restart.
        For persistent analytics, use Cloud Logging queries.
      </p>
    </>
  );
}
