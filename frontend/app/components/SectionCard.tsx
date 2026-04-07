import { useState, useRef } from "react";

type SectionCardProps = {
  id?: string;
  title: string;
  score?: { value: string | number; color: string };
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
  summary,
  defaultOpen = false,
  loading = false,
  loadingMessage,
  children,
}: SectionCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      id={id}
      ref={ref}
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        overflow: "hidden",
        background: "#fff",
      }}
    >
      {/* Header — always visible, clickable */}
      <button
        onClick={() => !loading && setOpen(!open)}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0.75rem 1rem",
          background: open ? "#f9fafb" : "#fff",
          border: "none",
          cursor: loading ? "default" : "pointer",
          textAlign: "left",
          transition: "background 0.15s",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flex: 1, minWidth: 0 }}>
          {/* Expand/collapse indicator */}
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            style={{
              transform: open ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.15s",
              flexShrink: 0,
              color: "#999",
            }}
          >
            <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>

          <span style={{ fontWeight: 600, fontSize: "0.95rem", color: "#1a1a1a" }}>{title}</span>

          {summary && (
            <span style={{ fontSize: "0.8rem", color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {summary}
            </span>
          )}
        </div>

        {score && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: "32px",
              padding: "0.15rem 0.5rem",
              borderRadius: "999px",
              fontSize: "0.75rem",
              fontWeight: 700,
              color: "#fff",
              backgroundColor: score.color,
              flexShrink: 0,
            }}
          >
            {score.value}
          </span>
        )}

        {loading && (
          <svg viewBox="0 0 50 50" width="18" height="18" style={{ flexShrink: 0 }}>
            <circle cx="25" cy="25" r="20" fill="none" stroke="#4f46e5" strokeWidth="5" strokeDasharray="90 60" strokeLinecap="round">
              <animateTransform attributeName="transform" type="rotate" dur="0.8s" from="0 25 25" to="360 25 25" repeatCount="indefinite" />
            </circle>
          </svg>
        )}
      </button>

      {/* Loading state */}
      {loading && (
        <div style={{ padding: "1.5rem", textAlign: "center", borderTop: "1px solid #f0f0f0" }}>
          <svg viewBox="0 0 50 50" width="24" height="24" style={{ margin: "0 auto" }}>
            <circle cx="25" cy="25" r="20" fill="none" stroke="#4f46e5" strokeWidth="4" strokeDasharray="90 60" strokeLinecap="round">
              <animateTransform attributeName="transform" type="rotate" dur="0.8s" from="0 25 25" to="360 25 25" repeatCount="indefinite" />
            </circle>
          </svg>
          <p style={{ color: "#888", fontSize: "0.85rem", marginTop: "0.5rem" }}>{loadingMessage || "Loading..."}</p>
        </div>
      )}

      {/* Content — shown when expanded and not loading */}
      {open && !loading && (
        <div style={{ padding: "0.75rem 1rem 1rem", borderTop: "1px solid #f0f0f0" }}>
          {children}
        </div>
      )}
    </div>
  );
}
