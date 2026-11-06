from datetime import datetime

from rest_framework import serializers

from api.models import Checkpoint, Route, RouteSearch, WeatherSample


class AnalyzeInputSerializer(serializers.Serializer):
    origin = serializers.DictField()
    destination = serializers.DictField()
    departure_local = serializers.CharField()
    load_lb = serializers.IntegerField(min_value=0, max_value=80_000)
    checkpoint_interval_mi = serializers.ChoiceField(choices=[10, 25, 50], default=25)

    def validate_origin(self, value):
        return self._validate_place(value, "origin")

    def validate_destination(self, value):
        return self._validate_place(value, "destination")

    def _validate_place(self, value, label):
        if not isinstance(value, dict):
            raise serializers.ValidationError(f"{label} must be an object")
        for key in ("name", "lat", "lon"):
            if key not in value:
                raise serializers.ValidationError(f"{label}.{key} is required")
        try:
            value["lat"] = float(value["lat"])
            value["lon"] = float(value["lon"])
        except (TypeError, ValueError) as exc:
            raise serializers.ValidationError(f"{label} lat/lon must be numbers") from exc
        value["name"] = str(value["name"])[:255]
        return value

    def validate_departure_local(self, value):
        raw = value.strip()
        for fmt in (
            "%Y-%m-%dT%H:%M",
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%d %H:%M",
            "%Y-%m-%d %H:%M:%S",
        ):
            try:
                return datetime.strptime(raw[:19], fmt)
            except ValueError:
                continue
        # ISO with timezone offset — strip tz for origin-local convention
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            return dt.replace(tzinfo=None)
        except ValueError as exc:
            raise serializers.ValidationError(
                "departure_local must be YYYY-MM-DDTHH:MM in origin local time"
            ) from exc


class WeatherSampleSerializer(serializers.ModelSerializer):
    class Meta:
        model = WeatherSample
        fields = ("hour_offset", "wind_mph", "rain_in_hr", "snow_in_hr", "status", "reason")


class CheckpointSerializer(serializers.ModelSerializer):
    hourly_samples = WeatherSampleSerializer(source="hourly_weather", many=True, read_only=True)
    eta_local = serializers.SerializerMethodField()

    class Meta:
        model = Checkpoint
        fields = (
            "id",
            "sequence",
            "lat",
            "lon",
            "distance_mi",
            "eta_utc",
            "eta_local",
            "weather_status",
            "weather_reason",
            "wind_mph",
            "wind_gust_mph",
            "rain_in_hr",
            "snow_in_hr",
            "risk_level",
            "risk_name",
            "risk_explanation",
            "factors",
            "load_note",
            "risk_by_hour",
            "hourly_samples",
        )

    def get_eta_local(self, obj):
        tz = self.context.get("timezone")
        if not tz:
            return obj.eta_utc.isoformat()
        from api.services.geo import utc_to_local

        return utc_to_local(obj.eta_utc, tz).isoformat()


class RouteSerializer(serializers.ModelSerializer):
    checkpoints = CheckpointSerializer(many=True, read_only=True)

    class Meta:
        model = Route
        fields = (
            "id",
            "label",
            "exclude_tag",
            "coordinates",
            "distance_mi",
            "duration_s",
            "approximate_timing",
            "partial_weather",
            "metrics",
            "sort_index",
            "checkpoints",
        )


class RouteSearchListSerializer(serializers.ModelSerializer):
    route_count = serializers.IntegerField(source="routes.count", read_only=True)

    class Meta:
        model = RouteSearch
        fields = (
            "id",
            "created_at",
            "origin_name",
            "destination_name",
            "departure_utc",
            "timezone",
            "load_lb",
            "checkpoint_interval_mi",
            "use_fixtures",
            "recommendation",
            "route_count",
        )


class RouteSearchDetailSerializer(serializers.ModelSerializer):
    routes = RouteSerializer(many=True, read_only=True)
    origin = serializers.SerializerMethodField()
    destination = serializers.SerializerMethodField()
    departure_local = serializers.SerializerMethodField()

    class Meta:
        model = RouteSearch
        fields = (
            "id",
            "created_at",
            "origin",
            "destination",
            "departure_utc",
            "departure_local",
            "timezone",
            "load_lb",
            "checkpoint_interval_mi",
            "use_fixtures",
            "provider_count_message",
            "profile_note",
            "recommendation",
            "routes",
        )

    def get_origin(self, obj):
        return {
            "name": obj.origin_name,
            "lat": obj.origin_lat,
            "lon": obj.origin_lon,
            "timezone": obj.timezone,
        }

    def get_destination(self, obj):
        return {
            "name": obj.destination_name,
            "lat": obj.destination_lat,
            "lon": obj.destination_lon,
        }

    def get_departure_local(self, obj):
        from api.services.geo import utc_to_local

        return utc_to_local(obj.departure_utc, obj.timezone).isoformat()
