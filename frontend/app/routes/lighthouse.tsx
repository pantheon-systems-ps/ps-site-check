import type { Route } from "./+types/lighthouse";
import { Form, useNavigation } from "react-router";
import { Panel, Button, Callout } from "@pantheon-systems/pds-toolkit-react";

const SITE_CHECK_API =
  process.env.SITE_CHECK_API_URL ||
  "https://api.site-check.ps-pantheon.com";

// -- Types --

type LighthouseResult = {
  performance: number;
  accessibility: number;
  best_practices: number;
  seo: number;
  fcp: string;
  lcp: string;
  tbt: string;
  cls: string;
  speed_index: string;
  strategy: string;
  duration_ms: number;
  error: string;
};

type WebVitalMetric = {
  p75: number;
  rating: string;
  good: number;
  ni: number;
  poor: number;
  unit: string;
};

type CrUXData = {
  origin: string;
  form_factor: string;
  lcp: WebVitalMetric | null;
  inp: WebVitalMetric | null;
  cls: WebVitalMetric | null;
  fcp: WebVitalMetric | null;
  ttfb: WebVitalMetric | null;
  error: string;
};

// -- Loader --

export async function loader({ request }: Route.LoaderArgs) {
  const params = new URL(request.url).searchParams;
  const url = params.get("url");

  if (!url) {
    return { lighthouse: null, crux: null, error: null, url: null, strategy: "mobile" };
  }

  const strategy = params.get("strategy") || "mobile";

  // Extract origin from URL for CrUX
  let origin: string;
  try {
    const parsed = url.startsWith("http") ? new URL(url) : new URL(`https://${url}`);
    origin = parsed.origin;
  } catch {
    return { lighthouse: null, crux: null, error: "Invalid URL", url, strategy };
  }

  try {
    const lighthouseURL = new URL(`${SITE_CHECK_API}/lighthouse`);
    lighthouseURL.searchParams.set("url", url);
    lighthouseURL.searchParams.set("strategy", strategy);

    const cruxURL = new URL(`${SITE_CHECK_API}/crux`);
    cruxURL.searchParams.set("origin", origin);

    const [lhResp, cruxResp] = await Promise.all([
      fetch(lighthouseURL.toString()),
      fetch(cruxURL.toString()).catch(() => null),
    ]);

    if (!lhResp.ok) {
      return {
        lighthouse: null,
        crux: null,
        error: `Lighthouse API returned ${lhResp.status}`,
        url,
        strategy,
      };
    }

    const lighthouse: LighthouseResult = await lhResp.json();

    if (lighthouse.error) {
      return { lighthouse: null, crux: null, error: lighthouse.error, url, strategy };
    }

    let crux: CrUXData | null = null;
    if (cruxResp?.ok) {
      const cruxData: CrUXData = await cruxResp.json();
      if (!cruxData.error) {
        crux = cruxData;
      }
    }

    return { lighthouse, crux, error: null, url, strategy };
  } catch (e) {
    return {
      lighthouse: null,
      crux: null,
      error: e instanceof Error ? e.message : "Unknown error",
      url,
      strategy,
    };
  }
}

// -- Score color helpers --

function scoreColor(score: number): string {
  if (score >= 90) return "#0cce6b";
  if (score >= 50) return "#ffa400";
  return "#ff4e42";
}

function ratingColor(rating: string): string {
  switch (rating) {
    case "good":
      return "#0cce6b";
    case "needs-improvement":
    case "needs improvement":
      return "#ffa400";
    case "poor":
      return "#ff4e42";
    default:
      return "#888";
  }
}

function ratingLabel(rating: string): string {
  switch (rating) {
    case "good":
      return "Good";
    case "needs-improvement":
    case "needs improvement":
      return "Needs Improvement";
    case "poor":
      return "Poor";
    default:
      return rating;
  }
}

// -- Circular gauge SVG --

function CircularGauge({
  score,
  label,
  size = 96,
}: {
  score: number;
  label: string;
  size?: number;
}) {
  const color = scoreColor(score);
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem" }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        style={{ transform: "rotate(-90deg)" }}
      >
        {/* Background track */}
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="#e0e0e0"
          strokeWidth="6"
        />
        {/* Score arc */}
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
        {/* Score text (counter-rotated so it reads normally) */}
        <text
          x="50"
          y="50"
          textAnchor="middle"
          dominantBaseline="central"
          style={{
            transform: "rotate(90deg)",
            transformOrigin: "50px 50px",
            fontSize: "22px",
            fontWeight: 700,
            fill: color,
          }}
        >
          {score}
        </text>
      </svg>
      <span
        style={{
          fontSize: "0.8rem",
          fontWeight: 600,
          color: "#444",
          textAlign: "center",
          lineHeight: 1.2,
        }}
      >
        {label}
      </span>
    </div>
  );
}

