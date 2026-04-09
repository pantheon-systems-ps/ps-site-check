export default function StatusBadge({ code }: { code?: number }) {
  if (!code) return <span>{"\u2014"}</span>;
  const color = code < 300 ? "var(--color-success)" : code < 400 ? "var(--color-warning)" : "var(--color-danger)";
  return (
    <span style={{ color, fontWeight: 700, fontSize: "1.1rem" }}>
      {code}
    </span>
  );
}
