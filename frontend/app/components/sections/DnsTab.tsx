import { Panel, Callout } from "@pantheon-systems/pds-toolkit-react";
import type { SiteCheckResult } from "~/types/site-check";

export default function DnsTab({ result }: { result: SiteCheckResult }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", paddingTop: "1rem" }}>
      <Panel>
        <h4>DNS Resolution</h4>
        {result.dns?.error ? (
          <Callout type="critical" title="DNS Error">
            <p>{result.dns.error}</p>
          </Callout>
        ) : (
          <table className="pds-table">
            <thead>
              <tr>
                <th>A (IPv4)</th>
                <th>AAAA (IPv6)</th>
                <th>CNAME</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{result.dns?.a?.map((ip, i) => <div key={i}>{ip}</div>) || "\u2014"}</td>
                <td>{result.dns?.aaaa?.map((ip, i) => <div key={i}>{ip}</div>) || "\u2014"}</td>
                <td>
                  {result.dns?.cname?.length
                    ? result.dns.cname.map((c, i) => <div key={i}>{c}</div>)
                    : "\u2014"}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </Panel>

      {/* MX, NS, TXT Records */}
      {!result.dns?.error && (result.dns?.mx?.length || result.dns?.ns?.length || result.dns?.txt?.length) && (
        <Panel>
          <h4>Additional DNS Records</h4>
          <table className="pds-table">
            <thead>
              <tr>
                <th style={{ width: "15%" }}>Type</th>
                <th>Records</th>
              </tr>
            </thead>
            <tbody>
              {result.dns.ns && result.dns.ns.length > 0 && (
                <tr>
                  <td style={{ fontWeight: 600 }}>NS</td>
                  <td style={{ fontSize: "0.85rem" }}>
                    {result.dns.ns.map((ns, i) => <div key={i}>{ns}</div>)}
                  </td>
                </tr>
              )}
              {result.dns.mx && result.dns.mx.length > 0 && (
                <tr>
                  <td style={{ fontWeight: 600 }}>MX</td>
                  <td style={{ fontSize: "0.85rem" }}>
                    {result.dns.mx.map((mx, i) => (
                      <div key={i}>{mx.priority} {mx.host}</div>
                    ))}
                  </td>
                </tr>
              )}
              {result.dns.txt && result.dns.txt.length > 0 && (
                <tr>
                  <td style={{ fontWeight: 600 }}>TXT</td>
                  <td style={{ fontSize: "0.85rem" }}>
                    <details>
                      <summary style={{ cursor: "pointer" }}>
                        {result.dns.txt.length} record{result.dns.txt.length !== 1 ? "s" : ""}
                      </summary>
                      <div style={{ marginTop: "0.5rem" }}>
                        {result.dns.txt.map((txt, i) => (
                          <div key={i} style={{ wordBreak: "break-all", marginBottom: "0.25rem", padding: "0.25rem 0", borderBottom: "1px solid #eee" }}>
                            <code style={{ fontSize: "0.8rem" }}>{txt}</code>
                          </div>
                        ))}
                      </div>
                    </details>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Panel>
      )}

      {result.dns_multi && result.dns_multi.length > 0 && (
        <Panel>
          <h4>DNS Multi-Resolver Comparison</h4>
          <table className="pds-table">
            <thead>
              <tr>
                <th>Resolver</th>
                <th>A (IPv4)</th>
                <th>AAAA (IPv6)</th>
                <th>Time (ms)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {result.dns_multi.map((r, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600, fontSize: "0.85rem" }}>{r.label}</td>
                  <td style={{ fontSize: "0.85rem" }}>{r.error ? "\u2014" : r.a?.join(", ") || "\u2014"}</td>
                  <td style={{ fontSize: "0.85rem" }}>{r.error ? "\u2014" : r.aaaa?.join(", ") || "\u2014"}</td>
                  <td>{r.duration_ms}</td>
                  <td>{r.error ? <span style={{ color: "var(--color-danger)" }}>{r.error}</span> : "OK"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
