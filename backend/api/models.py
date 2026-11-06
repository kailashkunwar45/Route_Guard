from django.db import models


class RouteSearch(models.Model):
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    origin_name = models.CharField(max_length=255)
    origin_lat = models.FloatField()
    origin_lon = models.FloatField()
    destination_name = models.CharField(max_length=255)
    destination_lat = models.FloatField()
    destination_lon = models.FloatField()
    departure_utc = models.DateTimeField()
    timezone = models.CharField(max_length=64)
    load_lb = models.PositiveIntegerField()
    checkpoint_interval_mi = models.PositiveSmallIntegerField(default=25)
    use_fixtures = models.BooleanField(default=False)
    provider_count_message = models.CharField(max_length=255, blank=True, null=True)
    recommendation = models.JSONField(default=dict)
    profile_note = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.origin_name} → {self.destination_name} ({self.created_at:%Y-%m-%d %H:%M})"


class Route(models.Model):
    search = models.ForeignKey(RouteSearch, related_name="routes", on_delete=models.CASCADE, db_index=True)
    label = models.CharField(max_length=64)
    exclude_tag = models.CharField(max_length=32, blank=True, null=True)
    coordinates = models.JSONField(default=list)
    distance_mi = models.FloatField()
    duration_s = models.FloatField()
    approximate_timing = models.BooleanField(default=False)
    partial_weather = models.BooleanField(default=False)
    metrics = models.JSONField(default=dict)
    sort_index = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["sort_index"]


class Checkpoint(models.Model):
    route = models.ForeignKey(Route, related_name="checkpoints", on_delete=models.CASCADE, db_index=True)
    sequence = models.PositiveIntegerField()
    lat = models.FloatField()
    lon = models.FloatField()
    distance_mi = models.FloatField()
    eta_utc = models.DateTimeField()
    weather_status = models.CharField(max_length=32, default="ok")
    weather_reason = models.CharField(max_length=255, blank=True, null=True)
    wind_mph = models.FloatField(null=True, blank=True)
    wind_gust_mph = models.FloatField(null=True, blank=True)
    rain_in_hr = models.FloatField(null=True, blank=True)
    snow_in_hr = models.FloatField(null=True, blank=True)
    risk_level = models.PositiveSmallIntegerField(null=True, blank=True)
    risk_name = models.CharField(max_length=32, blank=True, null=True)
    risk_explanation = models.TextField(blank=True, null=True)
    factors = models.JSONField(default=list)
    load_note = models.CharField(max_length=255, blank=True, null=True)
    risk_by_hour = models.JSONField(default=list)

    class Meta:
        ordering = ["sequence"]


class WeatherSample(models.Model):
    """Hourly values for popup / heatmap context (hour offset 0..48)."""

    checkpoint = models.ForeignKey(
        Checkpoint, related_name="hourly_weather", on_delete=models.CASCADE, db_index=True
    )
    hour_offset = models.PositiveSmallIntegerField()
    wind_mph = models.FloatField(null=True, blank=True)
    rain_in_hr = models.FloatField(null=True, blank=True)
    snow_in_hr = models.FloatField(null=True, blank=True)
    status = models.CharField(max_length=32, default="ok")
    reason = models.CharField(max_length=255, blank=True, null=True)

    class Meta:
        ordering = ["hour_offset"]
        unique_together = ("checkpoint", "hour_offset")
