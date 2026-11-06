from django.urls import path

from api import views

urlpatterns = [
    path("health/", views.health, name="health"),
    path("config/", views.config_public, name="config"),
    path("geocode/", views.geocode, name="geocode"),
    path("routes/analyze/", views.analyze, name="analyze"),
    path("routes/", views.route_list, name="route-list"),
    path("routes/<int:pk>/", views.route_detail, name="route-detail"),
]
