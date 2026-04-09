import { useState } from "react";
import { Button, Callout } from "@pantheon-systems/pds-toolkit-react";
import { CLIENT_API } from "~/lib/constants";

export default function BotProtectionTab({ domain }: { domain: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const runProbe = async () => {
    setLoading(true);
    try {
      const resp = await fetch(`${CLIENT_API}/bot-protection?domain=${encodeURIComponent(domain)}`);
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
          Detect PoW (Proof-of-Work) or Obolus bot mitigation on this domain.
        </p>
        <Button label="Detect Bot Protection" onClick={runProbe} variant="brand" />
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: "2rem", textAlign: "center", color: "var(--color-text-secondary)" }}>Probing for bot protection...</div>;
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
      <div style={{ padding: "1rem", borderRadius: "8px", marginBottom: "1rem", background: data.detected ? "var(--color-success-light)" : "var(--color-surface)", border: `1px solid ${data.detected ? "var(--color-success-border)" : "var(--color-border)"}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "1.5rem" }}>{data.detected ? "\uD83D\uDEE1\uFE0F" : "\u2014"}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{data.detected ? "Bot Protection Active" : "No Bot Protection Detected"}</div>
            <div style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Type: {typeLabel}</div>
          </div>
        </div>
      </div>

      <p style={{ fontSize: "0.8rem", color: "var(--color-text-faint)", marginBottom: "0.75rem" }}>Detection probes ({data.duration_ms}ms):</p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {probes.map((p, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", padding: "0.5rem 0.75rem", borderRadius: "4px", background: p.detected ? "var(--color-success-light)" : "var(--color-surface)", fontSize: "0.85rem" }}>
            <span>{p.detected ? "\u2705" : "\u2796"}</span>
            <div>
              <span style={{ fontWeight: 500 }}>{p.label}</span>
              {p.detail && <div style={{ color: "var(--color-text-secondary)", fontSize: "0.8rem", marginTop: "0.1rem" }}>{p.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
