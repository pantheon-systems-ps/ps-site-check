import { useState } from "react";
import { Button, Callout } from "@pantheon-systems/pds-toolkit-react";
import { CLIENT_API } from "~/lib/constants";

export default function AGCDNProbeTab({ domain }: { domain: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const runProbe = async () => {
    setLoading(true);
    try {
      const resp = await fetch(`${CLIENT_API}/agcdn-probe?domain=${encodeURIComponent(domain)}`);
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
          Actively probe AGCDN features: WAF, Image Optimization, and Rate Limiting.
        </p>
        <Button label="Run AGCDN Probe" onClick={runProbe} variant="brand" />
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: "2rem", textAlign: "center", color: "var(--color-text-secondary)" }}>Probing AGCDN features...</div>;
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
      <p style={{ fontSize: "0.8rem", color: "var(--color-text-faint)", marginBottom: "1rem" }}>Probed in {data.duration_ms}ms</p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {features.map((f, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", padding: "0.75rem", borderRadius: "6px", background: f.detected ? "var(--color-success-light)" : "var(--color-surface)", border: `1px solid ${f.detected ? "var(--color-success-border)" : "var(--color-border)"}` }}>
            <span style={{ fontSize: "1.2rem" }}>{f.detected ? "\u2705" : "\u274C"}</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{f.label}</div>
              {f.evidence && <div style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)", marginTop: "0.15rem" }}>{f.evidence}</div>}
              {f.extra && <div style={{ fontSize: "0.8rem", color: "var(--color-success)", marginTop: "0.15rem", fontWeight: 500 }}>{f.extra}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
