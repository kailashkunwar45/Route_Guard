"""Mapbox Geocoding via Django (server token)."""
from __future__ import annotations

from urllib.parse import quote

import requests
from django.conf import settings

from api.exceptions import ProviderError


def geocode_suggest(query: str, limit: int = 5) -> list[dict]:
    q = (query or "").strip()
    if len(q) < 2:
        return []

    if settings.USE_FIXTURES:
        return _fixture_suggest(q)

    token = settings.MAPBOX_SECRET_TOKEN or settings.MAPBOX_PUBLIC_TOKEN
    if not token:
        raise ProviderError(
            "Mapbox token not configured (set MAPBOX_PUBLIC_TOKEN or MAPBOX_SECRET_TOKEN)",
            status_code=502,
        )

    url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{quote(q)}.json"
    try:
        resp = requests.get(
            url,
            params={"access_token": token, "limit": limit, "types": "place,address,locality,region"},
            timeout=10,
        )
    except requests.Timeout as exc:
        raise ProviderError("Geocoding provider timed out", status_code=504) from exc
    except requests.RequestException as exc:
        raise ProviderError(f"Geocoding provider failure: {exc}", status_code=502) from exc

    if resp.status_code >= 400:
        raise ProviderError(f"Geocoding provider returned {resp.status_code}", status_code=502)

    features = resp.json().get("features") or []
    return [
        {
            "id": f.get("id"),
            "name": f.get("place_name"),
            "lon": f["center"][0],
            "lat": f["center"][1],
        }
        for f in features
        if f.get("center")
    ]


def _fixture_suggest(q: str) -> list[dict]:
    catalog = [
        {"id": "fix-dallas", "name": "Dallas, Texas, United States", "lon": -96.7970, "lat": 32.7767},
        {"id": "fix-austin", "name": "Austin, Texas, United States", "lon": -97.7431, "lat": 30.2672},
        {"id": "fix-houston", "name": "Houston, Texas, United States", "lon": -95.3698, "lat": 29.7604},
        {"id": "fix-okc", "name": "Oklahoma City, Oklahoma, United States", "lon": -97.5164, "lat": 35.4676},
        {"id": "fix-denver", "name": "Denver, Colorado, United States", "lon": -104.9903, "lat": 39.7392},
    ]
    ql = q.lower()
    return [c for c in catalog if ql in c["name"].lower()][:5]
