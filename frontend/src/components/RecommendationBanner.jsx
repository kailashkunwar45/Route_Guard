import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

export default function RecommendationBanner({ recommendation }) {
  if (!recommendation) return null;

  const safe = recommendation.safe_available;
  const warning = recommendation.warning;
  const explanation = recommendation.explanation;

  if (!safe) {
    return (
      <div className="flex gap-2 rounded border border-slate-800 bg-white px-3 py-2 text-sm">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-slate-900" />
        <div>
          <p className="font-semibold text-slate-900">No safe route</p>
          <p className="text-slate-700">
            {warning || explanation || "Every route includes a No Travel segment."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
      <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-700" />
      <div>
        <p className="font-semibold text-emerald-900">Recommendation</p>
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
