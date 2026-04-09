import { Panel, Callout } from "@pantheon-systems/pds-toolkit-react";
import type { SiteCheckResult } from "~/types/site-check";
import StatusBadge from "~/components/ui/StatusBadge";

function truncateValue(value: string, max: number) {
  if (value.length <= max) return value;
  return value.slice(0, max) + "...";
}

export default function ResponseTab({
  result,
  io,
}: {
  result: SiteCheckResult;
  io: { detected: boolean; details: string };
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", paddingTop: "1rem" }}>
      {/* Redirect Chain */}
      {result.redirect_chain && result.redirect_chain.length > 0 && (
        <Panel>
          <h4>Redirect Chain</h4>
          <table className="pds-table">
            <thead>
              <tr>
                <th>Step</th>
                <th>Status</th>
                <th>URL</th>
                <th>Location</th>
                <th>Time (ms)</th>
              </tr>
            </thead>
            <tbody>
              {result.redirect_chain.map((hop, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td><StatusBadge code={hop.status_code} /></td>
                  <td style={{ wordBreak: "break-all", fontSize: "0.85rem" }}>{hop.url}</td>
                  <td style={{ wordBreak: "break-all", fontSize: "0.85rem" }}>{hop.location || "\u2014"}</td>
                  <td>{hop.duration_ms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {/* AGCDN Headers */}
      {result.http?.agcdn_headers && result.http.agcdn_headers.length > 0 && (
        <Panel>
          <h4>AGCDN Headers</h4>
          <table className="pds-table">
            <thead>
              <tr>
                <th style={{ width: "20%" }}>Header</th>
                <th style={{ width: "35%" }}>Value</th>
                <th style={{ width: "45%" }}>Insight</th>
              </tr>
            </thead>
            <tbody>
              {result.http.agcdn_headers.map((h, i) => (
                <tr key={i}>
                  <td><code style={{ fontSize: "0.8rem" }}>{h.header}</code></td>
                  <td style={{ wordBreak: "break-all", fontSize: "0.85rem", maxWidth: "300px" }}>
                    {truncateValue(h.value, 200)}
                  </td>
                  <td style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>{h.insight || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {/* Image Optimization */}
      <Panel>
        <h4>Image Optimization (Fastly IO)</h4>
        {io.detected ? (
          <>
            <Callout type="info" title="IO Enabled">
              <p>Fastly Image Optimization is active on this response.</p>
            </Callout>
            <table className="pds-table" style={{ marginTop: "0.75rem" }}>
              <tbody>
                <tr>
                  <td style={{ fontWeight: 600 }}>IO Info</td>
                  <td style={{ wordBreak: "break-all", fontSize: "0.85rem" }}>{io.details}</td>
                </tr>
              </tbody>
            </table>
          </>
        ) : (
          <Callout type="warning" title="IO Not Detected">
            <p>
              No Fastly IO headers found on this response. IO headers (<code>fastly-io-info</code>,{" "}
              <code>x-fastly-imageopto-api</code>) only appear on <strong>image responses</strong>.
              To verify IO status, check an actual image URL from the site (e.g.,{" "}
              <code>example.com/sites/default/files/image.jpg</code>).
            </p>
          </Callout>
        )}
      </Panel>

      {/* Warmup Test */}
      {result.warmup && (
        <Panel>
          <h4>Cache Warmup Test</h4>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "0.85rem" }}>
            {result.warmup.total_requests} sequential requests {"\u2014"} hit ratio:{" "}
            <strong>{(result.warmup.hit_ratio * 100).toFixed(0)}%</strong>{" "}
            ({result.warmup.hits} hits, {result.warmup.misses} misses)
          </p>
          <table className="pds-table">
            <thead>
              <tr>
                <th>#</th>
                <th>X-Cache</th>
                <th>Status</th>
                <th>Time (ms)</th>
              </tr>
            </thead>
            <tbody>
              {result.warmup.requests.map((r) => (
                <tr key={r.sequence}>
                  <td>{r.sequence}</td>
                  <td>
                    <code style={{ color: r.x_cache === "HIT" ? "var(--color-success)" : r.x_cache === "MISS" ? "var(--color-danger)" : "var(--color-text-secondary)" }}>
                      {r.x_cache || "\u2014"}
                    </code>
                  </td>
                  <td><StatusBadge code={r.status_code} /></td>
                  <td>{r.duration_ms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {/* Cache Test */}
      {result.second_http && (
        <Panel>
          <h4>Cache Test (Double Request)</h4>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "0.85rem" }}>
            Second request made after 2-second delay to verify caching behavior.
          </p>
          <table className="pds-table">
            <thead>
              <tr>
                <th>Request</th>
                <th>Status</th>
                <th>X-Cache</th>
                <th>Age</th>
                <th>Time (ms)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>1st</strong></td>
                <td><StatusBadge code={result.http?.status_code} /></td>
                <td><code>{result.http?.headers?.["x-cache"] || "\u2014"}</code></td>
                <td>{result.http?.headers?.["age"] || "\u2014"}</td>
                <td>{result.http?.duration_ms}</td>
              </tr>
              <tr>
                <td><strong>2nd</strong></td>
                <td><StatusBadge code={result.second_http.status_code} /></td>
                <td><code>{result.second_http.headers?.["x-cache"] || "\u2014"}</code></td>
                <td>{result.second_http.headers?.["age"] || "\u2014"}</td>
                <td>{result.second_http.duration_ms}</td>
              </tr>
            </tbody>
          </table>
        </Panel>
      )}

      {/* All Response Headers */}
      <Panel>
        <details>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>
            All Response Headers ({Object.keys(result.http?.headers || {}).length})
          </summary>
          <table className="pds-table" style={{ marginTop: "0.75rem" }}>
            <thead>
              <tr>
                <th style={{ width: "25%" }}>Header</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(result.http?.headers || {})
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, value], i) => (
                  <tr key={i}>
                    <td><code style={{ fontSize: "0.8rem" }}>{key}</code></td>
                    <td style={{ wordBreak: "break-all", fontSize: "0.85rem", maxWidth: "500px" }}>
                      {truncateValue(value, 300)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </details>
      </Panel>
    </div>
  );
}
