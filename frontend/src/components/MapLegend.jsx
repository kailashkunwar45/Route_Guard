import { RISK, UNKNOWN } from "../lib/risk";

export default function MapLegend({ mode = "checkpoints" }) {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[220px] rounded border border-slate-200 bg-white/95 px-2.5 py-2 text-[11px] text-slate-700 shadow-sm">
      <p className="mb-1.5 font-semibold text-slate-900">
        {mode === "heatmap" ? "Heatmap legend" : "Risk legend"}
      </p>
      <ul className="space-y-1">
        {[1, 2, 3, 4, 5].map((level) => (
          <li key={level} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: RISK[level].color }} />
            <span>{RISK[level].name}</span>
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: UNKNOWN.color }} />
          <span>{UNKNOWN.name}</span>
        </li>
      </ul>
      {mode === "heatmap" && (
        <p className="mt-1.5 leading-snug text-slate-500">
          Checkpoint samples only — weather is not interpolated between points.
        </p>
      )}
    </div>
  );
}
