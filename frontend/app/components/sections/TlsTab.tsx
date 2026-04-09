import { Panel, Callout } from "@pantheon-systems/pds-toolkit-react";
import type { SiteCheckResult } from "~/types/site-check";
import Badge from "~/components/ui/Badge";

export default function TlsTab({
  result,
  cert,
}: {
  result: SiteCheckResult;
  cert: { label: string; color: string; description: string };
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", paddingTop: "1rem" }}>
      <Panel>
        <h4>Certificate Type</h4>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
          <Badge color={cert.color} label={cert.label} />
        </div>
        <p style={{ color: "var(--color-text-secondary)", fontSize: "0.85rem", margin: 0 }}>{cert.description}</p>
      </Panel>

      <Panel>
        <h4>Certificate Details</h4>
        {result.tls?.error ? (
          <Callout type="critical" title="TLS Error">
            <p>{result.tls.error}</p>
          </Callout>
        ) : (
          <table className="pds-table">
            <tbody>
              <tr><td style={{ fontWeight: 600, width: "20%" }}>Subject</td><td>{result.tls?.subject}</td></tr>
              <tr><td style={{ fontWeight: 600 }}>Issuer</td><td>{result.tls?.issuer}</td></tr>
              <tr><td style={{ fontWeight: 600 }}>Protocol</td><td>{result.tls?.protocol}</td></tr>
              {result.tls?.cipher_suite && (
                <tr>
                  <td style={{ fontWeight: 600 }}>Cipher Suite</td>
                  <td>
                    <code style={{ fontSize: "0.85rem" }}>{result.tls.cipher_suite}</code>{" "}
                    {result.tls.cipher_security && (
                      <Badge
                        color={
                          result.tls.cipher_security === "recommended" ? "var(--color-success)"
                            : result.tls.cipher_security === "secure" ? "var(--color-info)"
                              : result.tls.cipher_security === "weak" ? "var(--color-warning)"
                                : "var(--color-danger)"
                        }
                        label={result.tls.cipher_security}
                      />
                    )}
                  </td>
                </tr>
              )}
              <tr>
                <td style={{ fontWeight: 600 }}>Valid From</td>
                <td>{result.tls?.valid_from ? new Date(result.tls.valid_from).toLocaleDateString() : "\u2014"}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Valid To</td>
                <td>{result.tls?.valid_to ? new Date(result.tls.valid_to).toLocaleDateString() : "\u2014"}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>SANs ({result.tls?.sans?.length || 0})</td>
                <td style={{ wordBreak: "break-all", fontSize: "0.85rem" }}>
                  {result.tls?.sans?.length ? (
                    <details>
                      <summary style={{ cursor: "pointer" }}>
                        {result.tls.sans.slice(0, 3).join(", ")}
                        {result.tls.sans.length > 3 && ` + ${result.tls.sans.length - 3} more`}
                      </summary>
                      <div style={{ marginTop: "0.5rem" }}>
                        {result.tls.sans.map((san, i) => <div key={i}>{san}</div>)}
                      </div>
                    </details>
                  ) : "\u2014"}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
