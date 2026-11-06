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
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      <input
        className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-primary"
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
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
      {open && results.length > 0 && (
        <ul className="mt-1 max-h-40 overflow-auto rounded border border-slate-200 bg-white text-sm shadow-sm">
          {results.map((r) => (
            <li key={r.id || `${r.lat},${r.lon}`}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left hover:bg-slate-50"
                onClick={() => {
                  onChange(r);
                  setQuery(r.name);
                  setOpen(false);
                }}
              >
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}
