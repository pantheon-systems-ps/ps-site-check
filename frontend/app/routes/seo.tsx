import type { Route } from "./+types/seo";
import { Form, useNavigation, Link } from "react-router";
import { Panel, Button, Callout, Tabs } from "@pantheon-systems/pds-toolkit-react";

const SITE_CHECK_API =
  process.env.SITE_CHECK_API_URL ||
  "https://api.site-check.ps-pantheon.com";

type SEOAudit = {
  score: number;
  url: string;
  title: { value: string; length: number; rating: string } | null;
  description: { value: string; length: number; rating: string } | null;
  canonical: string;
  open_graph: Record<string, string>;
  twitter_card: Record<string, string>;
  headings: { h1_count: number; h1s: string[]; h2_count: number; h3_count: number; issues: string[] };
  images: { total: number; with_alt: number; without_alt: number; rating: string };
  robots_txt: { found: boolean; size: number; sitemaps: string[]; issues: string[] };
  sitemap: { found: boolean; url: string; url_count: number; issues: string[] };
  structured_data: { type: string; format: string }[];
  hreflang: { lang: string; url: string }[];
  mixed_content: string[];
  issues: string[];
  duration_ms: number;
  error: string;
};

// -- Loader --

export async function loader({ request }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams;
  const url = params.get("url");

  if (!url) {
    return { audit: null, error: null };
  }

  try {
    const apiURL = new URL(`${SITE_CHECK_API}/seo`);
    apiURL.searchParams.set("url", url);

    const resp = await fetch(apiURL.toString());
    if (!resp.ok) {
      return { audit: null, error: `API returned ${resp.status}` };
    }

    const audit: SEOAudit = await resp.json();
    if (audit.error) {
      return { audit: null, error: audit.error };
    }

    return { audit, error: null };
  } catch (e) {
    return { audit: null, error: e instanceof Error ? e.message : "Unknown error" };
  }
}

// -- Score helpers --

function scoreColor(score: number): string {
  if (score >= 80) return "var(--color-success)";
  if (score >= 50) return "var(--color-warning)";
  return "var(--color-danger)";
}

function ratingColor(rating: string): string {
  if (rating === "good" || rating === "optimal") return "var(--color-success)";
  if (rating === "warning" || rating === "acceptable") return "var(--color-warning)";
  return "var(--color-danger)";
}

// -- Main component --

export default function SEO({ loaderData }: Route.ComponentProps) {
  const { audit, error } = loaderData;
  const navigation = useNavigation();
  const isChecking = navigation.state === "loading";

  return (
    <>
      <h2>SEO Audit</h2>
      <Callout type="info" title="SEO Audit" className="pds-spacing-mar-block-end-l">
        <p>
          Enter a URL to audit on-page SEO factors including title, meta description,
          headings, images, structured data, robots.txt, sitemap, and social tags.
        </p>
      </Callout>

      <Panel className="pds-spacing-mar-block-end-l">
        <Form method="get">
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label
                htmlFor="url-input"
                className="pds-spacing-mar-block-end-2xs"
                style={{ display: "block", fontWeight: 600 }}
              >
                URL
              </label>
              <input
                id="url-input"
                name="url"
                type="text"
                placeholder="example.com or https://example.com/page"
                defaultValue={audit?.url?.replace(/^https?:\/\//, "") || ""}
                required
                className="pds-input"
                style={{ width: "100%", padding: "0.5rem 0.75rem" }}
              />
            </div>
            <div>
              <Button
                label={isChecking ? "Auditing..." : "Audit"}
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
          <div style={{ margin: "0 auto 1rem" }}>
            <svg viewBox="0 0 50 50" width="40" height="40">
              <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeWidth="4" strokeDasharray="90 60" strokeLinecap="round">
                <animateTransform attributeName="transform" type="rotate" dur="0.8s" from="0 25 25" to="360 25 25" repeatCount="indefinite" />
              </circle>
            </svg>
          </div>
          <p style={{ color: "var(--color-text-secondary)" }}>Running SEO audit...</p>
        </div>
      )}

      {error && (
        <Callout type="critical" title="Audit failed">
          <p>{error}</p>
        </Callout>
      )}

      {audit && !isChecking && <AuditResults audit={audit} />}
    </>
  );
}

// -- Results --

