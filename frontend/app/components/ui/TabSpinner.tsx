export default function TabSpinner({ message }: { message: string }) {
  return (
    <div style={{ textAlign: "center", padding: "2rem 1rem" }}>
      <svg viewBox="0 0 50 50" width="28" height="28" style={{ margin: "0 auto" }}>
        <circle cx="25" cy="25" r="20" fill="none" stroke="var(--color-primary)" strokeWidth="4" strokeDasharray="90 60" strokeLinecap="round">
          <animateTransform attributeName="transform" type="rotate" dur="0.8s" from="0 25 25" to="360 25 25" repeatCount="indefinite" />
        </circle>
      </svg>
      <p style={{ color: "var(--color-text-muted)", fontSize: "0.85rem", marginTop: "0.5rem" }}>{message}</p>
    </div>
  );
}
