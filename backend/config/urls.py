from django.contrib import admin
from django.urls import include, path
from django.http import JsonResponse

def root_status(request):
    return JsonResponse({
        "service": "RouteGuard API",
        "status": "online",
        "endpoints": {
            "health": "/api/health/",
            "config": "/api/config/",
            "geocode": "/api/geocode/?q=<search>",
            "analyze": "/api/routes/analyze/",
            "routes": "/api/routes/",
            "admin": "/admin/"
        }
    })

urlpatterns = [
    path("", root_status, name="root_status"),
    path("admin/", admin.site.urls),
    path("api/", include("api.urls")),
]