function AuditResults({ audit }: { audit: SEOAudit }) {
  const color = scoreColor(audit.score);

  return (
    <div className="pds-spacing-mar-block-start-l">
      {/* Score + Summary */}
      <Panel className="pds-spacing-mar-block-end-l">
        <div style={{ display: "flex", alignItems: "center", gap: "1.5rem", flexWrap: "wrap" }}>
          <ScoreCircle score={audit.score} color={color} />
          <div>
            <h3 style={{ margin: 0 }}>SEO Score</h3>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "0.85rem", margin: "0.25rem 0 0" }}>
              Audited <strong>{audit.url}</strong> in {audit.duration_ms}ms
            </p>
            <p style={{ margin: "0.25rem 0 0" }}>
              <Link to={`/?url=${encodeURIComponent(audit.url.replace(/^https?:\/\//, ""))}&debug=true&fdebug=true&follow=true`} style={{ fontSize: "0.85rem" }}>
                Run Site Check
              </Link>
            </p>
          </div>
        </div>
      </Panel>

      {/* Tabbed details */}
      <Tabs
        ariaLabel="SEO audit details"
        tabs={[
          {
            tabId: "overview",
            tabLabel: "Overview",
            tally: audit.issues.length > 0
              ? { label: audit.issues.length, type: "critical" as const }
              : undefined,
            panelContent: <OverviewTab audit={audit} />,
          },
          {
            tabId: "content",
            tabLabel: "Content",
            panelContent: <ContentTab audit={audit} />,
          },
          {
            tabId: "technical",
            tabLabel: "Technical",
            panelContent: <TechnicalTab audit={audit} />,
          },
          {
            tabId: "social",
            tabLabel: "Social",
            tally: Object.keys(audit.open_graph).length + Object.keys(audit.twitter_card).length > 0
              ? { label: Object.keys(audit.open_graph).length + Object.keys(audit.twitter_card).length, type: "neutral" as const }
              : undefined,
            panelContent: <SocialTab audit={audit} />,
          },
        ]}
      />
    </div>
  );
}

// -- Score Circle --

function ScoreCircle({ score, color }: { score: number; color: string }) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div style={{ position: "relative", width: "100px", height: "100px", flexShrink: 0 }}>
      <svg viewBox="0 0 100 100" width="100" height="100">
        <circle
          cx="50" cy="50" r={radius}
          fill="none" stroke="var(--color-border)" strokeWidth="8"
        />
        <circle
          cx="50" cy="50" r={radius}
          fill="none" stroke={color} strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 50 50)"
          style={{ transition: "stroke-dashoffset 0.5s ease" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          top: 0, left: 0, right: 0, bottom: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "1.5rem", fontWeight: 700, color,
        }}
      >
        {score}
      </div>
    </div>
  );
}

// -- Tab: Overview --

