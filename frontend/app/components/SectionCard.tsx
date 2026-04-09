import { useState } from "react";

type SectionCardProps = {
  id?: string;
  title: string;
  score?: { value: string | number; color: string };
  status?: "good" | "warning" | "problem" | "loading" | "neutral";
  summary?: string;
  defaultOpen?: boolean;
  loading?: boolean;
  loadingMessage?: string;
  children: React.ReactNode;
};

export default function SectionCard({
  id,
  title,
  score,
  status = "neutral",
  summary,
  defaultOpen = false,
  loading = false,
  loadingMessage,
  children,
}: SectionCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  const statusClass = loading ? "section-card--loading"
    : status === "problem" ? "section-card--problem"
    : status === "warning" ? "section-card--warning"
    : status === "good" ? "section-card--good"
    : "";

  return (
    <div id={id} className={`section-card ${statusClass}`}>
      <button
        className="section-card__header"
        onClick={() => !loading && setOpen(!open)}
        aria-expanded={open}
        aria-label={`${title} section${summary ? `: ${summary}` : ""}`}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flex: 1, minWidth: 0 }}>
          <svg
            width="10" height="10" viewBox="0 0 10 10"
            style={{
              transform: open ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.15s",
              flexShrink: 0,
              color: "var(--color-text-muted)",
            }}
          >
            <path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>

          <span style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--color-text)" }}>
            {title}
          </span>

          {summary && !loading && (
            <span style={{
              fontSize: "0.78rem", color: "var(--color-text-muted)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {summary}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
          {loading && (
            <svg viewBox="0 0 50 50" width="16" height="16">
              <circle cx="25" cy="25" r="20" fill="none" stroke="var(--color-primary)" strokeWidth="5" strokeDasharray="90 60" strokeLinecap="round">
                <animateTransform attributeName="transform" type="rotate" dur="0.8s" from="0 25 25" to="360 25 25" repeatCount="indefinite" />
              </circle>
            </svg>
          )}
          {score && !loading && (
            <span className="badge" style={{ backgroundColor: score.color }}>
              {score.value}
            </span>
          )}
        </div>
      </button>

      {loading && (
        <div style={{ padding: "2rem 1rem", textAlign: "center", borderTop: "1px solid var(--color-border)" }}>
          <svg viewBox="0 0 50 50" width="24" height="24" style={{ margin: "0 auto" }}>
            <circle cx="25" cy="25" r="20" fill="none" stroke="var(--color-primary)" strokeWidth="4" strokeDasharray="90 60" strokeLinecap="round">
              <animateTransform attributeName="transform" type="rotate" dur="0.8s" from="0 25 25" to="360 25 25" repeatCount="indefinite" />
            </circle>
          </svg>
          <p style={{ color: "var(--color-text-muted)", fontSize: "0.82rem", marginTop: "0.5rem" }}>
            {loadingMessage || "Loading..."}
          </p>
        </div>
      )}

      {open && !loading && (
        <div className="section-card__content">
          {children}
        </div>
      )}
    </div>
  );
}
