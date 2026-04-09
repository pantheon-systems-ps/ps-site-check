import { Panel, Callout } from "@pantheon-systems/pds-toolkit-react";
import type { SiteCheckResult } from "~/types/site-check";

function truncateValue(value: string, max: number) {
  if (value.length <= max) return value;
  return value.slice(0, max) + "...";
}

export default function PantheonTab({
  result,
  pantheon,
}: {
  result: SiteCheckResult;
  pantheon: { isPantheon: boolean; pantheonHeaders: { header: string; value: string }[]; siteUuid?: string; environment?: string; cms?: string };
}) {
  const headers = result.http?.headers || {};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", paddingTop: "1rem" }}>
      <Panel>
        <h4>Platform Detection</h4>
        {pantheon.isPantheon ? (
          <Callout type="info" title="Pantheon Site Detected">
            <p>
              This site is hosted on <strong>Pantheon</strong>.
              {pantheon.cms && <> Framework: <strong>{pantheon.cms}</strong>.</>}
              {pantheon.environment && <> Environment: <strong>{pantheon.environment}</strong>.</>}
            </p>
          </Callout>
        ) : (
          <Callout type="warning" title="Not a Pantheon Site (or debug headers disabled)">
            <p>
              No Pantheon-specific headers detected. This may not be a Pantheon site, or
              the <strong>Pantheon Debug</strong> header was not enabled. Re-check with
              "Pantheon Debug" enabled to get full Pantheon diagnostic headers.
            </p>
          </Callout>
        )}
      </Panel>

      {pantheon.isPantheon && (
        <Panel>
          <h4>Site Identity</h4>
          <table className="pds-table">
            <tbody>
              {pantheon.siteUuid && (
                <tr>
                  <td style={{ fontWeight: 600, width: "20%" }}>Site UUID</td>
                  <td>
                    <code>{pantheon.siteUuid}</code>
                    <a
                      href={`https://dashboard.pantheon.io/sites/${pantheon.siteUuid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ marginLeft: "0.75rem", fontSize: "0.85rem" }}
                    >
                      Open Dashboard
                    </a>
                  </td>
                </tr>
              )}
              {pantheon.environment && (
                <tr>
                  <td style={{ fontWeight: 600 }}>Environment</td>
                  <td><code>{pantheon.environment}</code></td>
                </tr>
              )}
              {pantheon.cms && (
                <tr>
                  <td style={{ fontWeight: 600 }}>Framework</td>
                  <td>{pantheon.cms}</td>
                </tr>
              )}
              {headers["x-pantheon-styx-hostname"] && (
                <tr>
                  <td style={{ fontWeight: 600 }}>Styx Hostname</td>
                  <td><code style={{ fontSize: "0.85rem" }}>{headers["x-pantheon-styx-hostname"]}</code></td>
                </tr>
              )}
              {headers["x-pantheon-endpoint"] && (
                <tr>
                  <td style={{ fontWeight: 600 }}>Endpoint</td>
                  <td><code>{headers["x-pantheon-endpoint"]}</code></td>
                </tr>
              )}
            </tbody>
          </table>
        </Panel>
      )}

      {pantheon.pantheonHeaders.length > 0 && (
        <Panel>
          <h4>Pantheon Response Headers</h4>
          <table className="pds-table">
            <thead>
              <tr>
                <th style={{ width: "30%" }}>Header</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {pantheon.pantheonHeaders.map((h, i) => (
                <tr key={i}>
                  <td><code style={{ fontSize: "0.8rem" }}>{h.header}</code></td>
                  <td style={{ wordBreak: "break-all", fontSize: "0.85rem" }}>
                    {truncateValue(h.value, 300)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {pantheon.cms && (
        <Panel>
          <h4>{pantheon.cms} Details</h4>
          <table className="pds-table">
            <tbody>
              {headers["x-generator"] && (
                <tr>
                  <td style={{ fontWeight: 600, width: "20%" }}>Generator</td>
                  <td>{headers["x-generator"]}</td>
                </tr>
              )}
              {headers["x-drupal-cache"] && (
                <tr>
                  <td style={{ fontWeight: 600 }}>Drupal Cache</td>
                  <td>{headers["x-drupal-cache"]}</td>
                </tr>
              )}
              {headers["x-drupal-dynamic-cache"] && (
                <tr>
                  <td style={{ fontWeight: 600 }}>Dynamic Cache</td>
                  <td>{headers["x-drupal-dynamic-cache"]}</td>
                </tr>
              )}
              {headers["x-powered-by"] && (
                <tr>
                  <td style={{ fontWeight: 600 }}>Powered By</td>
                  <td>{headers["x-powered-by"]}</td>
                </tr>
              )}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
