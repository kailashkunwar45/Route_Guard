import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import PlaceInput from "./PlaceInput";

function defaultDepartureLocal() {
  const d = new Date();
  d.setHours(d.getHours() + 2);
  d.setMinutes(0, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function PlannerForm({ onSubmit, loading }) {
  const [origin, setOrigin] = useState(null);
  const [destination, setDestination] = useState(null);
  const [departure, setDeparture] = useState(defaultDepartureLocal);
  const [loadLb, setLoadLb] = useState(20000);
  const [interval, setIntervalMi] = useState(25);
  const [formError, setFormError] = useState("");

  const canSubmit = useMemo(
    () => origin && destination && departure && !loading,
    [origin, destination, departure, loading]
  );

  function handleSubmit(e) {
    e.preventDefault();
    setFormError("");
    if (!origin || !destination) {
      setFormError("Select origin and destination from suggestions.");
      return;
    }
    const load = Number(loadLb);
    if (!Number.isInteger(load) || load < 0 || load > 80000) {
      setFormError("Load must be an integer from 0 to 80,000 lb.");
      return;
    }
    onSubmit({
      origin: { name: origin.name, lat: origin.lat, lon: origin.lon },
      destination: { name: destination.name, lat: destination.lat, lon: destination.lon },
      departure_local: departure,
      load_lb: load,
      checkpoint_interval_mi: Number(interval),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <PlaceInput label="Origin" value={origin} onChange={setOrigin} disabled={loading} />
      <PlaceInput
        label="Destination"
        value={destination}
        onChange={setDestination}
        disabled={loading}
      />
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">
          Departure (origin local time)
        </span>
        <input
          type="datetime-local"
          className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-primary"
          value={departure}
          disabled={loading}
          onChange={(e) => setDeparture(e.target.value)}
          required
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">Load weight (lb)</span>
        <input
          type="number"
          min={0}
          max={80000}
          step={1}
          className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-primary"
          value={loadLb}
          disabled={loading}
          onChange={(e) => setLoadLb(e.target.value)}
          required
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-700">Checkpoint interval</span>
        <select
          className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-primary"
          value={interval}
          disabled={loading}
          onChange={(e) => setIntervalMi(e.target.value)}
        >
          <option value={10}>10 miles</option>
          <option value={25}>25 miles</option>
          <option value={50}>50 miles</option>
        </select>
      </label>
      {formError && <p className="text-xs text-red-600 font-medium">{formError}</p>}
      {!origin || !destination ? (
        <p className="text-[11px] text-slate-500 italic">
          💡 Select both origin and destination from the suggestions dropdown to enable route analysis.
        </p>
      ) : null}
      <button
        type="submit"
        disabled={!canSubmit}
        className="inline-flex w-full items-center justify-center gap-2 rounded bg-primary px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition-colors hover:bg-primary/90"
      >
        {loading && <Loader2 className="animate-spin" size={16} />}
        {loading ? "Analyzing routes & weather (takes ~10s)…" : "Analyze routes"}
      </button>
      {loading && (
        <p className="text-center text-xs text-slate-500 animate-pulse">
          Fetching alternative corridors and evaluating checkpoint wind & rain risk...
        </p>
      )}
    </form>
  );
}
