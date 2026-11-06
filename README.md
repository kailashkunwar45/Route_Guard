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
| `MAPBOX_SECRET_TOKEN` | backend | Server-only Mapbox token |
| `MAPBOX_PUBLIC_TOKEN` | backend | URL-restricted token exposed to the map |
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
- Map corridor + checkpoint layers; heatmap slider updates precomputed risk only (no network)

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

## Loom outline (~7 min)

1. Plan a Dallas → Austin route (load, interval, departure).
2. Compare up to 3 routes and read the recommendation explanation.
3. Map selection + checkpoint table / factor detail.
4. Heatmap slider 0–48 h (arrival vs selected hour).
5. Deliberate No Travel: heavy load + windy fixture window.
6. Code tour: `risk_engine.py` + `api/tests/test_risk_engine.py`.

## Deployment

- **Backend:** Render/Railway — set `DATABASE_URL` (Postgres), env vars above, `gunicorn config.wsgi`, run migrations.
- **Frontend:** Vercel/Netlify — build `frontend`, set API CORS origins to the deployed site.

Postgres credentials can be supplied at the end of the project; until then SQLite is used locally.
