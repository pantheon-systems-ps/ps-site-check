import type { Route } from "./+types/migration";
import { useState } from "react";
import { Form, useNavigation } from "react-router";
import { Panel, Button, Callout } from "@pantheon-systems/pds-toolkit-react";

const SITE_CHECK_API =
  process.env.SITE_CHECK_API_URL ||
  "https://api.site-check.ps-pantheon.com";

type MigrationReadiness = {
  domain: string;
  score: number;
  grade: string;
  checks: { name: string; status: string; description: string; detail?: string }[];
  duration_ms: number;
};

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const domain = (formData.get("domain") as string)?.trim();
  if (!domain) {
    return { result: null, error: "Enter a domain to check" };
  }

  try {
    const resp = await fetch(`${SITE_CHECK_API}/migration-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain }),
    });
    if (!resp.ok) {
      return { result: null, error: `API returned ${resp.status}` };
    }
    const result: MigrationReadiness = await resp.json();
    return { result, error: null };
  } catch (e) {
    return { result: null, error: e instanceof Error ? e.message : "Unknown error" };
  }
}

const STATUS_COLORS: Record<string, string> = {
  pass: "#16a34a",
  warning: "#ca8a04",
  fail: "#dc2626",
  info: "#2563eb",
};

const STATUS_ICONS: Record<string, string> = {
  pass: "\u2705",
  warning: "\u26a0\ufe0f",
  fail: "\u274c",
  info: "\u2139\ufe0f",
};

function gradeColor(grade: string): string {
  if (grade === "A") return "#16a34a";
  if (grade === "B") return "#22c55e";
  if (grade === "C") return "#ca8a04";
  if (grade === "D") return "#ea580c";
  return "#dc2626"; // F
}

export default function Migration({ actionData }: Route.ComponentProps) {
  const result = actionData?.result as MigrationReadiness | null | undefined;
  const error = actionData?.error as string | null | undefined;
  const navigation = useNavigation();
  const isChecking = navigation.state === "submitting";

  return (
    <>
      <h2>Pre-Migration Readiness Check</h2>
      <Callout type="info" title="Migration Readiness" className="pds-spacing-mar-block-end-l">
        <p>
          Run automated checks to assess a domain's readiness for migration to Pantheon.
        </p>
      </Callout>

      <Panel className="pds-spacing-mar-block-end-l">
        <Form method="post">
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label
                htmlFor="domain-input"
                className="pds-spacing-mar-block-end-2xs"
                style={{ display: "block", fontWeight: 600 }}
              >
                Domain
              </label>
              <input
                id="domain-input"
                name="domain"
                type="text"
                placeholder="example.com"
                required
                className="pds-input"
                style={{ width: "100%", padding: "0.5rem 0.75rem" }}
              />
            </div>
            <div>
              <Button
                label={isChecking ? "Running..." : "Run Check"}
                buttonType="submit"
                variant="brand"
                disabled={isChecking}
              />
            </div>
          </div>
        </Form>
      </Panel>

      {isChecking && (
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <svg viewBox="0 0 50 50" width="40" height="40">
            <circle
              cx="25"
              cy="25"
              r="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeDasharray="90 60"
              strokeLinecap="round"
            >
              <animateTransform
                attributeName="transform"
                type="rotate"
                dur="0.8s"
                from="0 25 25"
                to="360 25 25"
                repeatCount="indefinite"
              />
            </circle>
          </svg>
          <p style={{ color: "#666" }}>Running migration checks...</p>
        </div>
      )}

      {error && (
        <Callout type="critical" title="Check failed">
          <p>{error}</p>
        </Callout>
      )}

      {result && !isChecking && <MigrationResults result={result} />}
    </>
  );
}

function MigrationResults({ result }: { result: MigrationReadiness }) {
  const color = gradeColor(result.grade);
  const [aiResult, setAiResult] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const analyzeMigration = async () => {
    setAiLoading(true);
    try {
      const resp = await fetch(`${SITE_CHECK_API}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "migration", migration: result }),
      });
      setAiResult(await resp.json());
    } catch (e) {
      setAiResult({ error: e instanceof Error ? e.message : "Unknown error" });
    }
    setAiLoading(false);
  };

  return (
    <div className="pds-spacing-mar-block-start-l">
      {/* Score and Grade */}
      <Panel className="pds-spacing-mar-block-end-l">
        <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
          <div
            style={{
              width: "80px",
              height: "80px",
              borderRadius: "50%",
              backgroundColor: color,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: "2.5rem", fontWeight: 800, color: "#fff" }}>
              {result.grade}
            </span>
          </div>
          <div>
            <h3 style={{ margin: 0 }}>{result.domain}</h3>
            <p style={{ margin: "0.25rem 0 0", color: "#666", fontSize: "0.9rem" }}>
              Score: <strong style={{ color, fontSize: "1.1rem" }}>{result.score}%</strong>
            </p>
          </div>
        </div>
      </Panel>

      {/* Checklist */}
      <Panel className="pds-spacing-mar-block-end-l">
        <h3>Checklist</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {result.checks.map((check, i) => {
            const statusColor = STATUS_COLORS[check.status] || "#666";
            const icon = STATUS_ICONS[check.status] || "\u2014";

            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.75rem",
                  padding: "0.75rem",
                  borderRadius: "6px",
                  border: `1px solid ${statusColor}22`,
                  backgroundColor: `${statusColor}08`,
                }}
              >
                <span style={{ fontSize: "1.2rem", lineHeight: 1, flexShrink: 0 }}>
                  {icon}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: statusColor }}>
                    {check.name}
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "#555", marginTop: "0.15rem" }}>
                    {check.description}
                  </div>
                  {check.detail && (
                    <div
                      style={{
                        fontSize: "0.8rem",
                        color: "#888",
                        marginTop: "0.35rem",
                        fontFamily: "monospace",
                        wordBreak: "break-all",
                      }}
                    >
                      {check.detail}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      {/* Duration */}
      <p style={{ color: "#888", fontSize: "0.85rem", textAlign: "right" }}>
        Completed in {result.duration_ms}ms
      </p>

      {/* AI Analysis */}
      <div style={{ textAlign: "center", marginTop: "1rem" }}>
        {!aiResult && !aiLoading && (
          <button onClick={analyzeMigration} style={{
            padding: "0.5rem 1.25rem", borderRadius: "6px", border: "1px solid #e5e7eb",
            background: "linear-gradient(135deg, #f0f0ff 0%, #fff 100%)",
            cursor: "pointer", fontSize: "0.85rem", fontWeight: 600, color: "#4f46e5",
          }}>
            Analyze with AI
          </button>
        )}
        {aiLoading && <p style={{ color: "#666", fontSize: "0.85rem" }}>Analyzing with Claude Opus...</p>}
        {aiResult && !aiResult.error && (
          <div style={{ textAlign: "left", padding: "1rem", background: "#f8f7ff", borderRadius: "8px", border: "1px solid #e0e0f0", marginTop: "0.5rem" }}>
            <h4 style={{ margin: "0 0 0.5rem", color: "#4f46e5", fontSize: "0.95rem" }}>AI Migration Analysis</h4>
            {aiResult.summary && <p style={{ fontSize: "0.9rem", color: "#333", lineHeight: 1.5 }}>{aiResult.summary}</p>}
            {aiResult.findings?.length > 0 && (
              <ul style={{ fontSize: "0.85rem", color: "#444", lineHeight: 1.6 }}>
                {aiResult.findings.map((f: string, i: number) => <li key={i}>{f}</li>)}
              </ul>
            )}
            {aiResult.next_steps?.length > 0 && (
              <>
                <h5 style={{ fontSize: "0.8rem", color: "#888", textTransform: "uppercase", margin: "0.5rem 0 0.25rem" }}>Recommended Steps</h5>
                <ol style={{ fontSize: "0.85rem", color: "#444", lineHeight: 1.6 }}>
                  {aiResult.next_steps.map((s: string, i: number) => <li key={i}>{s}</li>)}
                </ol>
              </>
            )}
          </div>
        )}
        {aiResult?.error && <Callout type="warning" title="AI Analysis Error"><p>{aiResult.error}</p></Callout>}
      </div>
    </div>
  );
}
