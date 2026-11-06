from django.conf import settings
from django.db.models import Prefetch
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from api.exceptions import ProviderError, ValidationBusinessError
from api.models import Checkpoint, Route, RouteSearch, WeatherSample
from api.persistence import persist_analysis
from api.serializers import (
    AnalyzeInputSerializer,
    RouteSearchDetailSerializer,
    RouteSearchListSerializer,
)
from api.services import geocoding
from api.services.analyze import analyze_request


@api_view(["GET"])
def health(request):
    return Response(
        {
            "status": "ok",
            "use_fixtures": settings.USE_FIXTURES,
            "mapbox_public_token_configured": bool(settings.MAPBOX_PUBLIC_TOKEN),
        }
    )


@api_view(["GET"])
def config_public(request):
    return Response(
        {
            "mapbox_public_token": settings.MAPBOX_PUBLIC_TOKEN,
            "use_fixtures": settings.USE_FIXTURES,
        }
    )


@api_view(["GET"])
def geocode(request):
    q = request.query_params.get("q", "")
    try:
        results = geocoding.geocode_suggest(q)
    except ProviderError as exc:
        return Response({"detail": exc.message}, status=exc.status_code)
    return Response({"results": results})


@api_view(["POST"])
def analyze(request):
    ser = AnalyzeInputSerializer(data=request.data)
    if not ser.is_valid():
        detail = next(iter(ser.errors.values()))
        if isinstance(detail, list):
            detail = detail[0]
        return Response({"detail": str(detail)}, status=status.HTTP_400_BAD_REQUEST)

    try:
        result = analyze_request(ser.validated_data)
        search = persist_analysis(result)
    except ValidationBusinessError as exc:
        return Response({"detail": exc.message}, status=exc.status_code)
    except ProviderError as exc:
        return Response({"detail": exc.message}, status=exc.status_code)

    search = (
        RouteSearch.objects.filter(pk=search.pk)
        .prefetch_related(
            Prefetch(
                "routes",
                queryset=Route.objects.prefetch_related(
                    Prefetch(
                        "checkpoints",
                        queryset=Checkpoint.objects.prefetch_related("hourly_weather"),
                    )
                ),
            )
        )
        .get()
    )
    data = RouteSearchDetailSerializer(search, context={"timezone": search.timezone}).data
    return Response(data, status=status.HTTP_201_CREATED)


@api_view(["GET"])
def route_list(request):
    qs = RouteSearch.objects.all()[:50]
    return Response(RouteSearchListSerializer(qs, many=True).data)


@api_view(["GET"])
def route_detail(request, pk):
    try:
        search = (
            RouteSearch.objects.prefetch_related(
                Prefetch(
                    "routes",
                    queryset=Route.objects.prefetch_related(
                        Prefetch(
                            "checkpoints",
                            queryset=Checkpoint.objects.prefetch_related(
                                Prefetch("hourly_weather", queryset=WeatherSample.objects.all())
                            ),
                        )
                    ),
                )
            ).get(pk=pk)
        )
    except RouteSearch.DoesNotExist:
        return Response({"detail": "Analysis not found"}, status=status.HTTP_404_NOT_FOUND)
    return Response(RouteSearchDetailSerializer(search, context={"timezone": search.timezone}).data)
