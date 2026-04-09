/**
 * Subtle CTA for Professional Services lead generation.
 * Appears after results to gently guide users toward PS consultation.
 * Two variants: "inline" (between sections) and "footer" (end of results).
 */

type ProServicesCTAProps = {
  variant?: "inline" | "footer";
};

export default function ProServicesCTA({ variant = "footer" }: ProServicesCTAProps) {
  if (variant === "inline") {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.6rem 1rem", borderRadius: "var(--radius-md)",
        border: "1px solid var(--color-border)", background: "var(--color-surface)",
        fontSize: "0.8rem", color: "var(--color-text-secondary)",
      }}>
        <span>
          Sign in with your Pantheon account to unlock deeper AI analysis and premium features.
        </span>
        <a
          href="/login"
          style={{
            color: "var(--color-primary)", fontWeight: 600, textDecoration: "none",
            whiteSpace: "nowrap", marginLeft: "1rem",
          }}
        >
          Sign in
        </a>
      </div>
    );
  }

  return (
    <div style={{
      textAlign: "center", padding: "1.25rem 1rem",
      borderTop: "1px solid var(--color-border)", marginTop: "1rem",
    }}>
      <p style={{ fontSize: "0.82rem", color: "var(--color-text-secondary)", margin: "0 0 0.35rem", lineHeight: 1.5 }}>
        Need expert help improving these scores?
      </p>
      <p style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", margin: 0, lineHeight: 1.5 }}>
        Our Professional Services team specializes in site performance, security hardening, and migration support.{" "}
        <a
          href="https://pantheon.io/professional-services"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--color-primary)", textDecoration: "none", fontWeight: 500 }}
        >
          Let's talk
        </a>
      </p>
    </div>
  );
}
