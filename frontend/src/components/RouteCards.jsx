import { formatDuration, riskMeta, ROUTE_COLORS } from "../lib/risk";
import RiskBadge from "./RiskBadge";

function StackedBar({ metrics }) {
  const total = metrics?.total_mi || 0;
  if (!total) return null;
  const parts = [
    ["low_mi", 1],
    ["moderate_mi", 2],
    ["high_mi", 3],
    ["severe_mi", 4],
    ["no_travel_mi", 5],
    ["unknown_mi", null],
  ];
  return (
    <div className="mt-2 flex h-2 w-full overflow-hidden rounded-sm border border-slate-200 bg-slate-100">
      {parts.map(([key, level]) => {
        const mi = metrics[key] || 0;
        if (mi <= 0) return null;
        const meta = riskMeta(level);
        return (
          <div
            key={key}
            title={`${meta.name}: ${mi.toFixed(1)} mi`}
            style={{ width: `${(mi / total) * 100}%`, background: meta.color }}
          />
        );
      })}
    </div>
  );
}

export default function RouteCards({
  routes,
  recommendation,
  selectedId,
  onSelect,
}) {
  if (!routes?.length) return null;
  const recId = recommendation?.recommended_route_id;

  return (
    <div className="space-y-2">
      {routes.map((route, idx) => {
        const selected = route.id === selectedId;
        const noTravel = route.metrics?.has_no_travel;
        const avg = route.metrics?.average_risk;
        return (
          <button
            key={route.id}
            type="button"
            onClick={() => onSelect(route.id)}
            className={`w-full rounded border bg-white p-3 text-left transition ${
              selected ? "border-primary ring-1 ring-primary" : "border-slate-200 hover:border-slate-300"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-sm"
                  style={{ background: ROUTE_COLORS[idx % ROUTE_COLORS.length] }}
                />
                <span className="font-semibold text-sm">{route.label}</span>
              </div>
              <span className="text-xs text-slate-500">
                {route.distance_mi?.toFixed(1)} mi · {formatDuration(route.duration_s)}
              </span>
            </div>
            <StackedBar metrics={route.metrics} />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {recId === route.id && (
                <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800">
                  Recommended
                </span>
              )}
              {noTravel && (
                <span className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-800">
                  Not recommended: No Travel
                </span>
              )}
              {route.partial_weather && (
                <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
                  Partial data
                </span>
              )}
              {route.approximate_timing && (
                <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
                  Approximate timing
                </span>
              )}
              {avg != null && <RiskBadge level={Math.round(avg)} />}
            </div>
          </button>
        );
      })}
    </div>
  );
}
