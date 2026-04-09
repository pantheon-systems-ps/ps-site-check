import { Panel } from "@pantheon-systems/pds-toolkit-react";
import type { SiteCheckResult } from "~/types/site-check";
import Badge from "~/components/ui/Badge";

function truncateValue(value: string, max: number) {
  if (value.length <= max) return value;
  return value.slice(0, max) + "...";
}

export default function SecurityTab({ security }: { security: NonNullable<SiteCheckResult["security"]> }) {
  const ratingColor = (rating: string) => {
    switch (rating) {
      case "good": return "var(--color-success)";
      case "warning": return "var(--color-warning)";
      case "missing": return "var(--color-text-faint)";
      case "bad": return "var(--color-danger)";
      default: return "var(--color-text-secondary)";
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", paddingTop: "1rem" }}>
      <Panel>
        <h4>Security Score: {security.score}/100 (Grade {security.grade})</h4>
        <table className="pds-table">
          <thead>
            <tr>
              <th>Header</th>
              <th>Status</th>
              <th>Value</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {security.headers.map((h, i) => (
              <tr key={i}>
                <td><code style={{ fontSize: "0.8rem" }}>{h.name}</code></td>
                <td>
                  <Badge color={ratingColor(h.rating)} label={h.rating} />
                </td>
                <td style={{ fontSize: "0.85rem", maxWidth: "200px", wordBreak: "break-all" }}>
                  {h.present ? truncateValue(h.value || "", 80) : "\u2014"}
                </td>
                <td style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>{h.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {security.cookies && security.cookies.length > 0 && (
        <Panel>
          <h4>Cookie Audit</h4>
          <table className="pds-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Secure</th>
                <th>HttpOnly</th>
                <th>SameSite</th>
                <th>Issues</th>
              </tr>
            </thead>
            <tbody>
              {security.cookies.map((c, i) => (
                <tr key={i}>
                  <td><code style={{ fontSize: "0.8rem" }}>{c.name}</code></td>
                  <td style={{ color: c.secure ? "var(--color-success)" : "var(--color-danger)" }}>{c.secure ? "Yes" : "No"}</td>
                  <td style={{ color: c.http_only ? "var(--color-success)" : "var(--color-danger)" }}>{c.http_only ? "Yes" : "No"}</td>
                  <td>{c.same_site || "\u2014"}</td>
                  <td style={{ fontSize: "0.85rem", color: "var(--color-danger)" }}>{c.issues?.join("; ") || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
