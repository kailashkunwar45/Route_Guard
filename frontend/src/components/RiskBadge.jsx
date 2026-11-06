import { riskMeta } from "../lib/risk";

export default function RiskBadge({ level, className = "" }) {
  const meta = riskMeta(level);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium ${className}`}
    >
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: meta.color }} aria-hidden />
      {meta.name}
    </span>
  );
}
