"""Indian state / union territory of every plant in config/all_coal_plants_india.csv (point in polygon).

Boundaries: geoBoundaries gbOpen IND ADM1 (boundaryID IND-ADM1-1811400), source "DataMeet India community,
Election Commission of India", licence CC BY 2.5 IN (both as stated in the geoBoundaries metadata, saved next
to the download). 36 units; Ladakh (IN-LA) and Telangana (IN-TG) are separate units, Dadra and Nagar Haveli
and Daman and Diu is one. The full-resolution file is used (the simplified one moves borders by kilometres, and
the Singrauli plants sit on the Madhya Pradesh / Uttar Pradesh border).

Writes (committed, so the export needs neither the 46 MB download nor a geometry library):
  config/india_states.csv   code, name, lat, lon   code = the file's shapeISO; name = shapeName without
                            diacritics; lat/lon = area centroid of the unit's largest polygon (planar, in degrees)
  config/plant_states.csv   name, state_code       one row per plant of all_coal_plants_india.csv
A plant outside every polygon (none at present) takes the unit with the nearest boundary vertex if that is
within NEAREST_KM, else the build fails.

Usage (from pipeline/):
    python -m src.ingest.states            # downloads the boundaries if missing
"""

import json
import logging
import unicodedata
from pathlib import Path

import pandas as pd
import requests

from src.ingest.plants import INDIA_CSV
from src.ingest.satellite import haversine_km

log = logging.getLogger(__name__)

PIPELINE_DIR = Path(__file__).resolve().parents[2]
RAW_DIR = PIPELINE_DIR / "data" / "raw" / "boundaries"
GEOJSON_PATH = RAW_DIR / "geoBoundaries-IND-ADM1.geojson"
STATES_CSV = PIPELINE_DIR / "config" / "india_states.csv"
PLANT_STATES_CSV = PIPELINE_DIR / "config" / "plant_states.csv"

RELEASE = "9469f09"  # geoBoundaries commit the API pointed to on download (build date Dec 12, 2023)
GEOJSON_URL = f"https://github.com/wmgeolab/geoBoundaries/raw/{RELEASE}/releaseData/gbOpen/IND/ADM1/geoBoundaries-IND-ADM1.geojson"
METADATA_URL = "https://www.geoboundaries.org/api/current/gbOpen/IND/ADM1/"
N_UNITS = 36
NEAREST_KM = 5

SOURCE = {
    "id": "geoboundaries_ind_adm1",
    "name": "geoBoundaries gbOpen India ADM1 (states and union territories; source: DataMeet India community, "
            "Election Commission of India)",
    "used_for": "state / union territory of each coal plant (plants_india.json, states.json) and state centroids",
    "access": "geoboundaries.org/api/current/gbOpen/IND/ADM1 (boundaryID IND-ADM1-1811400)",
    "license": "CC BY 2.5 IN",
    "citation": "Runfola, D. et al. (2020): geoBoundaries: A global database of political administrative boundaries. "
                "PLoS ONE 15(4): e0231866. Boundaries: DataMeet India community (github.com/datameet/maps).",
    "doi": "10.1371/journal.pone.0231866",
}


def plain(name: str) -> str:
    """'Chhattīsgarh' -> 'Chhattisgarh' (the file spells names with macrons)."""
    return "".join(c for c in unicodedata.normalize("NFKD", name) if not unicodedata.combining(c))


def download() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    for url, path in ((GEOJSON_URL, GEOJSON_PATH), (METADATA_URL, RAW_DIR / "geoBoundaries-IND-ADM1-metaData.json")):
        if not path.exists():
            log.info("downloading %s", url)
            r = requests.get(url, timeout=300)
            r.raise_for_status()
            path.write_bytes(r.content)


