# RouteGuard

Map-first React + Django app that helps a truck driver compare routes by weather risk, load weight, and travel time.

## Stack

- **Frontend:** React (Vite, JSX), Tailwind, Axios, Lucide, Mapbox GL JS, React Router
- **Backend:** Django, Django REST Framework, Django ORM
- **Database:** SQLite locally; PostgreSQL in production via `DATABASE_URL`
- **Providers:** Mapbox (geocoding + directions), Open-Meteo (hourly weather)

## Setup

### Backend

```bash
cd backend
python -m venv venv
# Windows:
venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
python manage.py migrate
python manage.py runserver
```

Set `USE_FIXTURES=true` in `backend/.env` to run without live Mapbox/Open-Meteo keys.

### Frontend

```bash
cd frontend
npm install
copy .env.example .env
npm run dev
```

Open http://localhost:5173 — Vite proxies `/api` to Django on port 8000.

### Tests

```bash
cd backend
venv\Scripts\python -m pytest api\tests -q
```

## Environment variables

| Variable | Where | Purpose |
|----------|--------|---------|
| `DJANGO_SECRET_KEY` | backend | Django secret |
| `DEBUG` | backend | Debug mode |
| `ALLOWED_HOSTS` | backend | Host allowlist |
| `CORS_ALLOWED_ORIGINS` | backend | Frontend origins |
| `DATABASE_URL` | backend | Postgres URL (omit for SQLite) |
| `MAPBOX_SECRET_TOKEN` | backend | Optional `sk.` token for server APIs |
| `MAPBOX_PUBLIC_TOKEN` | backend | URL-restricted `pk.` token for the map; also used for Geocoding/Directions if no `sk.` is set |
| `VITE_MAPBOX_PUBLIC_TOKEN` | frontend | Same `pk.` token for Mapbox GL JS (never put an `sk.` here) |
| `USE_FIXTURES` | backend | Honest fixture providers (no live network) |
| `VITE_API_BASE` | frontend | Optional API base (default `/api`) |

## APIs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health/` | Health + fixture flag |
| GET | `/api/config/` | Public Mapbox token for the map |
| GET | `/api/geocode/?q=` | Place autocomplete |
| POST | `/api/routes/analyze/` | Full analysis (routes, weather, risk, recommendation) |
| GET | `/api/routes/` | Recent analyses |
| GET | `/api/routes/{id}/` | Reload one analysis (includes `risk_by_hour`) |

Status codes: `400` validation, `422` unusable input, `502` provider failure, `504` timeout.

## Architecture

```
Planner form → POST analyze
  → Mapbox directions (+ exclude variants, geometry dedupe)
  → polyline checkpoints + annotation-based ETAs
  → Open-Meteo hourly (rain + showers; batched; cached)
  → risk_engine (pure Python) + metrics + ranking
  → persist RouteSearch / Route / Checkpoint / WeatherSample
  → payload with risk_by_hour[0..48] for the heatmap slider
```

Logic lives in `api/services/` (`risk_engine`, `routing`, `weather`, `analyze`, …). Views stay thin.

## Features

- Origin-local departure time (timezonefinder + zoneinfo), UTC storage
- Up to 3 distinct routes; truthful labels when using avoid-variants; never fabricates routes
- Checkpoint risk from wind / rain / snow / load rules
- Recommendation by lexicographic ranking (severe mi → high mi → avg risk → duration)
- Map corridor + checkpoint **circle layers** (not DOM markers); click syncs with the table
- Heatmap tab: Mapbox heatmap + risk-colored corridor `line-gradient` + circles on top
- Heatmap slider reads `risk_by_hour[0..48]` only — `requestAnimationFrame`, no network, no map recreate
- History list reopens saved analyses at `/analysis/:id`
- Honest fixture banner when `USE_FIXTURES=true`

## Map & heatmap performance notes

- Map chunk is lazy-loaded (`React.lazy`)
- Route/selection changes update GeoJSON sources in place
- Hour slider updates are coalesced with `requestAnimationFrame`
- Corridor uses `lineMetrics: true` so `line-gradient` can paint segment risk by distance
- `ResizeObserver` keeps the map sized on panel layout changes

## Assumptions

- Mapbox `driving` profile is used (not truck-restricted).
- Risk table boundaries use inclusive lower / exclusive upper bounds, except “above X” / `>X` = No Travel with `X` itself Severe where the table says so.
- Segment risk = max of the two endpoint checkpoint risks (conservative).
- Weather for a checkpoint uses the **nearest hourly slot** to its ETA.
- Liquid precipitation = Open-Meteo `rain` + `showers` (in/hr).
- Snowfall inches from Open-Meteo are treated as snow depth per hour for the spec thresholds.
- When Mapbox returns fewer than 3 distinct geometries, the UI shows what came back and a provider count message.
- Local default DB is SQLite; set `DATABASE_URL` when you have Postgres credentials.

## Known limitations

- Non-truck Mapbox profile: no height, weight, or hazmat routing constraints.
- Open-Meteo forecast horizon (~14 days); departures beyond that are rejected.
- Heatmap is **checkpoint-based** weather risk — values are not interpolated between checkpoints.
- Fixture mode is for development/demo; it is labeled in the UI and must not be presented as live data.

## Loom outline (~7–8 min)

Use **live Mapbox** if tokens are set; otherwise say clearly you are in fixture mode.

1. **Plan (≈1 min)** — Dallas → Austin, departure in origin local time, load e.g. 20,000 lb, interval 25 mi. Submit and wait for cards + map fit-bounds.
2. **Compare (≈1.5 min)** — Click each route card; show stacked risk-mile bar, badges, recommendation explanation (severe/high miles + time cost). Mention truck-profile disclaimer.
3. **Map + checkpoints (≈1.5 min)** — Click a line and a checkpoint circle; show popup weather/ETA; open Checkpoints tab and the factor/load detail panel.
4. **Heatmap slider (≈1.5 min)** — Switch to Heatmap; toggle “At expected arrival” vs “At selected hour”; drag 0–48 and point at corridor + legend (checkpoint-based, not interpolated).
5. **No Travel (≈1 min)** — Re-run with heavy load (e.g. 50,000 lb) and/or windy window; show “No safe route…” warning, blocking checkpoints, least-restricted order wording.
6. **Code tour (≈1.5 min)** — `backend/api/services/risk_engine.py` boundaries + load rules; `api/tests/test_risk_engine.py` table-driven cases; mention `risk_by_hour` precompute in analyze payload.

## Deployment

- **Backend:** Render/Railway — set `DATABASE_URL` (Postgres), env vars above, `gunicorn config.wsgi`, run migrations. `Procfile` is included under `backend/`.
- **Frontend:** Vercel/Netlify — build `frontend`, point API to the backend, set `CORS_ALLOWED_ORIGINS` to the deployed site.

Local default is SQLite. Add Postgres credentials at deploy time via `DATABASE_URL`.
