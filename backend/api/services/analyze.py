"""Compose routing → checkpoints → weather → risk → recommendation."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any

from django.conf import settings

from api.exceptions import ValidationBusinessError
from api.services import geo, routing, weather
from api.services.risk_engine import (
    NO_TRAVEL,
    build_checkpoints,
    compute_route_metrics,
    cumulative_distances_m,
    eta_at_distance,
    evaluate_checkpoint,
    recommend_routes,
    scale_distances_to_provider,
)


METERS_PER_MILE = 1609.344


def analyze_request(payload: dict) -> dict:
    origin = payload["origin"]  # {name, lat, lon}
    destination = payload["destination"]
    departure_local = payload["departure_local"]  # aware or naive datetime in origin local
    load_lb = int(payload["load_lb"])
    interval_mi = int(payload["checkpoint_interval_mi"])

    tz_name = geo.resolve_timezone(origin["lat"], origin["lon"])
    if departure_local.tzinfo is None:
        departure_utc = geo.local_to_utc(departure_local, tz_name)
    else:
        departure_utc = departure_local.astimezone(timezone.utc)

    now_utc = datetime.now(timezone.utc)
    if departure_utc < now_utc - timedelta(minutes=1):
        raise ValidationBusinessError("Departure time is in the past")

    max_dep = now_utc + timedelta(days=settings.FORECAST_MAX_DAYS)
    if departure_utc > max_dep:
        raise ValidationBusinessError(
            f"Departure is beyond the Open-Meteo forecast range ({settings.FORECAST_MAX_DAYS} days)"
        )

    routed = routing.fetch_routes(
        (origin["lat"], origin["lon"]),
        (destination["lat"], destination["lon"]),
    )
    raw_routes = routed["routes"]
    if not raw_routes:
        raise ValidationBusinessError("No routes found between origin and destination")

    # Build checkpoints + ETAs first (no weather yet)
    prepared = []
    max_eta = departure_utc
    for idx, rr in enumerate(raw_routes):
        coords = rr["coordinates"]
        cps = build_checkpoints(coords, rr["distance_m"], interval_mi)
        cum_raw = cumulative_distances_m(coords)
        cum_dist = scale_distances_to_provider(cum_raw, rr["distance_m"])

        approx = bool(rr.get("approximate_timing"))
        ann_d = rr.get("annotation_distances") or []
        ann_t = rr.get("annotation_durations") or []
        cum_dur = [0.0]
        if ann_d and ann_t and len(ann_d) == len(ann_t) and not approx:
            # annotations align with consecutive coordinate pairs
            # Rebuild cumulative duration along coordinate distances
            if len(ann_t) == len(coords) - 1:
                for t in ann_t:
                    cum_dur.append(cum_dur[-1] + float(t))
            else:
                approx = True
                cum_dur = [0.0]
        if approx or len(cum_dur) != len(cum_dist):
            approx = True
            cum_dur = [0.0]
            total = float(rr["duration_s"])
            for d in cum_dist[1:]:
                frac = d / cum_dist[-1] if cum_dist[-1] else 0
                cum_dur.append(total * frac)

        for cp in cps:
            offset_s, was_approx = eta_at_distance(
                cp["distance_m"], cum_dist, cum_dur, rr["duration_s"], approx
            )
            approx = approx or was_approx
            eta_utc = departure_utc + timedelta(seconds=offset_s)
            cp["eta_utc"] = eta_utc
            cp["eta_offset_s"] = offset_s
            if eta_utc > max_eta:
                max_eta = eta_utc

        prepared.append(
            {
                "index": idx,
                "label": rr["label"],
                "exclude_tag": rr.get("exclude_tag"),
                "coordinates": coords,
                "distance_m": rr["distance_m"],
                "distance_mi": rr["distance_m"] / METERS_PER_MILE,
                "duration_s": rr["duration_s"],
                "approximate_timing": approx,
                "checkpoints": cps,
            }
        )

    weather_end = max(departure_utc + timedelta(hours=48), max_eta) + timedelta(hours=1)
    points = []
    for pr in prepared:
        for cp in pr["checkpoints"]:
            points.append((cp["lat"], cp["lon"]))
    # unique rounded
    uniq = list({(weather.round_coord(lat), weather.round_coord(lon)): (lat, lon) for lat, lon in points}.values())

    with ThreadPoolExecutor(max_workers=1) as pool:
        # single batched call (already chunked inside); parallel reserved for future
        fut = pool.submit(weather.fetch_hourly_for_points, uniq, departure_utc, weather_end)
        series_map = fut.result()

    route_results = []
    for pr in prepared:
        cp_payloads = []
        levels: list = []
        blocking = []
        partial = False
        for cp in pr["checkpoints"]:
            key = (weather.round_coord(cp["lat"]), weather.round_coord(cp["lon"]))
            series = series_map.get(key)
            if not series:
                sample = {
                    "weather_status": "unavailable",
                    "reason": "Weather series missing for coordinate",
                    "wind_mph": None,
                    "wind_gust_mph": None,
                    "rain_in_hr": None,
                    "snow_in_hr": None,
                }
                risk_by_hour = [None] * 49
                hourly_raw = []
            else:
                sample = weather.sample_at_eta(series, cp["eta_utc"])
                risk_by_hour, hourly_raw = weather.hourly_risk_window(
                    series, departure_utc, load_lb, hours=48
                )

            risk = None
            level = None
            if sample.get("weather_status") == "ok":
                risk = evaluate_checkpoint(
                    sample["wind_mph"], sample["rain_in_hr"], sample["snow_in_hr"], load_lb
                )
                level = risk.level if risk else None
            else:
                partial = True

            if level == NO_TRAVEL and risk:
                blocking.append(
                    {
                        "sequence": cp["sequence"],
                        "lat": cp["lat"],
                        "lon": cp["lon"],
                        "distance_mi": cp["distance_mi"],
                        "reason": risk.explanation,
                    }
                )

            levels.append(level)
            cp_payloads.append(
                {
                    "sequence": cp["sequence"],
                    "lat": cp["lat"],
                    "lon": cp["lon"],
                    "distance_mi": round(cp["distance_mi"], 3),
                    "eta_utc": cp["eta_utc"].isoformat(),
                    "eta_local": geo.utc_to_local(cp["eta_utc"], tz_name).isoformat(),
                    "weather_status": sample.get("weather_status"),
                    "weather_reason": sample.get("reason"),
                    "wind_mph": sample.get("wind_mph"),
                    "wind_gust_mph": sample.get("wind_gust_mph"),
                    "rain_in_hr": sample.get("rain_in_hr"),
                    "snow_in_hr": sample.get("snow_in_hr"),
                    "risk_level": level,
                    "risk_name": risk.level_name if risk else None,
                    "risk_explanation": risk.explanation if risk else sample.get("reason"),
                    "factors": [
                        {
                            "name": f.name,
                            "value": f.value,
                            "unit": f.unit,
                            "level": f.level,
                            "label": f.label,
                        }
                        for f in (risk.factors if risk else [])
                    ],
                    "load_note": risk.load_note if risk else None,
                    "risk_by_hour": risk_by_hour,
                    "hourly_samples": [
                        {
                            "wind_mph": h.get("wind_mph"),
                            "rain_in_hr": h.get("rain_in_hr"),
                            "snow_in_hr": h.get("snow_in_hr"),
                            "status": h.get("weather_status"),
                            "reason": h.get("reason"),
                        }
                        for h in (hourly_raw[:49] if hourly_raw else [])
                    ],
                }
            )

        distances = [c["distance_mi"] for c in pr["checkpoints"]]
        metrics = compute_route_metrics(distances, levels, pr["duration_s"])
        route_results.append(
            {
                "id": pr["index"],  # temporary; replaced after save
                "label": pr["label"],
                "exclude_tag": pr["exclude_tag"],
                "coordinates": pr["coordinates"],
                "distance_mi": round(pr["distance_mi"], 3),
                "duration_s": pr["duration_s"],
                "approximate_timing": pr["approximate_timing"],
                "partial_weather": partial,
                "metrics": {
                    "low_mi": round(metrics.low_mi, 3),
                    "moderate_mi": round(metrics.moderate_mi, 3),
                    "high_mi": round(metrics.high_mi, 3),
                    "severe_mi": round(metrics.severe_mi, 3),
                    "no_travel_mi": round(metrics.no_travel_mi, 3),
                    "unknown_mi": round(metrics.unknown_mi, 3),
                    "total_mi": round(metrics.total_mi, 3),
                    "average_risk": round(metrics.average_risk, 3) if metrics.average_risk is not None else None,
                    "has_no_travel": metrics.has_no_travel,
                },
                "_metrics_obj": metrics,
                "checkpoints": cp_payloads,
                "blocking_checkpoints": blocking,
            }
        )

    rec_input = [
        {
            "id": r["id"],
            "label": r["label"],
            "distance_mi": r["distance_mi"],
            "metrics": r["_metrics_obj"],
            "blocking_checkpoints": r["blocking_checkpoints"],
        }
        for r in route_results
    ]
    fastest = min(r["duration_s"] for r in route_results)
    recommendation = recommend_routes(rec_input, fastest_duration_s=fastest)

    for r in route_results:
        r.pop("_metrics_obj", None)

    return {
        "origin": {**origin, "timezone": tz_name},
        "destination": destination,
        "departure_utc": departure_utc.isoformat(),
        "departure_local": geo.utc_to_local(departure_utc, tz_name).isoformat(),
        "timezone": tz_name,
        "load_lb": load_lb,
        "checkpoint_interval_mi": interval_mi,
        "profile_note": "Routing uses Mapbox driving (not truck-restricted: no height, weight, or hazmat constraints).",
        "provider_count_message": routed.get("provider_count_message"),
        "use_fixtures": settings.USE_FIXTURES,
        "routes": route_results,
        "recommendation": {
            "recommended_route_id": recommendation.recommended_route_id,
            "safe_available": recommendation.safe_available,
            "explanation": recommendation.explanation,
            "warning": recommendation.warning,
            "blocking": recommendation.blocking,
            "least_restricted_order": recommendation.least_restricted_order,
            "ranked_order": recommendation.ranked_order,
        },
    }
