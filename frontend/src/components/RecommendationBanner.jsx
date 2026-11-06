import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

function labelFor(routes, id) {
  const route = (routes || []).find((r) => r.id === id);
  return route?.label || String(id);
}

export default function RecommendationBanner({ recommendation, routes = [] }) {
  if (!recommendation) return null;

  const safe = recommendation.safe_available;
  const warning = recommendation.warning;
  const explanation = recommendation.explanation;

  if (!safe) {
    const blocking = recommendation.blocking || [];
    const least = recommendation.least_restricted_order || [];
    return (
      <div className="flex gap-2 rounded border border-slate-800 bg-white px-3 py-2 text-sm">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-slate-900" />
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">
            {warning || "No safe route available for this departure time"}
          </p>
          <p className="text-slate-700">{explanation}</p>
          {blocking.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-slate-700">
              {blocking.slice(0, 8).map((b, i) => (
                <li key={i}>
                  {b.route_label || labelFor(routes, b.route_id)} CP {b.sequence}: {b.reason}
                </li>
              ))}
            </ul>
          )}
          {least.length > 0 && (
            <p className="mt-2 text-[11px] text-slate-500">
              Least restricted order (not safe):{" "}
              {least.map((id) => labelFor(routes, id)).join(" → ")}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
      <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-700" />
      <div>
        <p className="font-semibold text-emerald-900">
          Recommended: {labelFor(routes, recommendation.recommended_route_id)}
        </p>
        <p className="text-emerald-900/90">{explanation}</p>
        {warning && (
          <p className="mt-1 flex items-start gap-1 text-amber-900">
            <Info size={14} className="mt-0.5 shrink-0" />
            {warning}
          </p>
        )}
      </div>
    </div>
  );
}
