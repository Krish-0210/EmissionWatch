"""GET /clusters/{id}/wind: which way the cluster's plume is likely heading. Direction only, no concentrations.

Live: Open-Meteo forecast API (free, no key), current 10 m wind at the cluster centroid, 3 s socket timeout.
Fallback (any error or implausible reply): the latest ERA5 value exported by the pipeline (wind_{id}.json
`trace`, source "era5"). The cone (bearing ± 30°, 75 km) and the towns in it (GeoNames, > 50,000 people,
nearest 5) are computed here from the exported candidate towns with the same geometry as
pipeline/src/export/wind.py (tests check that both give the same ERA5 trace).

Response: {source: "live" | "era5", as_of, speed_kmh, bearing_deg, cone_polygon (GeoJSON Polygon, lon/lat),
towns_in_path: [{name, state, lat, lon, population, distance_km, bearing_deg}], sentence, attribution}.
bearing_deg is the direction the plume heads to (wind FROM direction + 180).
Cached in memory per cluster: live answers 30 min, ERA5 fallbacks 5 min (so live is retried sooner).
"""

import json
import logging
import math
import re
import time
import urllib.parse
import urllib.request

from handlers import data

log = logging.getLogger(__name__)

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
LIVE_TIMEOUT_S = 3
LIVE_TTL_S, FALLBACK_TTL_S = 1800, 300
IST_OFFSET_S = 19800

CONE_HALF_DEG, CONE_KM, MAX_TOWNS, ARC_STEP_DEG = 30, 75, 5, 5
CALM_KMH = 3.6
EARTH_KM = 6371.0
COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
ATTRIBUTION = {
    "era5": "Wind: ERA5 hourly reanalysis (Copernicus Climate Change Service / ECMWF). Towns: GeoNames, CC BY 4.0.",
    "live": "Wind: Open-Meteo forecast API (open-meteo.com), CC BY 4.0. Towns: GeoNames, CC BY 4.0.",
}
LOCAL_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")

_cache: dict[str, tuple[float, float, dict]] = {}  # cid -> (stored_at, ttl, response)


def clear_cache() -> None:
    _cache.clear()


# ---------- geometry and wording (mirror of pipeline/src/export/wind.py) ----------
def destination(lat, lon, bearing_deg, km) -> tuple[float, float]:
    la1, lo1, b, d = math.radians(lat), math.radians(lon), math.radians(bearing_deg), km / EARTH_KM
    la2 = math.asin(math.sin(la1) * math.cos(d) + math.cos(la1) * math.sin(d) * math.cos(b))
    lo2 = lo1 + math.atan2(math.sin(b) * math.sin(d) * math.cos(la1), math.cos(d) - math.sin(la1) * math.sin(la2))
    return math.degrees(la2), (math.degrees(lo2) + 540) % 360 - 180


def angle_diff(a, b) -> float:
    return abs((a - b + 180) % 360 - 180)


def cone_polygon(lat, lon, bearing_deg) -> dict:
    ring = [[round(lon, 4), round(lat, 4)]]
    for k in range(-CONE_HALF_DEG, CONE_HALF_DEG + 1, ARC_STEP_DEG):
        la, lo = destination(lat, lon, bearing_deg + k, CONE_KM)
        ring.append([round(lo, 4), round(la, 4)])
    ring.append(ring[0])
    return {"type": "Polygon", "coordinates": [ring]}


