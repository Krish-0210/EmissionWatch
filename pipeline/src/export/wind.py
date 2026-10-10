"""Wind trace per cluster: which way the plume is likely heading, a direction cone and the towns inside it.

Direction only: the cone says where air from the plants is moving, not how much NO2 arrives anywhere.
  - wind: latest ERA5 value in weather_daily.parquet (08:00 UTC image at the cluster centroid, 10 m wind).
    ERA5 wind_dir is the direction the wind blows FROM; the plume heads to bearing = (from + 180) % 360.
  - cone: bearing ± CONE_HALF_DEG out to CONE_KM from the centroid (GeoJSON Polygon, lon/lat).
  - towns: config/india_towns_50k.csv (GeoNames, > 50,000 people) within CONE_KM of the centroid; the
    MAX_TOWNS nearest whose bearing from the centroid is inside the cone are "in path".

wind_{id}.json holds the inputs the API needs to redo this for a live wind (candidate towns with distance and
bearing) plus `trace`, the ERA5 result in the exact shape of GET /clusters/{id}/wind (source "era5").
api/handlers/wind.py implements the same geometry and sentence; api/tests check both agree.

Usage (from pipeline/; normally run by src.export.to_json):
    python -m src.export.wind
"""

import math
from pathlib import Path

import pandas as pd

from src.ingest import towns as towns_mod

PIPELINE_DIR = Path(__file__).resolve().parents[2]
WEATHER_PATH = PIPELINE_DIR / "data" / "processed" / "weather_daily.parquet"
CONE_HALF_DEG, CONE_KM, MAX_TOWNS, ARC_STEP_DEG = 30, 75, 5, 5
CALM_KMH = 3.6  # 1 m/s: below this the direction says little
EARTH_KM = 6371.0
ERA5_HOUR_UTC = 8
COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
ATTRIBUTION = {
    "era5": "Wind: ERA5 hourly reanalysis (Copernicus Climate Change Service / ECMWF). Towns: GeoNames, CC BY 4.0.",
    "live": "Wind: Open-Meteo forecast API (open-meteo.com), CC BY 4.0. Towns: GeoNames, CC BY 4.0.",
}


def haversine_km(lat1, lon1, lat2, lon2) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (lat1, lon1, lat2, lon2))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return EARTH_KM * 2 * math.asin(math.sqrt(h))


def initial_bearing(lat1, lon1, lat2, lon2) -> float:
    la1, la2, dlo = math.radians(lat1), math.radians(lat2), math.radians(lon2 - lon1)
    y = math.sin(dlo) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dlo)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


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


def candidate_towns(lat, lon, towns: pd.DataFrame) -> list[dict]:
    """Towns within CONE_KM of the centroid, nearest first, with distance and bearing from it."""
    out = []
    for t in towns.to_dict("records"):
        d = haversine_km(lat, lon, t["lat"], t["lon"])
        if d <= CONE_KM:
            out.append({"name": t["name"], "state": t["state"], "lat": t["lat"], "lon": t["lon"],
                        "population": int(t["population"]), "distance_km": round(d, 1),
                        "bearing_deg": round(initial_bearing(lat, lon, t["lat"], t["lon"]), 1)})
    return sorted(out, key=lambda t: (t["distance_km"], t["name"]))


def compass(bearing_deg) -> str:
    return COMPASS[int(((bearing_deg % 360) + 22.5) // 45) % 8]


def when_text(source: str, as_of: str) -> str:
    """as_of 'YYYY-MM-DDTHH:MM+05:30' -> 'as of 10 Oct 2026, 14:15 IST' / 'ERA5 reanalysis for 1 Oct 2026, 13:30 IST'."""
    y, mo, d, hm = int(as_of[0:4]), int(as_of[5:7]), int(as_of[8:10]), as_of[11:16]
    stamp = f"{d} {MONTHS[mo - 1]} {y}, {hm} IST"
    return f"as of {stamp}" if source == "live" else f"ERA5 reanalysis for {stamp}"


def sentence(name: str, source: str, as_of: str, speed_kmh: float, bearing_deg: float, in_path: list[dict]) -> str:
    direction, when, v = compass(bearing_deg), when_text(source, as_of), f"{speed_kmh:.0f}"
    if speed_kmh < CALM_KMH:
        return (f"Winds at the {name} cluster are near calm ({v} km/h, {when}), so the plume is likely to stay close "
                f"to the plants, drifting {direction}.")
    if in_path:
        # "the town of Korba" when the town shares the cluster's name
        toward = " and ".join(f"the town of {t['name']}" if t["name"] == name else t["name"] for t in in_path[:2])
        return f"The {name} cluster's plume is likely heading {direction} toward {toward} (wind {v} km/h, {when})."
    return (f"The {name} cluster's plume is likely heading {direction}; no town of over 50,000 people lies within "
            f"{CONE_KM} km in that direction (wind {v} km/h, {when}).")


def trace(name: str, lat: float, lon: float, candidates: list[dict], source: str, as_of: str,
          speed_kmh: float, from_deg: float) -> dict:
    """GET /clusters/{id}/wind response for one wind value."""
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


def latest_era5() -> pd.DataFrame:
    w = pd.read_parquet(WEATHER_PATH).dropna(subset=["wind_speed", "wind_dir"])
    return w.sort_values("date").groupby("cluster").tail(1).set_index("cluster")


def build(cid: str, name: str, lat: float, lon: float, era5: pd.DataFrame, towns: pd.DataFrame) -> dict:
    r = era5.loc[cid]
    day = pd.Timestamp(r["date"])
    ist = day + pd.Timedelta(hours=ERA5_HOUR_UTC, minutes=330)
    as_of = f"{ist:%Y-%m-%dT%H:%M}+05:30"
    # Work from the values as exported (6 significant digits, as to_json.clean writes them) so the API, which
    # recomputes the trace from this file for live winds, gets exactly this trace for the ERA5 wind.
    lat, lon = float(f"{lat:.6g}"), float(f"{lon:.6g}")
    speed_kmh, from_deg = round(float(r["wind_speed"]) * 3.6, 1), round(float(r["wind_dir"]), 1)
    cands = candidate_towns(lat, lon, towns)
    return {
        "id": cid,
        "name": name,
        "lat": lat,
        "lon": lon,
        "era5": {"date": f"{day:%Y-%m-%d}", "time_utc": f"{ERA5_HOUR_UTC:02d}:00", "speed_kmh": speed_kmh, "from_deg": from_deg},
        "cone": {"half_angle_deg": CONE_HALF_DEG, "length_km": CONE_KM, "max_towns": MAX_TOWNS,
                 "min_town_population": towns_mod.MIN_POPULATION},
        "towns_within_cone_length": cands,
        "trace": trace(name, lat, lon, cands, "era5", as_of, speed_kmh, from_deg),
    }


def load_towns() -> pd.DataFrame:
    return pd.read_csv(towns_mod.OUT_PATH, encoding="utf-8")


if __name__ == "__main__":
    from src.ingest.satellite import cluster_centroids, load_plants

    era5, towns = latest_era5(), load_towns()
    for c, (lo, la) in cluster_centroids(load_plants()).items():
        print(build(c, c.title(), la, lo, era5, towns)["trace"]["sentence"])