// -- Distribution bar for CrUX --

function DistributionBar({
  good,
  ni,
  poor,
}: {
  good: number;
  ni: number;
  poor: number;
}) {
  const total = good + ni + poor;
  if (total === 0) return <span>{"\u2014"}</span>;

  const goodPct = (good / total) * 100;
  const niPct = (ni / total) * 100;
  const poorPct = (poor / total) * 100;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", minWidth: "160px" }}>
      <div
        style={{
          display: "flex",
          height: "8px",
          borderRadius: "4px",
          overflow: "hidden",
          backgroundColor: "#e0e0e0",
        }}
      >
        {goodPct > 0 && (
          <div style={{ width: `${goodPct}%`, backgroundColor: "#0cce6b" }} />
        )}
        {niPct > 0 && (
          <div style={{ width: `${niPct}%`, backgroundColor: "#ffa400" }} />
        )}
        {poorPct > 0 && (
          <div style={{ width: `${poorPct}%`, backgroundColor: "#ff4e42" }} />
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "#666" }}>
        <span style={{ color: "#0cce6b" }}>{goodPct.toFixed(0)}%</span>
        <span style={{ color: "#ffa400" }}>{niPct.toFixed(0)}%</span>
        <span style={{ color: "#ff4e42" }}>{poorPct.toFixed(0)}%</span>
      </div>
    </div>
  );
}

// -- Format metric value --

function formatMetricValue(value: number, unit: string): string {
  if (unit === "ms" || unit === "millisecond") {
    if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
    return `${Math.round(value)}ms`;
  }
  if (unit === "unitless" || unit === "") {
    return value.toFixed(2);
  }
  return `${value}${unit}`;
}

// -- Main component --

