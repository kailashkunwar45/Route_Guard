"""Open-Meteo hourly weather with batching, retries, and short cache."""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import requests
from django.conf import settings

from api.exceptions import ProviderError

_CACHE: dict[tuple, tuple[float, dict]] = {}


def _cache_get(key):
    item = _CACHE.get(key)
    if not item:
        return None
    expires, value = item
    if time.time() > expires:
        _CACHE.pop(key, None)
        return None
    return value


def _cache_set(key, value):
    _CACHE[key] = (time.time() + settings.OPEN_METEO_CACHE_MINUTES * 60, value)


def round_coord(x: float) -> float:
    return round(x, 2)


def fetch_hourly_for_points(
    points: list[tuple[float, float]],
    start_utc: datetime,
    end_utc: datetime,
) -> dict[tuple[float, float], dict]:
    """
    points: list of (lat, lon)
    returns map (lat,lon rounded) -> {times: [...], wind, rain, showers, snow, gusts}
    """
    if settings.USE_FIXTURES:
        return _fixture_weather(points, start_utc, end_utc)

    # chunk multi-location requests (Open-Meteo allows comma-separated)
    results: dict[tuple[float, float], dict] = {}
    chunk_size = 50
    for i in range(0, len(points), chunk_size):
        chunk = points[i : i + chunk_size]
        chunk_result = _fetch_chunk(chunk, start_utc, end_utc)
        results.update(chunk_result)
    return results


def _fetch_chunk(points, start_utc, end_utc):
    lats = ",".join(str(round_coord(p[0])) for p in points)
    lons = ",".join(str(round_coord(p[1])) for p in points)
    cache_key = (
        lats,
        lons,
        start_utc.strftime("%Y-%m-%dT%H"),
        end_utc.strftime("%Y-%m-%dT%H"),
    )
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    params = {
        "latitude": lats,
        "longitude": lons,
        "hourly": "wind_speed_10m,wind_gusts_10m,rain,showers,snowfall",
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
        "timezone": "GMT",
        "start_date": start_utc.strftime("%Y-%m-%d"),
        "end_date": end_utc.strftime("%Y-%m-%d"),
    }
    url = "https://api.open-meteo.com/v1/forecast"
    data = _request_with_retries(url, params)

    # Single point returns object; multi returns list
    payloads = data if isinstance(data, list) else [data]
    out = {}
    for p, payload in zip(points, payloads):
        hourly = payload.get("hourly") or {}
        key = (round_coord(p[0]), round_coord(p[1]))
        out[key] = {
            "times": hourly.get("time") or [],
            "wind_speed_10m": hourly.get("wind_speed_10m") or [],
            "wind_gusts_10m": hourly.get("wind_gusts_10m") or [],
            "rain": hourly.get("rain") or [],
            "showers": hourly.get("showers") or [],
            "snowfall": hourly.get("snowfall") or [],
        }
    _cache_set(cache_key, out)
    return out


def _request_with_retries(url, params):
    last_exc = None
    for attempt in range(3):
        try:
            resp = requests.get(url, params=params, timeout=settings.OPEN_METEO_TIMEOUT)
            if resp.status_code >= 500:
                raise ProviderError(f"Weather provider returned {resp.status_code}", status_code=502)
            if resp.status_code >= 400:
                raise ProviderError(f"Weather request rejected ({resp.status_code})", status_code=502)
            return resp.json()
        except requests.Timeout as exc:
            last_exc = ProviderError("Weather provider timed out", status_code=504)
            time.sleep(0.5 * (2**attempt))
        except requests.RequestException as exc:
            last_exc = ProviderError(f"Weather provider failure: {exc}", status_code=502)
            time.sleep(0.5 * (2**attempt))
        except ProviderError as exc:
            last_exc = exc
            if exc.status_code == 504 or "returned 5" in exc.message:
                time.sleep(0.5 * (2**attempt))
                continue
            raise
    raise last_exc


