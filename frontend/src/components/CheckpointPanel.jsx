import RiskBadge from "./RiskBadge";
import { formatLocal } from "../lib/risk";

export default function CheckpointPanel({
  route,
  selectedSeq,
  onSelect,
  timezone,
}) {
  const rows = route?.checkpoints || [];
  const selected = rows.find((c) => c.sequence === selectedSeq) || rows[0];

  if (!route) {
    return <p className="text-sm text-slate-500">Select a route to view checkpoints.</p>;
  }

  return (
    <div className="grid gap-3 lg:grid-cols-5">
      <div className="lg:col-span-3 overflow-auto rounded border border-slate-200 bg-white">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-2 py-2 font-medium">#</th>
              <th className="px-2 py-2 font-medium">mi</th>
              <th className="px-2 py-2 font-medium">ETA ({timezone || "local"})</th>
              <th className="px-2 py-2 font-medium">Wind</th>
              <th className="px-2 py-2 font-medium">Rain</th>
              <th className="px-2 py-2 font-medium">Snow</th>
              <th className="px-2 py-2 font-medium">Risk</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((cp) => (
              <tr
                key={cp.id || cp.sequence}
                className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${
                  selected?.sequence === cp.sequence ? "bg-blue-50" : ""
                }`}
                onClick={() => onSelect(cp.sequence)}
              >
                <td className="px-2 py-1.5">{cp.sequence}</td>
                <td className="px-2 py-1.5">{cp.distance_mi?.toFixed(1)}</td>
                <td className="px-2 py-1.5">{formatLocal(cp.eta_local || cp.eta_utc)}</td>
                <td className="px-2 py-1.5">
                  {cp.wind_mph != null ? `${cp.wind_mph.toFixed(0)} mph` : "—"}
                </td>
                <td className="px-2 py-1.5">
                  {cp.rain_in_hr != null ? cp.rain_in_hr.toFixed(2) : "—"}
                </td>
                <td className="px-2 py-1.5">
                  {cp.snow_in_hr != null ? cp.snow_in_hr.toFixed(2) : "—"}
                </td>
                <td className="px-2 py-1.5">
                  <RiskBadge level={cp.risk_level} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="lg:col-span-2 rounded border border-slate-200 bg-white p-3 text-sm">
        {selected ? (
          <>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold">Checkpoint {selected.sequence}</h3>
              <RiskBadge level={selected.risk_level} />
            </div>
            <p className="text-xs text-slate-600 mb-2">
              {selected.distance_mi?.toFixed(1)} mi · ETA {formatLocal(selected.eta_local)}
            </p>
            {selected.weather_status !== "ok" ? (
              <p className="text-xs text-slate-600">
                Weather unavailable: {selected.weather_reason || selected.risk_explanation}
              </p>
            ) : (
              <ul className="space-y-1 text-xs text-slate-700">
                {(selected.factors || []).map((f) => (
                  <li key={f.name}>
                    {f.name} {Number(f.value).toFixed(f.name === "Wind" ? 0 : 2)} {f.unit} ={" "}
                    {f.label}
                  </li>
                ))}
                {selected.load_note && (
                  <li className="font-medium text-slate-900">{selected.load_note}</li>
                )}
              </ul>
            )}
          </>
        ) : (
          <p className="text-slate-500 text-xs">No checkpoint selected.</p>
        )}
      </div>
    </div>
  );
}
