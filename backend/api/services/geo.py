"""Origin timezone helpers."""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from timezonefinder import TimezoneFinder

_tf = TimezoneFinder()


def resolve_timezone(lat: float, lon: float) -> str:
    name = _tf.timezone_at(lng=lon, lat=lat)
    return name or "UTC"


def local_to_utc(dt_naive_local: datetime, tz_name: str) -> datetime:
    tz = ZoneInfo(tz_name)
    local = dt_naive_local.replace(tzinfo=tz)
    return local.astimezone(ZoneInfo("UTC"))


def utc_to_local(dt_utc: datetime, tz_name: str) -> datetime:
    if dt_utc.tzinfo is None:
        dt_utc = dt_utc.replace(tzinfo=ZoneInfo("UTC"))
    return dt_utc.astimezone(ZoneInfo(tz_name))
