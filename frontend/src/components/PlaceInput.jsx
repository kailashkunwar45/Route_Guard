import { useEffect, useRef, useState } from "react";
import { geocode, errorMessage } from "../lib/api";

export default function PlaceInput({ label, value, onChange, disabled }) {
  const [query, setQuery] = useState(value?.name || "");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const timer = useRef(null);

  useEffect(() => {
    setQuery(value?.name || "");
  }, [value?.name]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    // Skip search when the query already matches the selected place
    if (value?.name && query === value.name) {
      setResults([]);
      setOpen(false);
      return;
    }
    if (!query || query.length < 2) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        setErr("");
        const rows = await geocode(query);
        setResults(rows);
        setOpen(true);
      } catch (e) {
        setErr(errorMessage(e));
        setResults([]);
      }
    }, 300);
    return () => clearTimeout(timer.current);
  }, [query, value?.name]);

  return (
    <div className="relative text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      <div className="relative">
        <input
          className={`w-full rounded border bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-primary ${
            value ? "border-green-400 bg-green-50/20" : "border-slate-300"
          }`}
          value={query}
          disabled={disabled}
          placeholder="Start typing a city or address"
          onChange={(e) => {
            setQuery(e.target.value);
            onChange(null);
          }}
          onFocus={() => results.length && setOpen(true)}
          autoComplete="off"
        />
        {value && (
          <span className="absolute right-2.5 top-2.5 text-xs text-green-600 font-bold">
            ✓
          </span>
        )}
      </div>
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
      {open && results.length > 0 && (
        <ul className="absolute z-50 left-0 right-0 mt-1 max-h-48 overflow-auto rounded border border-slate-200 bg-white text-sm shadow-lg">
          {results.map((r) => (
            <li key={r.id || `${r.lat},${r.lon}`}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left hover:bg-blue-50 border-b border-slate-100 last:border-0"
                onClick={() => {
                  onChange(r);
                  setQuery(r.name);
                  setOpen(false);
                }}
              >
                <span className="font-medium text-slate-800">{r.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