def compass(bearing_deg) -> str:
    return COMPASS[int(((bearing_deg % 360) + 22.5) // 45) % 8]


def when_text(source: str, as_of: str) -> str:
    y, mo, d, hm = int(as_of[0:4]), int(as_of[5:7]), int(as_of[8:10]), as_of[11:16]
    stamp = f"{d} {MONTHS[mo - 1]} {y}, {hm} IST"
    return f"as of {stamp}" if source == "live" else f"ERA5 reanalysis for {stamp}"


def sentence(name: str, source: str, as_of: str, speed_kmh: float, bearing_deg: float, in_path: list[dict]) -> str:
    direction, when, v = compass(bearing_deg), when_text(source, as_of), f"{speed_kmh:.0f}"
    if speed_kmh < CALM_KMH:
        return (f"Winds at the {name} cluster are near calm ({v} km/h, {when}), so the plume is likely to stay close "
                f"to the plants, drifting {direction}.")
    if in_path:
        toward = " and ".join(f"the town of {t['name']}" if t["name"] == name else t["name"] for t in in_path[:2])
        return f"The {name} cluster's plume is likely heading {direction} toward {toward} (wind {v} km/h, {when})."
    return (f"The {name} cluster's plume is likely heading {direction}; no town of over 50,000 people lies within "
            f"{CONE_KM} km in that direction (wind {v} km/h, {when}).")


def trace(name: str, lat: float, lon: float, candidates: list[dict], source: str, as_of: str,
          speed_kmh: float, from_deg: float) -> dict:
    bearing = round((from_deg + 180) % 360, 1)
    speed = round(speed_kmh, 1)
    in_path = [t for t in candidates if angle_diff(t["bearing_deg"], bearing) <= CONE_HALF_DEG][:MAX_TOWNS]
    return {
        "source": source,
        "as_of": as_of,
        "speed_kmh": speed,
        "bearing_deg": bearing,
        "cone_polygon": cone_polygon(lat, lon, bearing),
        "towns_in_path": in_path,
        "sentence": sentence(name, source, as_of, speed, bearing, in_path),
        "attribution": ATTRIBUTION[source],
    }


# ---------- live wind ----------
def live_wind(lat: float, lon: float) -> tuple[str, float, float]:
    """(as_of 'YYYY-MM-DDTHH:MM+05:30', speed km/h, direction FROM in degrees). Raises on any problem."""
    q = urllib.parse.urlencode({
        "latitude": f"{lat:.4f}", "longitude": f"{lon:.4f}", "current": "wind_speed_10m,wind_direction_10m",
        "wind_speed_unit": "kmh", "timezone": "Asia/Kolkata",
    })
    req = urllib.request.Request(f"{OPEN_METEO_URL}?{q}", headers={"User-Agent": "PanoptiCoal/1.0"})
    with urllib.request.urlopen(req, timeout=LIVE_TIMEOUT_S) as r:
        body = json.loads(r.read().decode("utf-8"))
    cur = body["current"]
    speed, direction, t = float(cur["wind_speed_10m"]), float(cur["wind_direction_10m"]), str(cur["time"])
    if body.get("utc_offset_seconds") != IST_OFFSET_S or not LOCAL_TIME.match(t):
        raise ValueError(f"unexpected time {t!r} / offset {body.get('utc_offset_seconds')!r}")
    if not (math.isfinite(speed) and 0 <= speed < 300 and math.isfinite(direction) and 0 <= direction <= 360):
        raise ValueError(f"implausible wind {speed!r} km/h from {direction!r}")
    return f"{t}+05:30", speed, direction % 360


def wind(cid: str) -> tuple[dict, int]:
    """(response, cache max-age in seconds)."""
    data.require_cluster(cid)
    now = time.monotonic()
    hit = _cache.get(cid)
    if hit and now - hit[0] < hit[1]:
        return hit[2], max(0, int(hit[1] - (now - hit[0])))
    w = data.get_json(f"wind_{cid}.json")
    try:
        as_of, speed, from_deg = live_wind(w["lat"], w["lon"])
        out, ttl = trace(w["name"], w["lat"], w["lon"], w["towns_within_cone_length"], "live", as_of, speed, from_deg), LIVE_TTL_S
    except Exception as e:  # network, timeout, HTTP error, bad JSON, implausible values -> ERA5
        log.warning("wind for %s: live forecast failed (%s: %s); using ERA5", cid, type(e).__name__, e)
        out, ttl = w["trace"], FALLBACK_TTL_S
    _cache[cid] = (now, ttl, out)
    return out, ttl
