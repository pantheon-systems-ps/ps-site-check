import { useState } from "react";
import { Button, Callout } from "@pantheon-systems/pds-toolkit-react";
import { CLIENT_API } from "~/lib/constants";

function truncateValue(value: string, max: number) {
  if (value.length <= max) return value;
  return value.slice(0, max) + "...";
}

export default function ResourceAuditTab({ url }: { url: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const runAudit = async () => {
    setLoading(true);
    try {
      const resp = await fetch(`${CLIENT_API}/resources?url=${encodeURIComponent(url)}`);
      setData(await resp.json());
    } catch (e) {
      setData({ error: e instanceof Error ? e.message : "Unknown error" });
    }
    setLoading(false);
  };

  if (!data && !loading) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>
        <p style={{ color: "var(--color-text-secondary)", marginBottom: "1rem", fontSize: "0.9rem" }}>
          Check all linked CSS, JavaScript, and image resources for broken links (404s, 500s).
        </p>
        <Button label="Audit Resources" onClick={runAudit} variant="brand" />
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: "2rem", textAlign: "center", color: "var(--color-text-secondary)" }}>Checking resources...</div>;
  }

  if (data?.error) {
    return <Callout type="warning" title="Audit Error"><p>{data.error}</p></Callout>;
  }

  const typeIcon: Record<string, string> = { css: "\uD83C\uDFA8", js: "\u2699\uFE0F", image: "\uD83D\uDDBC\uFE0F", other: "\uD83D\uDCC4" };

  return (
    <div style={{ paddingTop: "1rem" }}>
      {/* Summary stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <div style={{ textAlign: "center", padding: "0.75rem", background: "var(--color-surface)", borderRadius: "6px", border: "1px solid #e5e7eb" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{data.total_resources}</div>
          <div style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)" }}>Total</div>
        </div>
        <div style={{ textAlign: "center", padding: "0.75rem", background: "var(--color-success-light)", borderRadius: "6px", border: "1px solid #bbf7d0" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--color-success)" }}>{data.healthy}</div>
          <div style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)" }}>Healthy</div>
        </div>
        <div style={{ textAlign: "center", padding: "0.75rem", background: data.broken > 0 ? "var(--color-danger-light)" : "var(--color-surface)", borderRadius: "6px", border: `1px solid ${data.broken > 0 ? "var(--color-danger-border)" : "var(--color-border)"}` }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: data.broken > 0 ? "var(--color-danger)" : "var(--color-text-secondary)" }}>{data.broken}</div>
          <div style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)" }}>Broken</div>
        </div>
        <div style={{ textAlign: "center", padding: "0.75rem", background: "var(--color-surface)", borderRadius: "6px", border: "1px solid #e5e7eb" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--color-text-secondary)" }}>{data.errors}</div>
          <div style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)" }}>Errors</div>
        </div>
      </div>

      {/* Broken resources first */}
      {data.resources?.filter((r: any) => r.status !== "ok").length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <h4 style={{ fontSize: "0.9rem", color: "var(--color-danger)", marginBottom: "0.5rem" }}>Broken / Error Resources</h4>
          {data.resources.filter((r: any) => r.status !== "ok").map((r: any, i: number) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.4rem 0.6rem", borderRadius: "4px", background: "var(--color-danger-light)", marginBottom: "0.25rem", fontSize: "0.8rem" }}>
              <span>{typeIcon[r.type] || "\uD83D\uDCC4"}</span>
              <span style={{ fontWeight: 600, color: "var(--color-danger)", minWidth: "30px" }}>{r.status_code || "ERR"}</span>
              <span style={{ wordBreak: "break-all", flex: 1 }}>{truncateValue(r.url, 100)}</span>
              {r.error && <span style={{ color: "var(--color-text-faint)", fontSize: "0.75rem" }}>{r.error}</span>}
            </div>
          ))}
        </div>
      )}

      {/* All healthy resources (collapsed) */}
      {data.resources?.filter((r: any) => r.status === "ok").length > 0 && (
        <details>
          <summary style={{ cursor: "pointer", fontSize: "0.85rem", fontWeight: 600, color: "var(--color-success)" }}>
            Healthy Resources ({data.healthy})
          </summary>
          <div style={{ marginTop: "0.5rem" }}>
            {data.resources.filter((r: any) => r.status === "ok").map((r: any, i: number) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.3rem 0.6rem", fontSize: "0.8rem", borderBottom: "1px solid #f3f4f6" }}>
                <span>{typeIcon[r.type] || "\uD83D\uDCC4"}</span>
                <span style={{ color: "var(--color-success)", fontWeight: 500, minWidth: "30px" }}>{r.status_code}</span>
                <span style={{ wordBreak: "break-all", flex: 1, color: "var(--color-text-secondary)" }}>{truncateValue(r.url, 100)}</span>
                <span style={{ color: "var(--color-text-faint)", fontSize: "0.75rem" }}>{r.duration_ms}ms</span>
              </div>
            ))}
          </div>
        </details>
      )}

      <p style={{ fontSize: "0.75rem", color: "var(--color-text-faint)", marginTop: "1rem" }}>Audit completed in {data.duration_ms}ms</p>
    </div>
  );
}
