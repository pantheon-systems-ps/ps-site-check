import { Panel, Callout } from "@pantheon-systems/pds-toolkit-react";
import type { SiteCheckResult } from "~/types/site-check";

export default function EmailAuthTab({ emailAuth }: { emailAuth: NonNullable<SiteCheckResult["email_auth"]> }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", paddingTop: "1rem" }}>
      <Panel>
        <h4>Email Authentication Grade: {emailAuth.grade}</h4>
      </Panel>

      <Panel>
        <h4>SPF (Sender Policy Framework)</h4>
        {emailAuth.spf.found ? (
          <>
            <Callout type={emailAuth.spf.valid ? "info" : "warning"} title={emailAuth.spf.valid ? "SPF Record Found" : "SPF Issues Detected"}>
              <p><code style={{ fontSize: "0.8rem", wordBreak: "break-all" }}>{emailAuth.spf.record}</code></p>
            </Callout>
            {emailAuth.spf.lookups ? (
              <p style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)", marginTop: "0.5rem" }}>
                DNS lookups: {emailAuth.spf.lookups}/10
              </p>
            ) : null}
            {emailAuth.spf.issues && emailAuth.spf.issues.length > 0 && (
              <div style={{ marginTop: "0.5rem" }}>
                {emailAuth.spf.issues.map((issue, i) => (
                  <Callout key={i} type="warning" title={issue}><span /></Callout>
                ))}
              </div>
            )}
          </>
        ) : (
          <Callout type="critical" title="No SPF Record"><p>No SPF record found for this domain.</p></Callout>
        )}
      </Panel>

      <Panel>
        <h4>DMARC</h4>
        {emailAuth.dmarc.found ? (
          <>
            <Callout type="info" title={`DMARC Policy: ${emailAuth.dmarc.policy || "unknown"}`}>
              <p><code style={{ fontSize: "0.8rem", wordBreak: "break-all" }}>{emailAuth.dmarc.record}</code></p>
            </Callout>
            {emailAuth.dmarc.issues && emailAuth.dmarc.issues.length > 0 && (
              <div style={{ marginTop: "0.5rem" }}>
                {emailAuth.dmarc.issues.map((issue, i) => (
                  <Callout key={i} type="warning" title={issue}><span /></Callout>
                ))}
              </div>
            )}
          </>
        ) : (
          <Callout type="warning" title="No DMARC Record"><p>No DMARC record found at _dmarc.{"{domain}"}.</p></Callout>
        )}
      </Panel>

      <Panel>
        <h4>DKIM</h4>
        <Callout type="info" title="DKIM Check Limited">
          <p>{emailAuth.dkim.note}</p>
        </Callout>
      </Panel>
    </div>
  );
}
