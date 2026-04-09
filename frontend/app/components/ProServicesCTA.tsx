/**
 * CTA for Professional Services lead generation.
 * Three variants:
 * - "inline": Between sections — login nudge
 * - "footer": End of results — PS consultation prompt
 * - "compact": Inside AI panel — small inline next to re-analyze
 */

type ProServicesCTAProps = {
  variant?: "inline" | "footer" | "compact";
};

export default function ProServicesCTA({ variant = "footer" }: ProServicesCTAProps) {
  if (variant === "compact") {
    return (
      <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
        Want hands-on help?{" "}
        <a
          href="https://pantheon.io/professional-services"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--color-primary)", textDecoration: "none", fontWeight: 600 }}
        >
          Talk to our team
        </a>
      </span>
    );
  }

  if (variant === "inline") {
    return (
      <div className="cta-inline">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        <span>
          Sign in with your Pantheon account to unlock deeper AI models and premium features.
        </span>
        <a href="/login" className="cta-inline__link">
          Sign in
        </a>
      </div>
    );
  }

  return (
    <div className="cta-footer">
      <p className="cta-footer__heading">
        Need expert help improving these scores?
      </p>
      <p className="cta-footer__body">
        Our Professional Services team specializes in site performance, security hardening, and migration support.
      </p>
      <a
        href="https://pantheon.io/professional-services"
        target="_blank"
        rel="noopener noreferrer"
        className="cta-footer__button"
      >
        Let's talk
      </a>
    </div>
  );
}