def sample_at_eta(series: dict, eta_utc: datetime) -> dict:
    """Nearest hourly slot to ETA. Documented in README."""
    times = series.get("times") or []
    if not times:
        return {
            "weather_status": "unavailable",
            "reason": "No hourly weather returned",
            "wind_mph": None,
            "wind_gust_mph": None,
            "rain_in_hr": None,
            "snow_in_hr": None,
            "hour_index": None,
        }

    # parse times as UTC
    parsed = []
    for t in times:
        parsed.append(datetime.fromisoformat(t.replace("Z", "+00:00")).replace(tzinfo=timezone.utc))

    if eta_utc.tzinfo is None:
        eta_utc = eta_utc.replace(tzinfo=timezone.utc)

    # beyond forecast?
    if eta_utc > parsed[-1] + timedelta(minutes=30):
        return {
            "weather_status": "unavailable",
            "reason": "ETA beyond forecast horizon",
            "wind_mph": None,
            "wind_gust_mph": None,
            "rain_in_hr": None,
            "snow_in_hr": None,
            "hour_index": None,
        }

    best_i = min(range(len(parsed)), key=lambda i: abs((parsed[i] - eta_utc).total_seconds()))
    wind = _at(series["wind_speed_10m"], best_i)
    gust = _at(series["wind_gusts_10m"], best_i)
    rain = _at(series["rain"], best_i)
    showers = _at(series["showers"], best_i)
    snow = _at(series["snowfall"], best_i)

    if wind is None or rain is None or showers is None or snow is None:
        return {
            "weather_status": "unavailable",
            "reason": "Null weather value at nearest hour",
            "wind_mph": wind,
            "wind_gust_mph": gust,
            "rain_in_hr": None if rain is None or showers is None else rain + showers,
            "snow_in_hr": snow,
            "hour_index": best_i,
        }

    return {
        "weather_status": "ok",
        "reason": None,
        "wind_mph": float(wind),
        "wind_gust_mph": float(gust) if gust is not None else None,
        "rain_in_hr": float(rain) + float(showers),
        "snow_in_hr": float(snow),
        "hour_index": best_i,
        "hour_time": parsed[best_i].isoformat(),
    }


def hourly_risk_window(
    series: dict,
    departure_utc: datetime,
    load_lb: int,
    hours: int = 48,
):
    """Precompute risk for hour 0..hours relative to departure."""
    from api.services.risk_engine import evaluate_checkpoint

    out = []
    raw = []
    for h in range(hours + 1):
        eta = departure_utc + timedelta(hours=h)
        sample = sample_at_eta(series, eta)
        raw.append(sample)
        if sample["weather_status"] != "ok":
            out.append(None)
        else:
            risk = evaluate_checkpoint(
                sample["wind_mph"], sample["rain_in_hr"], sample["snow_in_hr"], load_lb
            )
            out.append(risk.level if risk else None)
    return out, raw


def _at(arr, i):
    if i is None or i < 0 or i >= len(arr):
        return None
    return arr[i]


def _fixture_weather(points, start_utc, end_utc):
    out = {}
    # Build hourly series covering window
    hours = int((end_utc - start_utc).total_seconds() // 3600) + 3
    times = [(start_utc + timedelta(hours=i)).strftime("%Y-%m-%dT%H:00") for i in range(max(hours, 50))]
    for idx, p in enumerate(points):
        key = (round_coord(p[0]), round_coord(p[1]))
        # Vary weather along the corridor; some mid-route points are windy
        base_wind = 18 + (idx % 7) * 3
        winds, gusts, rains, showers, snows = [], [], [], [], []
        lat, lon = p[0], p[1]
        # Mid-corridor band between Dallas (~32.8) and Austin (~30.3)
        mid_corridor = 30.9 < lat < 32.2
        for i, _ in enumerate(times):
            w = base_wind
            # Hours 1-4: mid-corridor = No Travel wind (any load) for Loom demos
            if mid_corridor and 1 <= i <= 4:
                w = 58
            elif 10 <= i <= 14 and idx % 3 == 1:
                w = min(54, base_wind + 22)  # Severe band for heatmap slider demos
            winds.append(w)
            gusts.append(w + 8)
            rains.append(0.02 if i % 6 else 0.0)
            showers.append(0.0)
            snows.append(0.0)
        out[key] = {
            "times": times,
            "wind_speed_10m": winds,
            "wind_gusts_10m": gusts,
            "rain": rains,
            "showers": showers,
            "snowfall": snows,
        }
    return out
