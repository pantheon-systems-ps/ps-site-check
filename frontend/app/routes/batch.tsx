import type { Route } from "./+types/batch";
import { Form, useNavigation, Link } from "react-router";
import { Panel, Button, Callout } from "@pantheon-systems/pds-toolkit-react";

const SITE_CHECK_API =
  process.env.SITE_CHECK_API_URL ||
  "https://api.site-check.ps-pantheon.com";

type BatchResult = {
  results: {
    id: string;
    url: string;
    timestamp: string;
    duration_ms: number;
    dns: { a: string[]; cname: string[]; error?: string };
    http: {
      status_code: number;
      headers: Record<string, string>;
      duration_ms: number;
      error?: string;
    };
    tls: { protocol: string; subject: string; issuer: string; valid_to: string; error?: string };
    insights: { severity: string; category: string; message: string }[];
  }[];
  total_ms: number;
  total_urls: number;
};

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const urlsRaw = formData.get("urls") as string;
  if (!urlsRaw?.trim()) {
    return { result: null, error: "Enter at least one URL" };
  }

  const urls = urlsRaw
    .split("\n")
    .map((u) => u.trim())
    .filter((u) => u.length > 0);

  if (urls.length === 0) {
    return { result: null, error: "Enter at least one URL" };
  }
  if (urls.length > 10) {
    return { result: null, error: "Maximum 10 URLs per batch" };
  }

  try {
    const resp = await fetch(`${SITE_CHECK_API}/check-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
    });
    if (!resp.ok) {
      return { result: null, error: `API returned ${resp.status}` };
    }
    const result: BatchResult = await resp.json();
    return { result, error: null };
  } catch (e) {
    return { result: null, error: e instanceof Error ? e.message : "Unknown error" };
  }
}

export default function CheckBatch({ actionData }: Route.ComponentProps) {
  const result = actionData?.result as BatchResult | null | undefined;
  const error = actionData?.error as string | null | undefined;
  const navigation = useNavigation();
  const isChecking = navigation.state === "submitting";

  return (
    <>
      <h2>Batch Site Check</h2>
      <Callout type="info" title="Batch Check" className="pds-spacing-mar-block-end-l">
        <p>Enter up to 10 domains (one per line) to check them all at once.</p>
      </Callout>

      <Panel className="pds-spacing-mar-block-end-l">
        <Form method="post">
          <label
            htmlFor="urls-input"
            className="pds-spacing-mar-block-end-2xs"
            style={{ display: "block", fontWeight: 600 }}
          >
            Domains (one per line)
          </label>
          <textarea
            id="urls-input"
            name="urls"
            rows={6}
            placeholder={"pantheon.io\nexample.com\ndocs.pantheon.io"}
            required
            className="pds-input"
            style={{ width: "100%", padding: "0.5rem 0.75rem", fontFamily: "monospace", resize: "vertical" }}
          />
          <div style={{ marginTop: "0.75rem" }}>
            <Button
              label={isChecking ? "Checking..." : "Check All"}
              buttonType="submit"
              variant="brand"
              disabled={isChecking}
            />
          </div>
        </Form>
      </Panel>

      {isChecking && (
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <svg viewBox="0 0 50 50" width="40" height="40">
            <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeWidth="4" strokeDasharray="90 60" strokeLinecap="round">
              <animateTransform attributeName="transform" type="rotate" dur="0.8s" from="0 25 25" to="360 25 25" repeatCount="indefinite" />
            </circle>
          </svg>
          <p style={{ color: "#666" }}>Checking sites...</p>
        </div>
      )}

      {error && (
        <Callout type="critical" title="Batch check failed">
          <p>{error}</p>
        </Callout>
      )}

      {result && !isChecking && <BatchResults result={result} />}
    </>
  );
}

function BatchResults({ result }: { result: BatchResult }) {
  const errorCount = result.results.filter(
    (r) => r.http?.error || (r.http?.status_code && r.http.status_code >= 400)
  ).length;
  const warningCount = result.results.reduce(
    (acc, r) => acc + r.insights.filter((i) => i.severity === "warning").length,
    0
  );

  return (
    <div className="pds-spacing-mar-block-start-l">
      <Panel className="pds-spacing-mar-block-end-l">
        <h3>Summary</h3>
        <p style={{ color: "#666", fontSize: "0.85rem" }}>
          Checked <strong>{result.total_urls}</strong> URLs in{" "}
          <strong>{result.total_ms}ms</strong>
          {errorCount > 0 && <> &middot; <span style={{ color: "#dc2626" }}>{errorCount} errors</span></>}
          {warningCount > 0 && <> &middot; <span style={{ color: "#ca8a04" }}>{warningCount} warnings</span></>}
        </p>
      </Panel>

      <Panel className="pds-spacing-mar-block-end-l">
        <h3>Results</h3>
        <table className="pds-table">
          <thead>
            <tr>
              <th>URL</th>
              <th>HTTP</th>
              <th>TLS</th>
              <th>Issuer</th>
              <th>DNS A</th>
              <th>Time</th>
              <th>Issues</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {result.results.map((r, i) => {
              const issues = r.insights.filter((i) => i.severity !== "info");
              return (
                <tr key={i}>
                  <td style={{ fontSize: "0.85rem", maxWidth: "200px", wordBreak: "break-all" }}>
                    {r.url.replace(/^https?:\/\//, "")}
                  </td>
                  <td>
                    <StatusBadge code={r.http?.status_code} error={r.http?.error} />
                  </td>
                  <td style={{ fontSize: "0.85rem" }}>{r.tls?.protocol || "\u2014"}</td>
                  <td style={{ fontSize: "0.85rem" }}>{r.tls?.issuer?.split(" (")[0] || "\u2014"}</td>
                  <td style={{ fontSize: "0.85rem" }}>{r.dns?.a?.[0] || "\u2014"}</td>
                  <td style={{ fontSize: "0.85rem" }}>{r.duration_ms}ms</td>
                  <td>
                    {issues.length > 0 ? (
                      <span
                        style={{
                          color: issues.some((i) => i.severity === "error") ? "#dc2626" : "#ca8a04",
                          fontWeight: 600,
                        }}
                      >
                        {issues.length}
                      </span>
                    ) : (
                      <span style={{ color: "#16a34a" }}>OK</span>
                    )}
                  </td>
                  <td>
                    <Link to={`/?id=${r.id}`} style={{ fontSize: "0.8rem" }}>
                      Details
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      {/* Per-site insights (only show warnings/errors) */}
      {result.results.some((r) => r.insights.some((i) => i.severity !== "info")) && (
        <Panel className="pds-spacing-mar-block-end-l">
          <h3>Issues Found</h3>
          {result.results
            .filter((r) => r.insights.some((i) => i.severity !== "info"))
            .map((r, ri) => (
              <div key={ri} style={{ marginBottom: "0.75rem" }}>
                <p style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.25rem" }}>
                  {r.url.replace(/^https?:\/\//, "")}
                </p>
                {r.insights
                  .filter((i) => i.severity !== "info")
                  .map((insight, ii) => (
                    <Callout
                      key={ii}
                      title={`${insight.category.toUpperCase()} \u2014 ${insight.message}`}
                      type={insight.severity === "error" ? "critical" : "warning"}
                    >
                      <span />
                    </Callout>
                  ))}
              </div>
            ))}
        </Panel>
      )}
    </div>
  );
}

function StatusBadge({ code, error }: { code?: number; error?: string }) {
  if (error) return <span style={{ color: "#dc2626", fontSize: "0.85rem" }}>ERR</span>;
  if (!code) return <span>{"\u2014"}</span>;
  const color = code < 300 ? "#16a34a" : code < 400 ? "#ca8a04" : "#dc2626";
  return <span style={{ color, fontWeight: 700 }}>{code}</span>;
}
