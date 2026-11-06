import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Clock } from "lucide-react";
import { errorMessage, listAnalyses } from "../lib/api";
import { formatLocal } from "../lib/risk";
import { ErrorBanner, SkeletonBlock } from "../components/StatusBanners";

export default function History() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listAnalyses()
      .then((data) => {
        if (!cancelled) setRows(Array.isArray(data) ? data : []);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto h-full max-w-3xl overflow-y-auto p-4 sm:p-6">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-slate-900">Analysis history</h1>
        <p className="text-sm text-slate-500">Open a prior run to reload routes and checkpoints.</p>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError("")} />

      {loading && (
        <div className="space-y-2">
          <SkeletonBlock className="h-16 w-full" />
          <SkeletonBlock className="h-16 w-full" />
          <SkeletonBlock className="h-16 w-full" />
        </div>
      )}

      {!loading && !rows.length && !error && (
        <p className="rounded border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
          No analyses yet. Run one from the{" "}
          <Link to="/" className="text-primary underline">
            workspace
          </Link>
          .
        </p>
      )}

      <ul className="space-y-2">
        {rows.map((row) => {
          const safe = row.recommendation?.safe_available;
          return (
            <li key={row.id}>
              <Link
                to={`/analysis/${row.id}`}
                className="flex items-start justify-between gap-3 rounded border border-slate-200 bg-white p-3 hover:border-slate-300"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm text-slate-900">
                    {row.origin_name} → {row.destination_name}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <Clock size={12} />
                      {formatLocal(row.created_at)}
                    </span>
                    <span>{row.load_lb?.toLocaleString()} lb</span>
                    <span>{row.route_count} routes</span>
                    {row.use_fixtures && <span>fixtures</span>}
                    {safe === false && (
                      <span className="font-medium text-slate-800">No safe route</span>
                    )}
                  </p>
                </div>
                <ArrowRight size={16} className="mt-1 shrink-0 text-slate-400" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
