from django.contrib import admin

from api.models import Checkpoint, Route, RouteSearch, WeatherSample


class RouteInline(admin.TabularInline):
    model = Route
    extra = 0


@admin.register(RouteSearch)
class RouteSearchAdmin(admin.ModelAdmin):
    list_display = ("id", "origin_name", "destination_name", "departure_utc", "created_at")
    inlines = [RouteInline]


admin.site.register(Route)
admin.site.register(Checkpoint)
admin.site.register(WeatherSample)
