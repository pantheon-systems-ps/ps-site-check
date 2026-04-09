export default function InsightRow({ insight }: { insight: { severity: string; category: string; message: string } }) {
  const cls = insight.severity === "error" ? "insight-row--error" : insight.severity === "warning" ? "insight-row--warning" : "insight-row--info";
  return (
    <div className={`insight-row ${cls}`}>
      <span className="insight-row__category">{insight.category}</span>
      <span>{insight.message}</span>
    </div>
  );
}
