from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from api.exceptions import ProviderError


@pytest.fixture
def client():
    return APIClient()


@pytest.mark.django_db
@override_settings(USE_FIXTURES=True)
def test_analyze_fixture_mode_creates_search(client):
    dep = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M")
    payload = {
        "origin": {"name": "Dallas, TX", "lat": 32.7767, "lon": -96.7970},
        "destination": {"name": "Austin, TX", "lat": 30.2672, "lon": -97.7431},
        "departure_local": dep,
        "load_lb": 20000,
        "checkpoint_interval_mi": 25,
    }
    resp = client.post("/api/routes/analyze/", payload, format="json")
    assert resp.status_code == 201, resp.content
    data = resp.json()
    assert data["id"]
    assert len(data["routes"]) >= 1
    assert "recommendation" in data
    route = data["routes"][0]
    assert route["checkpoints"]
    assert "risk_by_hour" in route["checkpoints"][0]
    assert len(route["checkpoints"][0]["risk_by_hour"]) == 49

    listed = client.get("/api/routes/")
    assert listed.status_code == 200
    assert any(item["id"] == data["id"] for item in listed.json())

    detail = client.get(f"/api/routes/{data['id']}/")
    assert detail.status_code == 200
    assert detail.json()["id"] == data["id"]


def test_analyze_bad_input_400(client):
    resp = client.post("/api/routes/analyze/", {"load_lb": -1}, format="json")
    assert resp.status_code == 400
    assert "detail" in resp.json()


@override_settings(USE_FIXTURES=False, MAPBOX_SECRET_TOKEN="test-token", MAPBOX_PUBLIC_TOKEN="")
def test_provider_failure_502(client):
    dep = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M")
    payload = {
        "origin": {"name": "Dallas, TX", "lat": 32.7767, "lon": -96.7970},
        "destination": {"name": "Austin, TX", "lat": 30.2672, "lon": -97.7431},
        "departure_local": dep,
        "load_lb": 1000,
        "checkpoint_interval_mi": 25,
    }
    with patch("api.services.routing.fetch_routes", side_effect=ProviderError("Directions provider failure: boom")):
        resp = client.post("/api/routes/analyze/", payload, format="json")
    assert resp.status_code == 502
    assert "provider" in resp.json()["detail"].lower() or "Directions" in resp.json()["detail"]


@override_settings(USE_FIXTURES=True)
def test_geocode_fixture(client):
    resp = client.get("/api/geocode/", {"q": "Dallas"})
    assert resp.status_code == 200
    assert len(resp.json()["results"]) >= 1


@override_settings(USE_FIXTURES=True)
def test_health(client):
    resp = client.get("/api/health/")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
