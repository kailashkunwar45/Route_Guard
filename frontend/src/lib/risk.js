export const RISK = {
  1: { name: "Low", color: "#1b9e77", key: "low" },
  2: { name: "Moderate", color: "#d95f02", key: "moderate" },
  3: { name: "High", color: "#7570b3", key: "high" },
  4: { name: "Severe", color: "#e7298a", key: "severe" },
  5: { name: "No Travel", color: "#000000", key: "notravel" },
};

export const UNKNOWN = { name: "Unavailable", color: "#9ca3af", key: "unknown" };

export function riskMeta(level) {
  if (level == null) return UNKNOWN;
  return RISK[level] || UNKNOWN;
}

export const ROUTE_COLORS = ["#2563eb", "#0d9488", "#c2410c"];

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h <= 0) return `${m} min`;
  return `${h} h ${m} min`;
}

export function formatLocal(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
