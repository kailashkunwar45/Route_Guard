import { FlaskConical, Truck } from "lucide-react";

export function FixtureBanner({ show }) {
  if (!show) return null;
  return (
    <div className="flex items-center gap-2 rounded border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900">
      <FlaskConical size={14} className="shrink-0" />
      Fixture mode is on — responses use canned routes and weather, not live providers.
    </div>
  );
}

export function ProfileDisclaimer({ note }) {
  const text =
    note ||
    "Routing uses Mapbox driving (not truck-restricted: no height, weight, or hazmat constraints).";
  return (
    <div className="flex items-start gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
      <Truck size={14} className="mt-0.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

export function ErrorBanner({ message, onDismiss }) {
  if (!message) return null;
  return (
    <div className="flex items-start justify-between gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      <span>{message}</span>
      {onDismiss && (
        <button type="button" className="text-xs underline" onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </div>
  );
}

export function SkeletonBlock({ className = "" }) {
  return <div className={`animate-pulse rounded bg-slate-200 ${className}`} />;
}
