export default function Badge({ color, label }: { color: string; label: string }) {
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
      {label}
    </span>
  );
}
