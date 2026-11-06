from datetime import datetime, timezone

from django.db import transaction

from api.models import Checkpoint, Route, RouteSearch, WeatherSample


def persist_analysis(result: dict) -> RouteSearch:
    dep = result["departure_utc"]
    if isinstance(dep, str):
        dep = datetime.fromisoformat(dep.replace("Z", "+00:00"))
    if dep.tzinfo is None:
        dep = dep.replace(tzinfo=timezone.utc)

    with transaction.atomic():
        search = RouteSearch.objects.create(
            origin_name=result["origin"]["name"],
            origin_lat=result["origin"]["lat"],
            origin_lon=result["origin"]["lon"],
            destination_name=result["destination"]["name"],
            destination_lat=result["destination"]["lat"],
            destination_lon=result["destination"]["lon"],
            departure_utc=dep,
            timezone=result["timezone"],
            load_lb=result["load_lb"],
            checkpoint_interval_mi=result["checkpoint_interval_mi"],
            use_fixtures=result.get("use_fixtures", False),
            provider_count_message=result.get("provider_count_message"),
            recommendation=result.get("recommendation") or {},
            profile_note=result.get("profile_note") or "",
        )

        id_map = {}
        for idx, r in enumerate(result["routes"]):
            route = Route.objects.create(
                search=search,
                label=r["label"],
                exclude_tag=r.get("exclude_tag"),
                coordinates=r.get("coordinates") or [],
                distance_mi=r["distance_mi"],
                duration_s=r["duration_s"],
                approximate_timing=r.get("approximate_timing", False),
                partial_weather=r.get("partial_weather", False),
                metrics=r.get("metrics") or {},
                sort_index=idx,
            )
            id_map[r["id"]] = route.id

            for cp in r.get("checkpoints") or []:
                eta = cp["eta_utc"]
                if isinstance(eta, str):
                    eta = datetime.fromisoformat(eta.replace("Z", "+00:00"))
                checkpoint = Checkpoint.objects.create(
                    route=route,
                    sequence=cp["sequence"],
                    lat=cp["lat"],
                    lon=cp["lon"],
                    distance_mi=cp["distance_mi"],
                    eta_utc=eta,
                    weather_status=cp.get("weather_status") or "unavailable",
                    weather_reason=cp.get("weather_reason"),
                    wind_mph=cp.get("wind_mph"),
                    wind_gust_mph=cp.get("wind_gust_mph"),
                    rain_in_hr=cp.get("rain_in_hr"),
                    snow_in_hr=cp.get("snow_in_hr"),
                    risk_level=cp.get("risk_level"),
                    risk_name=cp.get("risk_name"),
                    risk_explanation=cp.get("risk_explanation"),
                    factors=cp.get("factors") or [],
                    load_note=cp.get("load_note"),
                    risk_by_hour=cp.get("risk_by_hour") or [],
                )
                samples = []
                for h_i, h in enumerate(cp.get("hourly_samples") or []):
                    samples.append(
                        WeatherSample(
                            checkpoint=checkpoint,
                            hour_offset=h_i,
                            wind_mph=h.get("wind_mph"),
                            rain_in_hr=h.get("rain_in_hr"),
                            snow_in_hr=h.get("snow_in_hr"),
                            status=h.get("status") or "unavailable",
                            reason=h.get("reason"),
                        )
                    )
                if samples:
                    WeatherSample.objects.bulk_create(samples)

        # Remap recommendation ids from temporary indices to DB ids
        rec = dict(search.recommendation or {})
        if rec.get("recommended_route_id") is not None:
            rec["recommended_route_id"] = id_map.get(rec["recommended_route_id"], rec["recommended_route_id"])
        for key in ("ranked_order", "least_restricted_order"):
            if key in rec and isinstance(rec[key], list):
                rec[key] = [id_map.get(x, x) for x in rec[key]]
        if rec.get("blocking"):
            for b in rec["blocking"]:
                if "route_id" in b:
                    b["route_id"] = id_map.get(b["route_id"], b["route_id"])
        search.recommendation = rec
        search.save(update_fields=["recommendation"])

    return search
