"""GET /clusters/{id}/wind: live Open-Meteo (mocked) with ERA5 fallback, cone geometry, towns, sentence, cache."""

import json
import math
import socket
import urllib.error

import pytest

from conftest import CLUSTER_IDS, EXPORT, call, event
from handlers import wind
from handlers.app import handler

KEYS = {"source", "as_of", "speed_kmh", "bearing_deg", "cone_polygon", "towns_in_path", "sentence", "attribution"}
TOWN_KEYS = {"name", "state", "lat", "lon", "population", "distance_km", "bearing_deg"}


def exported(cid):
    return json.loads((EXPORT / f"wind_{cid}.json").read_text(encoding="utf-8"))


def meteo(speed=12.0, direction=315.0, time="2026-10-10T14:15", offset=19800):
    return {"latitude": 22.4, "longitude": 82.7, "utc_offset_seconds": offset, "timezone": "Asia/Kolkata",
            "current_units": {"wind_speed_10m": "km/h", "wind_direction_10m": "°"},
            "current": {"time": time, "interval": 900, "wind_speed_10m": speed, "wind_direction_10m": direction}}


def haversine_km(lat1, lon1, lat2, lon2):
    la1, lo1, la2, lo2 = map(math.radians, (lat1, lon1, lat2, lon2))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


@pytest.mark.parametrize("cid", CLUSTER_IDS)
def test_live(cid, open_meteo):
    calls = open_meteo(body=meteo())
    status, w = call("GET", "/clusters/{id}/wind", cid)
    assert status == 200 and set(w) == KEYS
    assert w["source"] == "live" and w["as_of"] == "2026-10-10T14:15+05:30"
    assert w["speed_kmh"] == 12.0 and w["bearing_deg"] == 135.0  # wind FROM north-west -> plume heads south-east
    assert "south-east" in w["sentence"] and "12 km/h" in w["sentence"] and "10 Oct 2026, 14:15 IST" in w["sentence"]
    assert "Open-Meteo" in w["attribution"]
    url, timeout = calls[0]
    assert url.startswith("https://api.open-meteo.com/v1/forecast?") and timeout == 3
    assert "wind_speed_10m" in url and "wind_direction_10m" in url and "wind_speed_unit=kmh" in url


@pytest.mark.parametrize("cid", CLUSTER_IDS)
def test_towns_and_cone(cid, open_meteo):
    open_meteo(body=meteo(direction=200.0))
    w = call("GET", "/clusters/{id}/wind", cid)[1]
    src = exported(cid)
    lat, lon, b = src["lat"], src["lon"], w["bearing_deg"]
    assert b == 20.0
    # Towns: inside ± 30° and 75 km, nearest first, at most 5, all qualifying candidates up to that limit.
    inside = [t for t in src["towns_within_cone_length"] if wind.angle_diff(t["bearing_deg"], b) <= 30]
    assert w["towns_in_path"] == inside[:5]
    for t in w["towns_in_path"]:
        assert set(t) == TOWN_KEYS and t["population"] > 50_000 and t["distance_km"] <= 75
    d = [t["distance_km"] for t in w["towns_in_path"]]
    assert d == sorted(d)
    # Cone: closed GeoJSON ring from the centroid, arc points 75 km out within ± 30° of the bearing.
    ring = w["cone_polygon"]["coordinates"][0]
    assert w["cone_polygon"]["type"] == "Polygon" and ring[0] == ring[-1] == [round(lon, 4), round(lat, 4)]
    assert len(ring) == 13 + 2
    for lo, la in ring[1:-1]:
        assert abs(haversine_km(lat, lon, la, lo) - 75) < 0.1
        brg = (math.degrees(math.atan2(math.sin(math.radians(lo - lon)) * math.cos(math.radians(la)),
                                       math.cos(math.radians(lat)) * math.sin(math.radians(la))
                                       - math.sin(math.radians(lat)) * math.cos(math.radians(la)) * math.cos(math.radians(lo - lon)))) + 360) % 360
        assert wind.angle_diff(brg, b) <= 30.05


