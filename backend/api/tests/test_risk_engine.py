import math
from datetime import datetime, timezone, timedelta

import pytest

from api.services.risk_engine import (
    LOW,
    MODERATE,
    HIGH,
    SEVERE,
    NO_TRAVEL,
    wind_level,
    rain_level,
    snow_level,
    apply_load_adjustment,
    evaluate_checkpoint,
    compute_route_metrics,
    recommend_routes,
    build_checkpoints,
    eta_at_distance,
    scale_distances_to_provider,
    cumulative_distances_m,
    dedupe_routes,
    geometry_overlap_ratio,
)


@pytest.mark.parametrize(
    "mph,expected",
    [
        (24.9, LOW),
        (25, MODERATE),
        (34.9, MODERATE),
        (35, HIGH),
        (44.9, HIGH),
        (45, SEVERE),
        (54.9, SEVERE),
        (55, NO_TRAVEL),
    ],
)
def test_wind_boundaries(mph, expected):
    assert wind_level(mph) == expected


@pytest.mark.parametrize(
    "val,expected",
    [
        (0.099, LOW),
        (0.10, MODERATE),
        (0.249, MODERATE),
        (0.25, HIGH),
        (0.499, HIGH),
        (0.50, SEVERE),
        (1.00, SEVERE),
        (1.001, NO_TRAVEL),
    ],
)
def test_rain_boundaries(val, expected):
    assert rain_level(val) == expected


@pytest.mark.parametrize(
    "val,expected",
    [
        (0.49, LOW),
        (0.5, MODERATE),
        (0.99, MODERATE),
        (1.0, HIGH),
        (1.99, HIGH),
        (2.0, SEVERE),
        (3.0, SEVERE),
        (3.01, NO_TRAVEL),
    ],
)
def test_snow_boundaries(val, expected):
    assert snow_level(val) == expected


def test_load_30000_vs_30001_at_50mph():
    base = wind_level(50)  # SEVERE
    a, _ = apply_load_adjustment(50, 30_000, base)
    b, _ = apply_load_adjustment(50, 30_001, base)
    assert a == SEVERE
    assert b == NO_TRAVEL


def test_load_40000_vs_40001_at_40mph():
    base = wind_level(40)  # HIGH
    a, _ = apply_load_adjustment(40, 40_000, base)
    b, note = apply_load_adjustment(40, 40_001, base)
    assert a == HIGH
    assert b == SEVERE
    assert note is not None


def test_55mph_any_load_no_travel():
    level, _ = apply_load_adjustment(55, 0, wind_level(55))
    assert level == NO_TRAVEL


def test_load_never_lowers_risk():
    # Already NO_TRAVEL from rain; load rules must not lower
    risk = evaluate_checkpoint(20, 1.5, 0.0, 50_000)
    assert risk.level == NO_TRAVEL


def test_highest_factor_wins():
    risk = evaluate_checkpoint(40, 0.05, 0.1, 10_000)  # wind HIGH
    assert risk.level == HIGH
    risk2 = evaluate_checkpoint(20, 0.6, 0.1, 10_000)  # rain SEVERE
    assert risk2.level == SEVERE


def test_unavailable_weather_returns_none():
    assert evaluate_checkpoint(None, 0.1, 0.1, 1000) is None


def _line_coords(n=11, lon0=-97.0, lat0=32.0, dlon=0.01):
    # roughly eastward line
    return [[lon0 + i * dlon, lat0] for i in range(n)]


def test_checkpoints_spacing_and_destination():
    coords = _line_coords(51)
    cum = cumulative_distances_m(coords)
    provider_m = cum[-1]
    total_mi = provider_m / 1609.344
    cps = build_checkpoints(coords, provider_m, interval_mi=25)
    assert cps[0]["distance_mi"] == 0.0
    assert abs(cps[-1]["distance_mi"] - total_mi) < 1e-6
    # spacing ~25 except last
    for i in range(1, len(cps) - 1):
        assert abs(cps[i]["distance_mi"] - i * 25) < 1e-6


def test_checkpoints_short_route():
    coords = _line_coords(5, dlon=0.002)
    provider_m = cumulative_distances_m(coords)[-1]
    cps = build_checkpoints(coords, provider_m, interval_mi=25)
    assert len(cps) == 2
    assert cps[0]["distance_mi"] == 0.0
    assert cps[-1]["sequence"] == 1