function OverviewTab({ audit }: { audit: SEOAudit }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", paddingTop: "1rem" }}>
      {/* Title */}
      <Panel>
        <h4>Title Tag</h4>
        {audit.title ? (
          <table className="pds-table">
            <tbody>
              <tr>
                <td style={{ fontWeight: 600, width: "20%" }}>Value</td>
                <td>{audit.title.value || "\u2014"}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Length</td>
                <td>
                  {audit.title.length} characters{" "}
                  <RatingBadge rating={audit.title.rating} />
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <Callout type="critical" title="Missing Title">
            <p>No title tag was found on this page.</p>
          </Callout>
        )}
      </Panel>

      {/* Meta Description */}
      <Panel>
        <h4>Meta Description</h4>
        {audit.description ? (
          <table className="pds-table">
            <tbody>
              <tr>
                <td style={{ fontWeight: 600, width: "20%" }}>Value</td>
                <td style={{ fontSize: "0.85rem" }}>{audit.description.value || "\u2014"}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Length</td>
                <td>
                  {audit.description.length} characters{" "}
                  <RatingBadge rating={audit.description.rating} />
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <Callout type="warning" title="Missing Meta Description">
            <p>No meta description was found on this page.</p>
          </Callout>
        )}
      </Panel>

      {/* Canonical */}
      <Panel>
        <h4>Canonical URL</h4>
        {audit.canonical ? (
          <p style={{ fontSize: "0.85rem", wordBreak: "break-all" }}>
            <code>{audit.canonical}</code>
          </p>
        ) : (
          <Callout type="warning" title="No Canonical">
            <p>No canonical URL was found on this page.</p>
          </Callout>
        )}
      </Panel>

      {/* Issues */}
      {audit.issues.length > 0 && (
        <Panel>
          <h4>Issues ({audit.issues.length})</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {audit.issues.map((issue, i) => (
              <Callout key={i} type="warning" title={issue}>
                <span />
              </Callout>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

// -- Tab: Content --

function ContentTab({ audit }: { audit: SEOAudit }) {
  const { headings, images, structured_data, hreflang } = audit;
  const altPercent = images.total > 0 ? Math.round((images.with_alt / images.total) * 100) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", paddingTop: "1rem" }}>
      {/* Headings */}
      <Panel>
        <h4>Headings Hierarchy</h4>
        <table className="pds-table">
          <thead>
            <tr>
              <th>Tag</th>
              <th>Count</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ fontWeight: 600 }}>H1</td>
              <td>
                <span style={{ color: headings.h1_count === 1 ? "var(--color-success)" : headings.h1_count === 0 ? "var(--color-danger)" : "var(--color-warning)", fontWeight: 700 }}>
                  {headings.h1_count}
                </span>
              </td>
              <td style={{ fontSize: "0.85rem" }}>
                {headings.h1s?.length > 0
                  ? headings.h1s.map((h, i) => <div key={i}>{h}</div>)
                  : "\u2014"}
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>H2</td>
              <td>{headings.h2_count}</td>
              <td style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>\u2014</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>H3</td>
              <td>{headings.h3_count}</td>
              <td style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>\u2014</td>
            </tr>
          </tbody>
        </table>
        {headings.issues?.length > 0 && (
          <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {headings.issues.map((issue, i) => (
              <Callout key={i} type="warning" title={issue}>
                <span />
              </Callout>
            ))}
          </div>
        )}
      </Panel>

      {/* Images */}
      <Panel>
        <h4>Image Alt Text Audit</h4>
        <table className="pds-table">
          <tbody>
            <tr>
              <td style={{ fontWeight: 600, width: "25%" }}>Total Images</td>
              <td>{images.total}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>With Alt Text</td>
              <td style={{ color: "var(--color-success)" }}>{images.with_alt}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>Without Alt Text</td>
              <td style={{ color: images.without_alt > 0 ? "var(--color-danger)" : "var(--color-success)" }}>{images.without_alt}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>Rating</td>
              <td><RatingBadge rating={images.rating} /></td>
            </tr>
          </tbody>
        </table>
        {images.total > 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <div style={{ flex: 1, height: "8px", backgroundColor: "var(--color-border)", borderRadius: "4px", overflow: "hidden" }}>
                <div
                  style={{
                    width: `${altPercent}%`,
                    height: "100%",
                    backgroundColor: altPercent === 100 ? "var(--color-success)" : altPercent >= 80 ? "var(--color-warning)" : "var(--color-danger)",
                    borderRadius: "4px",
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
              <span style={{ fontSize: "0.85rem", fontWeight: 600, minWidth: "3rem" }}>{altPercent}%</span>
            </div>
          </div>
        )}
      </Panel>

      {/* Structured Data */}
      <Panel>
        <h4>Structured Data</h4>
        {structured_data && structured_data.length > 0 ? (
          <table className="pds-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Format</th>
              </tr>
            </thead>
            <tbody>
              {structured_data.map((sd, i) => (
                <tr key={i}>
                  <td>{sd.type}</td>
                  <td><code style={{ fontSize: "0.85rem" }}>{sd.format}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Callout type="info" title="No Structured Data">
            <p>No structured data (JSON-LD, Microdata, RDFa) was detected on this page.</p>
          </Callout>
        )}
      </Panel>

      {/* Hreflang */}
      <Panel>
        <h4>Hreflang Tags</h4>
        {hreflang && hreflang.length > 0 ? (
          <table className="pds-table">
            <thead>
              <tr>
                <th>Language</th>
                <th>URL</th>
              </tr>
            </thead>
            <tbody>
              {hreflang.map((h, i) => (
                <tr key={i}>
                  <td><code>{h.lang}</code></td>
                  <td style={{ wordBreak: "break-all", fontSize: "0.85rem" }}>{h.url}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ color: "var(--color-text-secondary)", fontSize: "0.85rem" }}>No hreflang tags found.</p>
        )}
      </Panel>
    </div>
  );
}

// -- Tab: Technical --

function TechnicalTab({ audit }: { audit: SEOAudit }) {
  const { robots_txt, sitemap, mixed_content } = audit;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", paddingTop: "1rem" }}>
      {/* robots.txt */}
      <Panel>
        <h4>robots.txt</h4>
        <table className="pds-table">
          <tbody>
            <tr>
              <td style={{ fontWeight: 600, width: "25%" }}>Status</td>
              <td>
                <StatusBadge found={robots_txt.found} />
              </td>
            </tr>
            {robots_txt.found && (
              <tr>
                <td style={{ fontWeight: 600 }}>Size</td>
                <td>{robots_txt.size} bytes</td>
              </tr>
            )}
            {robots_txt.sitemaps?.length > 0 && (
              <tr>
                <td style={{ fontWeight: 600 }}>Sitemaps Referenced</td>
                <td style={{ fontSize: "0.85rem" }}>
                  {robots_txt.sitemaps.map((s, i) => (
                    <div key={i} style={{ wordBreak: "break-all" }}>{s}</div>
                  ))}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {robots_txt.issues?.length > 0 && (
          <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {robots_txt.issues.map((issue, i) => (
              <Callout key={i} type="warning" title={issue}>
                <span />
              </Callout>
            ))}
          </div>
        )}
      </Panel>

      {/* sitemap.xml */}
      <Panel>
        <h4>Sitemap</h4>
        <table className="pds-table">
          <tbody>
            <tr>
              <td style={{ fontWeight: 600, width: "25%" }}>Status</td>
              <td>
                <StatusBadge found={sitemap.found} />
              </td>
            </tr>
            {sitemap.found && sitemap.url && (
              <tr>
                <td style={{ fontWeight: 600 }}>URL</td>
                <td style={{ wordBreak: "break-all", fontSize: "0.85rem" }}>
                  <code>{sitemap.url}</code>
                </td>
              </tr>
            )}
            {sitemap.found && (
              <tr>
                <td style={{ fontWeight: 600 }}>URL Count</td>
                <td>{sitemap.url_count.toLocaleString()}</td>
              </tr>
            )}
          </tbody>
        </table>
        {sitemap.issues?.length > 0 && (
          <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {sitemap.issues.map((issue, i) => (
              <Callout key={i} type="warning" title={issue}>
                <span />
              </Callout>
            ))}
          </div>
        )}
      </Panel>

      {/* Mixed Content */}
      <Panel>
        <h4>Mixed Content</h4>
        {mixed_content && mixed_content.length > 0 ? (
          <>
            <Callout type="critical" title={`${mixed_content.length} mixed content warning${mixed_content.length !== 1 ? "s" : ""}`}>
              <p>HTTP resources loaded on an HTTPS page can cause security warnings and browser blocks.</p>
            </Callout>
            <table className="pds-table" style={{ marginTop: "0.75rem" }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Resource</th>
                </tr>
              </thead>
              <tbody>
                {mixed_content.map((url, i) => (
                  <tr key={i}>
                    <td style={{ width: "50px", color: "var(--color-text-faint)" }}>{i + 1}</td>
                    <td style={{ wordBreak: "break-all", fontSize: "0.85rem" }}>
                      <code>{url}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <Callout type="info" title="No Mixed Content">
            <p>No mixed content warnings detected.</p>
          </Callout>
        )}
      </Panel>
    </div>
  );
}

// -- Tab: Social --

function SocialTab({ audit }: { audit: SEOAudit }) {
  const ogEntries = Object.entries(audit.open_graph || {});
  const twEntries = Object.entries(audit.twitter_card || {});

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", paddingTop: "1rem" }}>
      {/* Open Graph */}
      <Panel>
        <h4>Open Graph Tags</h4>
        {ogEntries.length > 0 ? (
          <table className="pds-table">
            <thead>
              <tr>
                <th style={{ width: "30%" }}>Property</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {ogEntries.map(([key, value], i) => (
                <tr key={i}>
                  <td><code style={{ fontSize: "0.85rem" }}>{key}</code></td>
                  <td style={{ wordBreak: "break-all", fontSize: "0.85rem" }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Callout type="warning" title="No Open Graph Tags">
            <p>
              No Open Graph meta tags were found. These tags control how links appear when
              shared on Facebook, LinkedIn, and other platforms.
            </p>
          </Callout>
        )}
      </Panel>

      {/* Twitter Card */}
      <Panel>
        <h4>Twitter Card Tags</h4>
        {twEntries.length > 0 ? (
          <table className="pds-table">
            <thead>
              <tr>
                <th style={{ width: "30%" }}>Property</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {twEntries.map(([key, value], i) => (
                <tr key={i}>
                  <td><code style={{ fontSize: "0.85rem" }}>{key}</code></td>
                  <td style={{ wordBreak: "break-all", fontSize: "0.85rem" }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Callout type="warning" title="No Twitter Card Tags">
            <p>
              No Twitter Card meta tags were found. These tags control how links appear
              when shared on X (Twitter).
            </p>
          </Callout>
        )}
      </Panel>
    </div>
  );
}

// -- Shared utilities --

function StatusBadge({ found }: { found: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.2rem 0.6rem",
        borderRadius: "999px",
        fontSize: "0.75rem",
        fontWeight: 600,
        color: "var(--color-white)",
        backgroundColor: found ? "var(--color-success)" : "var(--color-danger)",
      }}
    >
      {found ? "Found" : "Not Found"}
    </span>
  );
}

function RatingBadge({ rating }: { rating: string }) {
  const color = ratingColor(rating);
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.2rem 0.6rem",
        borderRadius: "999px",
        fontSize: "0.75rem",
        fontWeight: 600,
        color: "var(--color-white)",
        backgroundColor: color,
      }}
    >
      {rating}
    </span>
  );
}