export default function Lighthouse({ loaderData }: Route.ComponentProps) {
  const { lighthouse, crux, error, url, strategy } = loaderData;
  const navigation = useNavigation();
  const isChecking = navigation.state === "loading";

  return (
    <>
      <h2>Lighthouse / PageSpeed</h2>
      <Callout type="info" title="Lighthouse Scores" className="pds-spacing-mar-block-end-l">
        <p>
          Run a Lighthouse audit via Google PageSpeed Insights API and view
          Core Web Vitals from the Chrome UX Report (CrUX). Enter a URL and
          select a device strategy to begin.
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
                defaultValue={url || ""}
                required
                className="pds-input"
                style={{ width: "100%", padding: "0.5rem 0.75rem" }}
              />
            </div>
            <div>
              <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
                <legend
                  style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.35rem" }}
                >
                  Strategy
                </legend>
                <div style={{ display: "flex", gap: "1rem" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="strategy"
                      value="mobile"
                      defaultChecked={strategy !== "desktop"}
                    />
                    Mobile
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="strategy"
                      value="desktop"
                      defaultChecked={strategy === "desktop"}
                    />
                    Desktop
                  </label>
                </div>
              </fieldset>
            </div>
            <div>
              <Button
                label={isChecking ? "Auditing..." : "Run Audit"}
                buttonType="submit"
                variant="brand"
                disabled={isChecking}
              />
            </div>
          </div>
        </Form>
      </Panel>

      {isChecking && (
        <div style={{ textAlign: "center", padding: "3rem 2rem" }}>
          <div style={{ margin: "0 auto 1rem" }}>
            <svg viewBox="0 0 50 50" width="40" height="40">
              <circle
                cx="25"
                cy="25"
                r="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="4"
                strokeDasharray="90 60"
                strokeLinecap="round"
              >
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  dur="0.8s"
                  from="0 25 25"
                  to="360 25 25"
                  repeatCount="indefinite"
                />
              </circle>
            </svg>
          </div>
          <p style={{ color: "#666", fontWeight: 600 }}>Running Lighthouse audit...</p>
          <p style={{ color: "#999", fontSize: "0.85rem" }}>
            This typically takes 15-30 seconds. The page loads and audits the
            site in a real Chromium browser.
          </p>
        </div>
      )}

      {error && (
        <Callout type="critical" title="Audit failed">
          <p>{error}</p>
        </Callout>
      )}

      {lighthouse && !isChecking && (
        <LighthouseResults lighthouse={lighthouse} crux={crux} />
      )}
    </>
  );
}

// -- Results --

function LighthouseResults({
  lighthouse,
  crux,
}: {
  lighthouse: LighthouseResult;
  crux: CrUXData | null;
}) {
  const scores = [
    { label: "Performance", value: lighthouse.performance },
    { label: "Accessibility", value: lighthouse.accessibility },
    { label: "Best Practices", value: lighthouse.best_practices },
    { label: "SEO", value: lighthouse.seo },
  ];

  const metrics = [
    { label: "First Contentful Paint (FCP)", value: lighthouse.fcp },
    { label: "Largest Contentful Paint (LCP)", value: lighthouse.lcp },
    { label: "Total Blocking Time (TBT)", value: lighthouse.tbt },
    { label: "Cumulative Layout Shift (CLS)", value: lighthouse.cls },
    { label: "Speed Index", value: lighthouse.speed_index },
  ];

  const cruxMetrics = crux
    ? [
        { label: "Largest Contentful Paint (LCP)", metric: crux.lcp },
        { label: "Interaction to Next Paint (INP)", metric: crux.inp },
        { label: "Cumulative Layout Shift (CLS)", metric: crux.cls },
        { label: "First Contentful Paint (FCP)", metric: crux.fcp },
        { label: "Time to First Byte (TTFB)", metric: crux.ttfb },
      ]
    : [];

  return (
    <div className="pds-spacing-mar-block-start-l" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Strategy + Duration */}
      <p style={{ color: "#666", fontSize: "0.85rem", textAlign: "right", margin: 0 }}>
        Strategy: <strong>{lighthouse.strategy}</strong> &middot; Completed in{" "}
        <strong>{(lighthouse.duration_ms / 1000).toFixed(1)}s</strong>
      </p>

      {/* Score Gauges */}
      <Panel>
        <h3>Lighthouse Scores</h3>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "2rem",
            flexWrap: "wrap",
            padding: "1.5rem 0",
          }}
        >
          {scores.map((s) => (
            <CircularGauge key={s.label} score={s.value} label={s.label} />
          ))}
        </div>
        {/* Score legend */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "1.5rem",
            fontSize: "0.75rem",
            color: "#888",
            borderTop: "1px solid #eee",
            paddingTop: "0.75rem",
          }}
        >
          <span>
            <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", backgroundColor: "#0cce6b", marginRight: "0.35rem", verticalAlign: "middle" }} />
            90-100
          </span>
          <span>
            <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", backgroundColor: "#ffa400", marginRight: "0.35rem", verticalAlign: "middle" }} />
            50-89
          </span>
          <span>
            <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", backgroundColor: "#ff4e42", marginRight: "0.35rem", verticalAlign: "middle" }} />
            0-49
          </span>
        </div>
      </Panel>

      {/* Metrics Panel */}
      <Panel>
        <h3>Performance Metrics</h3>
        <table className="pds-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.label}>
                <td style={{ fontWeight: 600, fontSize: "0.85rem" }}>{m.label}</td>
                <td>
                  <code style={{ fontSize: "0.9rem" }}>{m.value || "\u2014"}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {/* CrUX Real User Data */}
      {crux && cruxMetrics.some((m) => m.metric) && (
        <Panel>
          <h3>CrUX Real User Data</h3>
          <p style={{ color: "#666", fontSize: "0.85rem" }}>
            Chrome User Experience Report (CrUX) field data for{" "}
            <strong>{crux.origin}</strong>
            {crux.form_factor && <> &middot; Form factor: <strong>{crux.form_factor}</strong></>}
          </p>
          <table className="pds-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>p75</th>
                <th>Rating</th>
                <th style={{ minWidth: "180px" }}>Distribution</th>
              </tr>
            </thead>
            <tbody>
              {cruxMetrics.map((m) => {
                if (!m.metric) return null;
                return (
                  <tr key={m.label}>
                    <td style={{ fontWeight: 600, fontSize: "0.85rem" }}>{m.label}</td>
                    <td>
                      <code style={{ fontSize: "0.9rem" }}>
                        {formatMetricValue(m.metric.p75, m.metric.unit)}
                      </code>
                    </td>
                    <td>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "0.15rem 0.5rem",
                          borderRadius: "999px",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          color: "#fff",
                          backgroundColor: ratingColor(m.metric.rating),
                        }}
                      >
                        {ratingLabel(m.metric.rating)}
                      </span>
                    </td>
                    <td>
                      <DistributionBar
                        good={m.metric.good}
                        ni={m.metric.ni}
                        poor={m.metric.poor}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}

      {/* CrUX not available notice */}
      {!crux && (
        <Callout type="info" title="CrUX Data Not Available">
          <p>
            Chrome User Experience Report (CrUX) data is not available for this
            origin. CrUX requires a site to have sufficient real-user traffic in
            Chrome, and the API requires a valid Google API key configured on the
            server.
          </p>
        </Callout>
      )}
    </div>
  );
}