def load_units(path: Path = GEOJSON_PATH) -> list[dict]:
    """[{code, name, polygons}] with polygons = list of polygons, each a list of rings of (lon, lat)."""
    features = json.loads(path.read_text(encoding="utf-8"))["features"]
    units = []
    for f in features:
        g = f["geometry"]
        polygons = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        units.append({"code": f["properties"]["shapeISO"], "name": plain(f["properties"]["shapeName"]), "polygons": polygons})
    assert len(units) == N_UNITS and len({u["code"] for u in units}) == N_UNITS, len(units)
    return sorted(units, key=lambda u: u["name"])


def in_ring(lon: float, lat: float, ring: list) -> bool:
    """Ray casting (even-odd)."""
    inside = False
    x1, y1 = ring[-1][0], ring[-1][1]
    for p in ring:
        x2, y2 = p[0], p[1]
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            inside = not inside
        x1, y1 = x2, y2
    return inside


def in_polygon(lon: float, lat: float, polygon: list) -> bool:
    """Inside the outer ring and in none of the holes."""
    return in_ring(lon, lat, polygon[0]) and not any(in_ring(lon, lat, hole) for hole in polygon[1:])


def bbox(polygon: list) -> tuple[float, float, float, float]:
    xs, ys = [p[0] for p in polygon[0]], [p[1] for p in polygon[0]]
    return min(xs), min(ys), max(xs), max(ys)


def ring_area_centroid(ring: list) -> tuple[float, float, float]:
    """(|area|, lon, lat) of a ring by the shoelace formula, planar in degrees."""
    a = cx = cy = 0.0
    x1, y1 = ring[-1][0], ring[-1][1]
    for p in ring:
        x2, y2 = p[0], p[1]
        cross = x1 * y2 - x2 * y1
        a += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
        x1, y1 = x2, y2
    return abs(a) / 2, cx / (3 * a), cy / (3 * a)


def centroid(unit: dict) -> tuple[float, float]:
    """(lat, lon) of the largest polygon's outer ring."""
    _, lon, lat = max(ring_area_centroid(poly[0]) for poly in unit["polygons"])
    return round(lat, 4), round(lon, 4)


def locate(lat: float, lon: float, units: list[dict], boxes: dict) -> str | None:
    for u in units:
        for poly, (x0, y0, x1, y1) in zip(u["polygons"], boxes[u["code"]]):
            if x0 <= lon <= x1 and y0 <= lat <= y1 and in_polygon(lon, lat, poly):
                return u["code"]
    return None


def nearest(lat: float, lon: float, units: list[dict]) -> tuple[str, float]:
    here = {"lat": lat, "lon": lon}
    return min(((u["code"], haversine_km(here, {"lat": p[1], "lon": p[0]}))
                for u in units for poly in u["polygons"] for p in poly[0]), key=lambda t: t[1])


def build() -> tuple[pd.DataFrame, pd.DataFrame]:
    units = load_units()
    boxes = {u["code"]: [bbox(poly) for poly in u["polygons"]] for u in units}
    states = pd.DataFrame([{"code": u["code"], "name": u["name"], "lat": centroid(u)[0], "lon": centroid(u)[1]} for u in units])
    rows = []
    for p in pd.read_csv(INDIA_CSV).to_dict("records"):
        code = locate(p["lat"], p["lon"], units, boxes)
        if code is None:
            code, km = nearest(p["lat"], p["lon"], units)
            assert km <= NEAREST_KM, (p["name"], code, km)
            log.warning("%s is outside every polygon; nearest boundary %s at %.2f km", p["name"], code, km)
        rows.append({"name": p["name"], "state_code": code})
    return states, pd.DataFrame(rows)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    download()
    states, plants = build()
    states.to_csv(STATES_CSV, index=False, encoding="utf-8", lineterminator="\n")
    plants.to_csv(PLANT_STATES_CSV, index=False, encoding="utf-8", lineterminator="\n")
    log.info("wrote %d units to %s and %d plants to %s", len(states), STATES_CSV, len(plants), PLANT_STATES_CSV)


if __name__ == "__main__":
    main()