def test_eta_uneven_segments_monotonic():
    cum_dist = [0.0, 1000.0, 2000.0, 3000.0]
    cum_dur = [0.0, 100.0, 400.0, 500.0]  # slow middle
    t0, approx = eta_at_distance(0, cum_dist, cum_dur, 500, False)
    t1, _ = eta_at_distance(1000, cum_dist, cum_dur, 500, False)
    t2, _ = eta_at_distance(2000, cum_dist, cum_dur, 500, False)
    t3, _ = eta_at_distance(3000, cum_dist, cum_dur, 500, False)
    assert t0 == 0.0 and not approx
    assert t1 == 100.0
    assert t2 == 400.0
    assert t3 == 500.0
    assert t0 <= t1 <= t2 <= t3
    # mid of slow segment should be closer to 400 than even split
    mid, _ = eta_at_distance(1500, cum_dist, cum_dur, 500, False)
    assert mid == 250.0


def test_metrics_miles_sum_and_unknown():
    distances = [0.0, 10.0, 25.0, 40.0]
    levels = [LOW, MODERATE, None, HIGH]
    m = compute_route_metrics(distances, levels, duration_s=3600)
    assert abs(m.total_mi - 40.0) < 1e-9
    # segments: 0-10 max(L,M)=M; 10-25 and 25-40 unknown (null endpoint)
    assert abs(m.unknown_mi - 30.0) < 1e-9
    assert abs(m.moderate_mi - 10.0) < 1e-9
    assert m.average_risk == MODERATE


def test_metrics_partial_last_segment():
    distances = [0.0, 25.0, 30.0]
    levels = [LOW, LOW, HIGH]
    m = compute_route_metrics(distances, levels, 1000)
    assert abs(m.total_mi - 30.0) < 1e-9
    assert abs(m.low_mi - 25.0) < 1e-9
    assert abs(m.high_mi - 5.0) < 1e-9  # max(LOW,HIGH)=HIGH


def test_ranking_fewer_severe_beats_faster():
    from api.services.risk_engine import RouteMetrics

    a = {
        "id": "A",
        "label": "Route A",
        "distance_mi": 100,
        "metrics": RouteMetrics(severe_mi=12.4, high_mi=0, average_risk=2.0, duration_s=3000, total_mi=100),
    }
    b = {
        "id": "B",
        "label": "Route B",
        "distance_mi": 110,
        "metrics": RouteMetrics(severe_mi=0.0, high_mi=5, average_risk=2.5, duration_s=4000, total_mi=110),
    }
    rec = recommend_routes([a, b], fastest_duration_s=3000)
    assert rec.recommended_route_id == "B"
    assert "severe" in rec.explanation.lower()


def test_ranking_tiebreak_high_miles():
    from api.services.risk_engine import RouteMetrics

    a = {"id": "A", "label": "A", "distance_mi": 100, "metrics": RouteMetrics(severe_mi=0, high_mi=10, average_risk=2, duration_s=100, total_mi=100)}
    b = {"id": "B", "label": "B", "distance_mi": 100, "metrics": RouteMetrics(severe_mi=0, high_mi=5, average_risk=3, duration_s=100, total_mi=100)}
    rec = recommend_routes([a, b])
    assert rec.recommended_route_id == "B"


def test_no_travel_excluded_and_all_no_travel():
    from api.services.risk_engine import RouteMetrics

    a = {
        "id": "A",
        "label": "A",
        "distance_mi": 50,
        "metrics": RouteMetrics(has_no_travel=True, no_travel_mi=5, severe_mi=0, high_mi=0, average_risk=5, duration_s=100, total_mi=50),
        "blocking_checkpoints": [{"sequence": 2, "reason": "Wind 60 mph"}],
    }
    b = {
        "id": "B",
        "label": "B",
        "distance_mi": 60,
        "metrics": RouteMetrics(has_no_travel=False, severe_mi=1, high_mi=0, average_risk=2, duration_s=200, total_mi=60),
    }
    rec = recommend_routes([a, b])
    assert rec.recommended_route_id == "B"

    c = {
        "id": "C",
        "label": "C",
        "distance_mi": 40,
        "metrics": RouteMetrics(has_no_travel=True, no_travel_mi=2, severe_mi=0, high_mi=0, average_risk=5, duration_s=90, total_mi=40),
        "blocking_checkpoints": [{"sequence": 1, "reason": "Snow"}],
    }
    rec2 = recommend_routes([a, c])
    assert rec2.recommended_route_id is None
    assert rec2.safe_available is False
    assert "No safe route" in rec2.warning
    assert rec2.least_restricted_order[0] == "C"


def test_dedupe_and_overlap():
    line1 = [[-97 + i * 0.01, 32] for i in range(20)]
    line2 = [[-97 + i * 0.01, 32.00001] for i in range(20)]  # nearly identical
    line3 = [[-96 + i * 0.01, 33] for i in range(20)]
    routes = [
        {"id": 1, "coordinates": line1},
        {"id": 2, "coordinates": line2},
        {"id": 3, "coordinates": line3},
    ]
    kept = dedupe_routes(routes, overlap_threshold=0.90)
    assert len(kept) == 2
    assert geometry_overlap_ratio(line1, line2) > 0.9
