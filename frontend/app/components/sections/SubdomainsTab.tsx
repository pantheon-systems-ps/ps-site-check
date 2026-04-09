import { Panel, Callout } from "@pantheon-systems/pds-toolkit-react";
import { Link } from "react-router";
import type { SubdomainResult } from "~/types/site-check";

export default function SubdomainsTab({ subdomains }: { subdomains: SubdomainResult | null }) {
  if (!subdomains) {
    return (
      <div style={{ paddingTop: "1rem" }}>
        <Panel>
          <Callout type="info" title="Subdomain Discovery">
            <p>
              Subdomain data was not available for this check. This feature queries
              Certificate Transparency logs to discover subdomains.
            </p>
          </Callout>
        </Panel>
      </div>
    );
  }

  if (subdomains.error) {
    return (
      <div style={{ paddingTop: "1rem" }}>
        <Panel>
          <Callout type="critical" title="Subdomain Lookup Error">
            <p>{subdomains.error}</p>
          </Callout>
        </Panel>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", paddingTop: "1rem" }}>
      <Panel>
        <h4>Certificate Transparency — Subdomain Discovery</h4>
        <p style={{ color: "var(--color-text-secondary)", fontSize: "0.85rem" }}>
          Found <strong>{subdomains.count}</strong> subdomain{subdomains.count !== 1 ? "s" : ""} for{" "}
          <strong>{subdomains.domain}</strong> via {subdomains.source} in {subdomains.duration_ms}ms.
        </p>
        {subdomains.subdomains.length > 0 && (
          <table className="pds-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Subdomain</th>
              </tr>
            </thead>
            <tbody>
              {subdomains.subdomains.map((sub, i) => (
                <tr key={i}>
                  <td style={{ width: "50px", color: "var(--color-text-faint)" }}>{i + 1}</td>
                  <td>
                    <code style={{ fontSize: "0.85rem" }}>{sub}</code>
                    <Link
                      to={`/?url=${encodeURIComponent(sub)}&debug=true&fdebug=true&follow=true`}
                      style={{ marginLeft: "0.75rem", fontSize: "0.8rem" }}
                    >
                      Check
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