@pytest.mark.parametrize(
    "kw",
    [
        {"error": socket.timeout("timed out")},
        {"error": urllib.error.URLError("no route")},
        {"error": urllib.error.HTTPError("https://api.open-meteo.com", 429, "Too Many Requests", {}, None)},
        {"body": b"<html>not json</html>"},
        {"body": {"error": True, "reason": "bad"}},
        {"body": meteo(speed=float("nan"))},
        {"body": meteo(speed=-3)},
        {"body": meteo(direction=400)},
        {"body": meteo(time="2026-10-10 14:15")},
        {"body": meteo(offset=0)},
    ],
)
def test_falls_back_to_era5(kw, open_meteo):
    open_meteo(**kw)
    status, w = call("GET", "/clusters/{id}/wind", "korba")
    assert status == 200 and w["source"] == "era5"
    assert w == exported("korba")["trace"]
    assert "ERA5" in w["sentence"] and "ERA5" in w["attribution"]


def test_no_network_falls_back():
    # conftest disables urlopen entirely.
    assert call("GET", "/clusters/{id}/wind", "talcher")[1]["source"] == "era5"


@pytest.mark.parametrize("cid", CLUSTER_IDS)
def test_api_geometry_matches_pipeline_export(cid):
    """handlers/wind.py mirrors pipeline/src/export/wind.py: recomputing the exported ERA5 trace gives the same answer."""
    src = exported(cid)
    e = src["era5"]
    again = wind.trace(src["name"], src["lat"], src["lon"], src["towns_within_cone_length"], "era5",
                       src["trace"]["as_of"], e["speed_kmh"], e["from_deg"])
    assert again == src["trace"]


def test_cache_30_min_live(open_meteo, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(wind.time, "monotonic", lambda: now[0])
    calls = open_meteo(body=meteo())
    r = handler(event("GET", "/clusters/{id}/wind", "korba"))
    assert r["headers"]["cache-control"] == "public, max-age=1800"
    now[0] += 1799
    handler(event("GET", "/clusters/{id}/wind", "korba"))
    assert len(calls) == 1
    now[0] += 2
    handler(event("GET", "/clusters/{id}/wind", "korba"))
    assert len(calls) == 2


def test_fallback_cached_5_min(open_meteo, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(wind.time, "monotonic", lambda: now[0])
    calls = open_meteo(error=socket.timeout("timed out"))
    r = handler(event("GET", "/clusters/{id}/wind", "korba"))
    assert r["headers"]["cache-control"] == "public, max-age=300" and json.loads(r["body"])["source"] == "era5"
    now[0] += 301
    open_meteo(body=meteo())
    assert call("GET", "/clusters/{id}/wind", "korba")[1]["source"] == "live"
    assert len(calls) == 1


def test_sentences():
    town = {"name": "Bilaspur", "state": "Chhattisgarh", "lat": 22.08, "lon": 82.16, "population": 365579, "distance_km": 65.4, "bearing_deg": 238.3}
    s = wind.sentence("Korba", "live", "2026-10-10T14:00+05:30", 12.0, 135.0, [town])
    assert s == "The Korba cluster's plume is likely heading south-east toward Bilaspur (wind 12 km/h, as of 10 Oct 2026, 14:00 IST)."
    s = wind.sentence("Korba", "live", "2026-10-10T14:00+05:30", 12.0, 135.0, [town | {"name": "Korba"}])
    assert "toward the town of Korba" in s
    s = wind.sentence("Talcher", "era5", "2026-10-01T13:30+05:30", 8.0, 140.0, [])
    assert "no town of over 50,000 people lies within 75 km" in s and "ERA5 reanalysis for 1 Oct 2026, 13:30 IST" in s
    s = wind.sentence("Korba", "live", "2026-10-10T14:00+05:30", 2.0, 135.0, [town])
    assert "near calm" in s and "Bilaspur" not in s


@pytest.mark.parametrize("bearing,word", [(0, "north"), (22.4, "north"), (22.5, "north-east"), (90, "east"), (180, "south"),
                                          (247, "south-west"), (292.5, "north-west"), (337.4, "north-west"), (359.9, "north")])
def test_compass(bearing, word):
    assert wind.compass(bearing) == word


@pytest.mark.parametrize("cid", CLUSTER_IDS)
def test_direction_only(cid, open_meteo):
    """No concentration, exposure or health claims in the sentence."""
    open_meteo(body=meteo(direction=90))
    s = call("GET", "/clusters/{id}/wind", cid)[1]["sentence"].lower()
    for word in ("µmol", "concentration", "exposed", "exposure", "health", "unsafe", "ppb", "µg"):
        assert word not in s
