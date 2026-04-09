import { useState } from "react";
import { Callout } from "@pantheon-systems/pds-toolkit-react";
import type { SiteCheckResult } from "~/types/site-check";
import Badge from "~/components/ui/Badge";
import RenderMarkdown from "~/components/ui/RenderMarkdown";
import { CLIENT_API } from "~/lib/constants";
import ProServicesCTA from "~/components/ProServicesCTA";

type AIAnalysis = {
  summary: string;
  findings: string[];
  next_steps: string[];
  risk: string;
  model: string;
  raw: string;
  duration_ms: number;
  error: string;
};

const AI_MODELS = [
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", cost: "~$0.001" },
];

export default function AIAnalysisPanel({ result, seo, lighthouse }: { result: SiteCheckResult; seo?: any; lighthouse?: any }) {
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
      setAnalysis({ summary: "", findings: [], next_steps: [], risk: "", model: "", raw: "", duration_ms: 0, error: e instanceof Error ? e.message : "Unknown error" });
    }
    setLoading(false);
  };

  const riskColor = (risk: string) => {
    switch (risk) {
      case "low": return "var(--color-success)";
      case "medium": return "var(--color-warning)";
      case "high": return "var(--color-danger)";
      default: return "var(--color-text-secondary)";
    }
  };

  if (!analysis && !loading) {
    return (
      <div style={{ textAlign: "center", padding: "0.5rem 0.75rem", borderRadius: "8px", border: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
        <button
          onClick={handleAnalyze}
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.4rem",
            padding: "0.4rem 1rem", borderRadius: "6px", border: "none",
            background: "var(--color-primary)", color: "var(--color-white)",
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
      <div style={{ textAlign: "center", padding: "1.5rem", marginBottom: "1rem", background: "var(--color-surface)", borderRadius: "8px" }}>
        <svg viewBox="0 0 50 50" width="28" height="28" style={{ margin: "0 auto" }}>
          <circle cx="25" cy="25" r="20" fill="none" stroke="var(--color-primary)" strokeWidth="4" strokeDasharray="90 60" strokeLinecap="round">
            <animateTransform attributeName="transform" type="rotate" dur="0.8s" from="0 25 25" to="360 25 25" repeatCount="indefinite" />
          </circle>
        </svg>
        <p style={{ color: "var(--color-text-secondary)", fontSize: "0.85rem", marginTop: "0.5rem" }}>Analyzing with {AI_MODELS.find(m => m.id === selectedModel)?.name || "AI"}...</p>
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
          <h4 style={{ margin: 0, fontSize: "0.95rem", color: "var(--color-primary)" }}>AI Analysis</h4>
          {analysis.model && <span style={{ fontSize: "0.7rem", color: "var(--color-text-faint)", background: "var(--color-surface-alt)", padding: "0.1rem 0.4rem", borderRadius: "3px" }}>{analysis.model}</span>}
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          {analysis.risk && (
            <Badge color={riskColor(analysis.risk)} label={`Risk: ${analysis.risk}`} />
          )}
          <span style={{ fontSize: "0.7rem", color: "var(--color-text-faint)" }}>{(analysis.duration_ms / 1000).toFixed(1)}s</span>
        </div>
      </div>

      {analysis.summary && (
        <p style={{ fontSize: "0.9rem", color: "var(--color-text)", lineHeight: 1.5, margin: "0 0 0.75rem" }}>
          {analysis.summary}
        </p>
      )}

      {analysis.findings && analysis.findings.length > 0 && (
        <div style={{ marginBottom: "0.75rem" }}>
          <h5 style={{ margin: "0 0 0.35rem", fontSize: "0.7rem", textTransform: "uppercase", color: "var(--color-text-muted)", letterSpacing: "0.05em" }}>
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
          <h5 style={{ margin: "0 0 0.35rem", fontSize: "0.7rem", textTransform: "uppercase", color: "var(--color-text-muted)", letterSpacing: "0.05em" }}>
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "0.75rem", paddingTop: "0.5rem", borderTop: `1px solid var(--color-ai-border)` }}>
        <ProServicesCTA variant="compact" />
        <button
          onClick={handleAnalyze}
          disabled={loading}
          aria-label="Re-analyze with AI"
          style={{
            padding: "0.5rem 0.75rem", borderRadius: "4px", border: "none",
            background: "var(--color-primary)", color: "var(--color-white)", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600,
          }}
        >
          {loading ? "..." : "Re-analyze"}
        </button>
      </div>
    </div>
  );
}
