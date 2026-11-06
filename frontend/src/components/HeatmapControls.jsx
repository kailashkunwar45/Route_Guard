import { RISK, UNKNOWN } from "../lib/risk";
import { countRisks } from "../lib/geojson";
import RiskBadge from "./RiskBadge";

export default function HeatmapControls({
  hour,
  onHourChange,
  riskMode,
  onRiskModeChange,
  checkpoints,
}) {
  const counts = countRisks(checkpoints, riskMode, hour);

  return (
    <div className="space-y-3 rounded border border-slate-200 bg-white p-3 text-sm">
      <div>
        <p className="font-semibold text-slate-900">Checkpoint-based weather heatmap</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Risk is sampled at route checkpoints only — not a continuous weather field.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onRiskModeChange("eta")}
          className={`rounded border px-2.5 py-1 text-xs font-medium ${
            riskMode === "eta"
              ? "border-primary bg-blue-50 text-primary"
              : "border-slate-200 text-slate-700"
          }`}
        >
          At expected arrival
        </button>
        <button
          type="button"
          onClick={() => onRiskModeChange("hour")}
          className={`rounded border px-2.5 py-1 text-xs font-medium ${
            riskMode === "hour"
              ? "border-primary bg-blue-50 text-primary"
              : "border-slate-200 text-slate-700"
          }`}
        >
          At selected hour
        </button>
      </div>

      <label className="block">
        <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
          <span>Hours after departure</span>
          <span className="font-semibold text-slate-900">{hour}h</span>
        </div>
        <input
          type="range"
          min={0}
          max={48}
          step={1}
          value={hour}
          disabled={riskMode !== "hour"}
          onChange={(e) => onHourChange(Number(e.target.value))}
          className="w-full accent-primary disabled:opacity-40"
        />
      </label>

      <div>
        <p className="mb-1.5 text-xs font-medium text-slate-600">Legend</p>
        <div className="flex flex-wrap gap-1.5">
          {[1, 2, 3, 4, 5].map((level) => (
            <RiskBadge key={level} level={level} />
          ))}
          <RiskBadge level={null} />
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-slate-600">
          Checkpoint counts
          {riskMode === "hour" ? ` at +${hour}h` : " at expected arrival"}
        </p>
        <ul className="grid grid-cols-2 gap-1 text-xs text-slate-700">
          {[1, 2, 3, 4, 5].map((level) => (
            <li key={level} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: RISK[level].color }} />
              {RISK[level].name}: {counts[level]}
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: UNKNOWN.color }} />
            {UNKNOWN.name}: {counts.unavailable}
          </li>
        </ul>
      </div>
    </div>
  );
}
