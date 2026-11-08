"""Mapbox Directions with alternatives + exclude fallbacks."""
from __future__ import annotations

import requests
from django.conf import settings

from api.exceptions import ProviderError
from api.services.risk_engine import dedupe_routes


EXCLUDE_VARIANTS = [
    ("toll", "Avoids tolls"),
    ("motorway", "Avoids motorways"),
    ("ferry", "Avoids ferries"),
]


def fetch_routes(origin: tuple[float, float], destination: tuple[float, float]) -> dict:
    """
    Returns {routes: [...], provider_count_message: str|None}
    Each route: label, coordinates, distance_m, duration_s, annotation_distances,
                annotation_durations, approximate_timing, exclude_tag
    """
    if settings.USE_FIXTURES:
        return _fixture_routes(origin, destination)

    token = settings.MAPBOX_SECRET_TOKEN or settings.MAPBOX_PUBLIC_TOKEN
    if not token:
        raise ProviderError(
            "Mapbox token not configured (set MAPBOX_PUBLIC_TOKEN or MAPBOX_SECRET_TOKEN)",
            status_code=502,
        )

    collected = []
    collected.extend(_request_directions(origin, destination, token, exclude=None, label_prefix="Route"))

    for exclude, label in EXCLUDE_VARIANTS:
        if len(dedupe_routes(collected)) >= 3:
            break
        variants = _request_directions(
            origin, destination, token, exclude=exclude, label_prefix=label
        )
        for v in variants:
            v["label"] = label
            v["exclude_tag"] = exclude
        collected.extend(variants)

    unique = dedupe_routes(collected)[:3]
    for i, r in enumerate(unique):
        if not r.get("exclude_tag"):
            r["label"] = f"Route {chr(ord('A') + i)}"
        else:
            # keep truthful avoid label; append letter if needed
            r["label"] = r["label"]

    msg = None
    if len(unique) < 3:
        msg = f"Provider returned {len(unique)} distinct routes"

    return {"routes": unique, "provider_count_message": msg}


def _request_directions(origin, destination, token, exclude=None, label_prefix="Route"):
    olon, olat = origin[1], origin[0]  # wait - we pass (lat, lon)
    # Convention: origin = (lat, lon)
    lat1, lon1 = origin
    lat2, lon2 = destination
    coords = f"{lon1},{lat1};{lon2},{lat2}"
    url = f"https://api.mapbox.com/directions/v5/mapbox/driving/{coords}"
    params = {
        "access_token": token,
        "alternatives": "true",
        "geometries": "geojson",
        "overview": "full",
        "annotations": "duration,distance",
    }
    if exclude:
        params["exclude"] = exclude
        params["alternatives"] = "false"

    try:
        resp = requests.get(url, params=params, timeout=15)
    except requests.Timeout as exc:
        raise ProviderError("Directions provider timed out", status_code=504) from exc
    except requests.RequestException as exc:
        raise ProviderError(f"Directions provider failure: {exc}", status_code=502) from exc

    if resp.status_code >= 400:
        raise ProviderError(f"Directions provider returned {resp.status_code}", status_code=502)

    data = resp.json()
    routes = data.get("routes") or []
    out = []
    for i, route in enumerate(routes):
        geometry = route.get("geometry") or {}
        coordinates = geometry.get("coordinates") or []
        legs = route.get("legs") or []
        ann_dist, ann_dur = [], []
        approximate = False
        for leg in legs:
            annotation = leg.get("annotation") or {}
            d = annotation.get("distance")
            t = annotation.get("duration")
            if d is None or t is None:
                approximate = True
            else:
                ann_dist.extend(d)
                ann_dur.extend(t)
        out.append(
            {
                "label": f"{label_prefix} {chr(ord('A') + i)}" if not exclude else label_prefix,
                "coordinates": coordinates,
                "distance_m": float(route.get("distance") or 0),
                "duration_s": float(route.get("duration") or 0),
                "annotation_distances": ann_dist,
                "annotation_durations": ann_dur,
                "approximate_timing": approximate,
                "exclude_tag": exclude,
            }
        )
    return out


def _fixture_routes(origin, destination):
    lat1, lon1 = origin
    lat2, lon2 = destination
    # Three synthetic polylines with shared endpoints
    def lerp_line(wiggle=0.0, n=40):
        coords = []
        for i in range(n + 1):
            t = i / n
            lon = lon1 + (lon2 - lon1) * t
            lat = lat1 + (lat2 - lat1) * t + wiggle * (4 * t * (1 - t))
            coords.append([lon, lat])
        return coords

    routes_raw = [
        {"label": "Route A", "coordinates": lerp_line(0.0), "duration_s": 14400, "exclude_tag": None},
        {"label": "Route B", "coordinates": lerp_line(0.35), "duration_s": 16200, "exclude_tag": None},
        {"label": "Avoids motorways", "coordinates": lerp_line(-0.4), "duration_s": 18000, "exclude_tag": "motorway"},
    ]
    out = []
    for r in routes_raw:
        coords = r["coordinates"]
        # rough distance from haversine chain
        from api.services.risk_engine import cumulative_distances_m

        cum = cumulative_distances_m(coords)
        dist = cum[-1] if cum else 0
        nseg = max(1, len(coords) - 1)
        seg_d = [dist / nseg] * nseg
        # uneven durations: slower in middle third
        seg_t = []
        for i in range(nseg):
            frac = i / nseg
            weight = 1.5 if 0.3 < frac < 0.7 else 0.75
            seg_t.append(weight)
        total_w = sum(seg_t)
        seg_t = [r["duration_s"] * w / total_w for w in seg_t]
        out.append(
            {
                "label": r["label"],
                "coordinates": coords,
                "distance_m": dist,
                "duration_s": r["duration_s"],
                "annotation_distances": seg_d,
                "annotation_durations": seg_t,
                "approximate_timing": False,
                "exclude_tag": r["exclude_tag"],
            }
        )
    return {"routes": out, "provider_count_message": None}
