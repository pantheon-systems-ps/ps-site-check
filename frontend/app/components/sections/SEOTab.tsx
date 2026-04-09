import { Panel, Callout } from "@pantheon-systems/pds-toolkit-react";
import Badge from "~/components/ui/Badge";

export default function SEOTab({ seo }: { seo: any }) {
  const scoreColor = seo.score >= 80 ? "var(--color-success)" : seo.score >= 50 ? "var(--color-warning)" : "var(--color-danger)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", paddingTop: "1rem" }}>
      <Panel>
        <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
          <div style={{
            width: "64px", height: "64px", borderRadius: "50%",
            border: `4px solid ${scoreColor}`, display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "1.5rem", fontWeight: 700, color: scoreColor,
          }}>
            {seo.score}
          </div>
          <div>
            <h4 style={{ margin: 0 }}>SEO Score</h4>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "0.85rem", margin: 0 }}>Completed in {seo.duration_ms}ms</p>
          </div>
        </div>
      </Panel>

      {seo.issues && seo.issues.length > 0 && (
        <Panel>
          <h4>Issues ({seo.issues.length})</h4>
          {seo.issues.map((issue: string, i: number) => (
            <Callout key={i} type="warning" title={issue}><span /></Callout>
          ))}
        </Panel>
      )}

      <Panel>
        <h4>Meta Tags</h4>
        <table className="pds-table">
          <tbody>
            <tr>
              <td style={{ fontWeight: 600, width: "15%" }}>Title</td>
              <td>{seo.title?.value || "\u2014"}</td>
              <td style={{ width: "15%" }}>
                {seo.title && <Badge color={seo.title.rating === "good" ? "var(--color-success)" : "var(--color-warning)"} label={`${seo.title.length} chars`} />}
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>Description</td>
              <td style={{ fontSize: "0.85rem" }}>{seo.description?.value || "\u2014"}</td>
              <td>
                {seo.description && <Badge color={seo.description.rating === "good" ? "var(--color-success)" : "var(--color-warning)"} label={`${seo.description.length} chars`} />}
              </td>
            </tr>
            {seo.canonical && (
              <tr>
                <td style={{ fontWeight: 600 }}>Canonical</td>
                <td colSpan={2} style={{ fontSize: "0.85rem", wordBreak: "break-all" }}>{seo.canonical}</td>
              </tr>
            )}
          </tbody>
        </table>
      </Panel>

      <Panel>
        <h4>Headings</h4>
        <table className="pds-table">
          <thead><tr><th>Type</th><th>Count</th><th>Content</th></tr></thead>
          <tbody>
            <tr>
              <td style={{ fontWeight: 600 }}>H1</td>
              <td>{seo.headings?.h1_count || 0}</td>
              <td style={{ fontSize: "0.85rem" }}>{seo.headings?.h1s?.join(", ") || "\u2014"}</td>
            </tr>
            <tr><td style={{ fontWeight: 600 }}>H2</td><td>{seo.headings?.h2_count || 0}</td><td></td></tr>
            <tr><td style={{ fontWeight: 600 }}>H3</td><td>{seo.headings?.h3_count || 0}</td><td></td></tr>
          </tbody>
        </table>
      </Panel>

      {seo.images && (
        <Panel>
          <h4>Images: Alt Text Audit</h4>
          <p style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>
            {seo.images.with_alt}/{seo.images.total} images have alt text
          </p>
          <div style={{ background: "var(--color-border)", borderRadius: "4px", height: "8px", marginTop: "0.5rem" }}>
            <div style={{
              background: seo.images.rating === "good" ? "var(--color-success)" : seo.images.rating === "warning" ? "var(--color-warning)" : "var(--color-danger)",
              height: "100%", borderRadius: "4px",
              width: seo.images.total > 0 ? `${(seo.images.with_alt / seo.images.total) * 100}%` : "0%",
            }} />
          </div>
        </Panel>
      )}

      <Panel>
        <h4>Technical SEO</h4>
        <table className="pds-table">
          <tbody>
            <tr>
              <td style={{ fontWeight: 600, width: "20%" }}>robots.txt</td>
              <td>
                <Badge color={seo.robots_txt?.found ? "var(--color-success)" : "var(--color-danger)"} label={seo.robots_txt?.found ? "Found" : "Missing"} />
                {seo.robots_txt?.sitemaps?.length > 0 && (
                  <span style={{ marginLeft: "0.5rem", fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>
                    Sitemaps: {seo.robots_txt.sitemaps.length}
                  </span>
                )}
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>sitemap.xml</td>
              <td>
                <Badge color={seo.sitemap?.found ? "var(--color-success)" : "var(--color-danger)"} label={seo.sitemap?.found ? "Found" : "Missing"} />
                {seo.sitemap?.url_count > 0 && (
                  <span style={{ marginLeft: "0.5rem", fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>
                    {seo.sitemap.url_count} URLs
                  </span>
                )}
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>Structured Data</td>
              <td>
                {seo.structured_data?.length > 0
                  ? seo.structured_data.map((sd: any, i: number) => <Badge key={i} color="var(--color-primary)" label={sd.type} />)
                  : <span style={{ color: "var(--color-text-faint)" }}>None detected</span>}
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>Mixed Content</td>
              <td>
                {seo.mixed_content?.length > 0
                  ? <Badge color="var(--color-danger)" label={`${seo.mixed_content.length} issues`} />
                  : <Badge color="var(--color-success)" label="Clean" />}
              </td>
            </tr>
          </tbody>
        </table>
      </Panel>

      {Object.keys(seo.open_graph || {}).length > 0 && (
        <Panel>
          <h4>Open Graph Tags</h4>
          <table className="pds-table">
            <tbody>
              {Object.entries(seo.open_graph).map(([key, value]: [string, any]) => (
                <tr key={key}>
                  <td style={{ fontWeight: 600, width: "20%" }}>{key}</td>
                  <td style={{ fontSize: "0.85rem", wordBreak: "break-all" }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
