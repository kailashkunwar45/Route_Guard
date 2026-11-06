"""Pure risk / metrics / ranking engine. No Django imports."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


LOW = 1
MODERATE = 2
HIGH = 3
SEVERE = 4
NO_TRAVEL = 5

LEVEL_NAMES = {
    LOW: "Low",
    MODERATE: "Moderate",
    HIGH: "High",
    SEVERE: "Severe",
    NO_TRAVEL: "No Travel",
}


def wind_level(mph: float) -> int:
    if mph < 25:
        return LOW
    if mph < 35:
        return MODERATE
    if mph < 45:
        return HIGH
    if mph < 55:
        return SEVERE
    return NO_TRAVEL


def rain_level(inches_per_hr: float) -> int:
    if inches_per_hr < 0.10:
        return LOW
    if inches_per_hr < 0.25:
        return MODERATE
    if inches_per_hr < 0.50:
        return HIGH
    if inches_per_hr <= 1.00:
        return SEVERE
    return NO_TRAVEL


def snow_level(inches_per_hr: float) -> int:
    if inches_per_hr < 0.5:
        return LOW
    if inches_per_hr < 1.0:
        return MODERATE
    if inches_per_hr < 2.0:
        return HIGH
    if inches_per_hr <= 3.0:
        return SEVERE
    return NO_TRAVEL


def apply_load_adjustment(wind_mph: float, load_lb: int, base_level: int) -> tuple[int, Optional[str]]:
    """Raise risk for heavy loads in high wind. Never lowers risk."""
    note = None
    level = base_level
    if wind_mph >= 55:
        if level < NO_TRAVEL:
            level = NO_TRAVEL
            note = f"{load_lb:,} lb load: wind >= 55 mph = No Travel for any load"
        else:
            note = f"wind >= 55 mph = No Travel for any load"
    elif 45 <= wind_mph < 55 and load_lb > 30_000:
        if level < NO_TRAVEL:
            level = NO_TRAVEL
            note = f"{load_lb:,} lb load raises to No Travel (wind in [45,55))"
    elif 35 <= wind_mph < 45 and load_lb > 40_000:
        if level < SEVERE:
            level = SEVERE
            note = f"{load_lb:,} lb load raises to Severe (wind in [35,45))"
    return level, note


@dataclass
class FactorDetail:
    name: str
    value: float
    unit: str
    level: int
    label: str


@dataclass
class CheckpointRisk:
    level: int
    level_name: str
    factors: list[FactorDetail] = field(default_factory=list)
    load_note: Optional[str] = None
    explanation: str = ""


def evaluate_checkpoint(
    wind_mph: Optional[float],
    rain_in_hr: Optional[float],
    snow_in_hr: Optional[float],
    load_lb: int,
) -> Optional[CheckpointRisk]:
    """Return risk for a checkpoint. None means weather unavailable."""
    if wind_mph is None or rain_in_hr is None or snow_in_hr is None:
        return None

    w = wind_level(wind_mph)
    r = rain_level(rain_in_hr)
    s = snow_level(snow_in_hr)
    weather_max = max(w, r, s)
    adjusted, load_note = apply_load_adjustment(wind_mph, load_lb, weather_max)
    final = max(weather_max, adjusted)

    factors = [
        FactorDetail("Wind", wind_mph, "mph", w, LEVEL_NAMES[w]),
        FactorDetail("Rain", rain_in_hr, "in/hr", r, LEVEL_NAMES[r]),
        FactorDetail("Snow", snow_in_hr, "in/hr", s, LEVEL_NAMES[s]),
    ]
    parts = [f"{f.name} {f.value:g} {f.unit} = {f.label}" for f in factors]
    if load_note:
        parts.append(load_note)
    explanation = "; ".join(parts)

    return CheckpointRisk(
        level=final,
        level_name=LEVEL_NAMES[final],
        factors=factors,
        load_note=load_note,
        explanation=explanation,
    )


@dataclass
class RouteMetrics:
    low_mi: float = 0.0
    moderate_mi: float = 0.0
    high_mi: float = 0.0
    severe_mi: float = 0.0
    no_travel_mi: float = 0.0
    unknown_mi: float = 0.0
    total_mi: float = 0.0
    average_risk: Optional[float] = None
    has_no_travel: bool = False
    duration_s: float = 0.0


def _bucket_for(level: int) -> str:
    return {
        LOW: "low_mi",
        MODERATE: "moderate_mi",
        HIGH: "high_mi",
        SEVERE: "severe_mi",
        NO_TRAVEL: "no_travel_mi",
    }[level]


def compute_route_metrics(
    checkpoint_distances_mi: list[float],
    checkpoint_levels: list[Optional[int]],
    duration_s: float,
) -> RouteMetrics:
    """
    Segment risk = max of its two endpoint levels (conservative).
    Unavailable endpoint => unknown miles (excluded from average).
    """
    if len(checkpoint_distances_mi) != len(checkpoint_levels):
        raise ValueError("distances and levels length mismatch")
    if len(checkpoint_distances_mi) < 1:
        raise ValueError("need at least one checkpoint")

    metrics = RouteMetrics(duration_s=duration_s)
    if len(checkpoint_distances_mi) == 1:
        metrics.total_mi = float(checkpoint_distances_mi[0])
        metrics.average_risk = None
        return metrics

    weighted = 0.0
    known_mi = 0.0

    for i in range(len(checkpoint_distances_mi) - 1):
        seg_mi = float(checkpoint_distances_mi[i + 1] - checkpoint_distances_mi[i])
        if seg_mi < 0:
            raise ValueError("checkpoint distances must be non-decreasing")
        a = checkpoint_levels[i]
        b = checkpoint_levels[i + 1]
        metrics.total_mi += seg_mi
        if a is None or b is None:
            metrics.unknown_mi += seg_mi
            continue
        level = max(a, b)
        setattr(metrics, _bucket_for(level), getattr(metrics, _bucket_for(level)) + seg_mi)
        weighted += level * seg_mi
        known_mi += seg_mi
        if level == NO_TRAVEL:
            metrics.has_no_travel = True

    # Floating tolerance for sum check
    summed = (
        metrics.low_mi
        + metrics.moderate_mi
        + metrics.high_mi
        + metrics.severe_mi
        + metrics.no_travel_mi
        + metrics.unknown_mi
    )
    if abs(summed - metrics.total_mi) > 1e-6:
        raise AssertionError(f"miles do not sum: {summed} vs {metrics.total_mi}")

    metrics.average_risk = (weighted / known_mi) if known_mi > 0 else None
    return metrics


def ranking_key(metrics: RouteMetrics, distance_mi: float) -> tuple:
    """Lexicographic ascending: severe, high, avg risk, duration; distance tiebreak."""
    avg = metrics.average_risk if metrics.average_risk is not None else 99.0
    return (
        metrics.severe_mi,
        metrics.high_mi,
        avg,
        metrics.duration_s,
        distance_mi,
    )


def least_restricted_key(metrics: RouteMetrics, distance_mi: float) -> tuple:
    return (
        metrics.no_travel_mi,
        metrics.severe_mi,
        metrics.high_mi,
        metrics.average_risk if metrics.average_risk is not None else 99.0,
        metrics.duration_s,
        distance_mi,
    )


@dataclass
class Recommendation:
    recommended_route_id: Optional[Any]
    safe_available: bool
    explanation: str
    warning: Optional[str] = None
    blocking: list[dict] = field(default_factory=list)
    least_restricted_order: list[Any] = field(default_factory=list)
    ranked_order: list[Any] = field(default_factory=list)


def recommend_routes(
    routes: list[dict],
    fastest_duration_s: Optional[float] = None,
) -> Recommendation:
    """
    routes: list of dicts with keys:
      id, label, metrics (RouteMetrics), distance_mi, blocking_checkpoints (optional)
    """
    if not routes:
        return Recommendation(
            recommended_route_id=None,
            safe_available=False,
            explanation="No routes available.",
            warning="No safe route available for this departure time",
        )

    ranked = sorted(routes, key=lambda r: ranking_key(r["metrics"], r["distance_mi"]))
    ranked_ids = [r["id"] for r in ranked]
    safe = [r for r in ranked if not r["metrics"].has_no_travel]

    least = sorted(routes, key=lambda r: least_restricted_key(r["metrics"], r["distance_mi"]))
    least_ids = [r["id"] for r in least]

    if fastest_duration_s is None:
        fastest_duration_s = min(r["metrics"].duration_s for r in routes)

    if not safe:
        blocking = []
        for r in routes:
            for b in r.get("blocking_checkpoints") or []:
                blocking.append({"route_id": r["id"], "route_label": r.get("label"), **b})
        return Recommendation(
            recommended_route_id=None,
            safe_available=False,
            explanation="Every route includes No Travel conditions for this departure.",
            warning="No safe route available for this departure time",
            blocking=blocking,
            least_restricted_order=least_ids,
            ranked_order=ranked_ids,
        )

    best = safe[0]
    others = [r for r in ranked if r["id"] != best["id"]]
    parts = [f"{best.get('label', best['id'])} ranked best"]
    if others:
        rival = others[0]
        bm, rm = best["metrics"], rival["metrics"]
        parts.append(
            f"{best.get('label', best['id'])}: {bm.severe_mi:.1f} severe miles "
            f"vs {rm.severe_mi:.1f} on {rival.get('label', rival['id'])}"
        )
        if bm.high_mi != rm.high_mi:
            parts.append(
                f"high miles {bm.high_mi:.1f} vs {rm.high_mi:.1f}"
            )
    delta_s = best["metrics"].duration_s - fastest_duration_s
    if abs(delta_s) >= 30:
        sign = "+" if delta_s > 0 else ""
        parts.append(f"{sign}{int(round(delta_s / 60))} min vs the fastest route")
    else:
        parts.append("matches or nearly matches the fastest route on time")

    return Recommendation(
        recommended_route_id=best["id"],
        safe_available=True,
        explanation=". ".join(parts) + ".",
        least_restricted_order=least_ids,
        ranked_order=ranked_ids,
    )


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    from math import radians, sin, cos, asin, sqrt

    r = 6371000.0
    p1, p2 = radians(lat1), radians(lat2)
    dphi = radians(lat2 - lat1)
    dlmb = radians(lon2 - lon1)
    a = sin(dphi / 2) ** 2 + cos(p1) * cos(p2) * sin(dlmb / 2) ** 2
    return 2 * r * asin(sqrt(a))


def cumulative_distances_m(coords: list[list[float]]) -> list[float]:
    """coords as [lon, lat] GeoJSON order."""
    if not coords:
        return []
    out = [0.0]
    for i in range(1, len(coords)):
        lon1, lat1 = coords[i - 1]
        lon2, lat2 = coords[i]
        out.append(out[-1] + haversine_m(lat1, lon1, lat2, lon2))
    return out


def scale_distances_to_provider(cum_m: list[float], provider_distance_m: float) -> list[float]:
    if not cum_m:
        return []
    total = cum_m[-1]
    if total <= 0:
        return [0.0 for _ in cum_m]
    scale = provider_distance_m / total
    return [d * scale for d in cum_m]


def build_checkpoints(
    coords: list[list[float]],
    provider_distance_m: float,
    interval_mi: float,
) -> list[dict]:
    """Origin, every N miles along polyline, destination. Distances in miles."""
    METERS_PER_MILE = 1609.344
    cum = scale_distances_to_provider(cumulative_distances_m(coords), provider_distance_m)
    total_mi = provider_distance_m / METERS_PER_MILE
    if not coords:
        return []

    targets = [0.0]
    if interval_mi > 0:
        n = 1
        while n * interval_mi < total_mi - 1e-6:
            targets.append(n * interval_mi)
            n += 1
    if total_mi > 0 and (not targets or abs(targets[-1] - total_mi) > 1e-6):
        targets.append(total_mi)
    elif total_mi == 0:
        targets = [0.0]

    checkpoints = []
    for seq, target_mi in enumerate(targets):
        target_m = target_mi * METERS_PER_MILE
        # find segment containing target_m
        idx = 0
        while idx < len(cum) - 1 and cum[idx + 1] < target_m:
            idx += 1
        if idx >= len(cum) - 1:
            lon, lat = coords[-1]
        else:
            d0, d1 = cum[idx], cum[idx + 1]
            if d1 - d0 < 1e-9:
                t = 0.0
            else:
                t = (target_m - d0) / (d1 - d0)
            lon = coords[idx][0] + t * (coords[idx + 1][0] - coords[idx][0])
            lat = coords[idx][1] + t * (coords[idx + 1][1] - coords[idx][1])
        checkpoints.append(
            {
                "sequence": seq,
                "lat": lat,
                "lon": lon,
                "distance_mi": target_mi,
                "distance_m": target_m,
            }
        )
    return checkpoints


def eta_at_distance(
    target_m: float,
    cum_dist_m: list[float],
    cum_duration_s: list[float],
    route_duration_s: float,
    approximate: bool,
) -> tuple[float, bool]:
    """Interpolate ETA offset seconds from departure along annotated segments."""
    if not cum_dist_m or cum_dist_m[-1] <= 0:
        return 0.0, approximate
    if approximate or len(cum_duration_s) != len(cum_dist_m):
        frac = min(1.0, max(0.0, target_m / cum_dist_m[-1]))
        return route_duration_s * frac, True

    if target_m <= 0:
        return 0.0, False
    if target_m >= cum_dist_m[-1]:
        return cum_duration_s[-1], False

    idx = 0
    while idx < len(cum_dist_m) - 1 and cum_dist_m[idx + 1] < target_m:
        idx += 1
    d0, d1 = cum_dist_m[idx], cum_dist_m[idx + 1]
    t0, t1 = cum_duration_s[idx], cum_duration_s[idx + 1]
    if d1 - d0 < 1e-9:
        return t0, False
    frac = (target_m - d0) / (d1 - d0)
    return t0 + frac * (t1 - t0), False


def geometry_overlap_ratio(
    coords_a: list[list[float]],
    coords_b: list[list[float]],
    sample_step: int = 5,
    threshold_m: float = 100.0,
) -> float:
    """Fraction of sampled points from A within threshold_m of some point on B."""
    if not coords_a or not coords_b:
        return 0.0
    samples = coords_a[:: max(1, sample_step)] or coords_a
    hits = 0
    for lon, lat in samples:
        best = min(haversine_m(lat, lon, b[1], b[0]) for b in coords_b[:: max(1, sample_step)])
        if best <= threshold_m:
            hits += 1
    return hits / len(samples)


def dedupe_routes(
    routes: list[dict],
    overlap_threshold: float = 0.90,
) -> list[dict]:
    """Drop variants whose geometry overlaps an existing route by > ~90%."""
    kept: list[dict] = []
    for route in routes:
        geom = route.get("coordinates") or []
        duplicate = False
        for existing in kept:
            ratio = geometry_overlap_ratio(geom, existing.get("coordinates") or [])
            if ratio > overlap_threshold:
                duplicate = True
                break
        if not duplicate:
            kept.append(route)
    return kept
