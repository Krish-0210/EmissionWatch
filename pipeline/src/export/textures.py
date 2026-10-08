"""Textures for the frontend globe.

1. no2_india_2024.webp: 2024 mean tropospheric NO2 column (COPERNICUS/S5P/OFFL/L3_NO2) over
   lon 68-98, lat 6-37 on a 0.04 degree equirectangular grid (north up). Colour ramp: transparent
   below the 60th percentile, then #FF8A3D (ember) to #FF5A3C with alpha rising to 0.95 at the
   99.5th percentile. The value range is written to no2_india_2024.json.
2. land_mask.png: Natural Earth 110m land (public domain) rasterised to 720 x 360 equirectangular
   (lon -180..180, lat 90..-90). Red channel = land, green channel = India (Natural Earth admin-0,
   India point-of-view file when available).

Usage (from pipeline/):
    python -m src.export.textures [--skip-no2] [--skip-land]
"""

import argparse
import json
import logging
import os
from pathlib import Path

import numpy as np
import requests
from dotenv import load_dotenv
from PIL import Image, ImageDraw

PIPELINE_DIR = Path(__file__).resolve().parents[2]
OUT_DIR = PIPELINE_DIR.parent / "frontend" / "public" / "textures"
NE_DIR = PIPELINE_DIR / "data" / "raw" / "naturalearth"

LON0, LON1, LAT0, LAT1 = 68.0, 98.0, 6.0, 37.0
RES = 0.04
NO2_BAND = "tropospheric_NO2_column_number_density"

NE_BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
NE_LAND = "ne_110m_land.geojson"
NE_COUNTRIES = ["ne_110m_admin_0_countries_ind.geojson", "ne_110m_admin_0_countries.geojson"]
MASK_W, MASK_H = 720, 360

log = logging.getLogger("textures")


def export_no2() -> None:
    import ee

    load_dotenv(PIPELINE_DIR.parent / ".env")
    ee.Initialize(project=os.environ["GEE_PROJECT_ID"])

    img = (
        ee.ImageCollection("COPERNICUS/S5P/OFFL/L3_NO2")
        .filterDate("2024-01-01", "2025-01-01")
        .select(NO2_BAND)
        .mean()
    )
    w = round((LON1 - LON0) / RES)
    h = round((LAT1 - LAT0) / RES)
    log.info("computePixels %d x %d", w, h)
    arr = ee.data.computePixels(
        {
            "expression": img,
            "fileFormat": "NUMPY_NDARRAY",
            "grid": {
                "dimensions": {"width": w, "height": h},
                "affineTransform": {
                    "scaleX": RES,
                    "shearX": 0,
                    "translateX": LON0,
                    "shearY": 0,
                    "scaleY": -RES,
                    "translateY": LAT1,
                },
                "crsCode": "EPSG:4326",
            },
        }
    )
    v = np.asarray(arr[NO2_BAND], dtype="float64")
    valid = np.isfinite(v)
    lo, hi = np.percentile(v[valid], [60, 99.5])
    t = np.clip((np.where(valid, v, lo) - lo) / (hi - lo), 0, 1)

    c0 = np.array([0xFF, 0x8A, 0x3D], dtype="float64")
    c1 = np.array([0xFF, 0x5A, 0x3C], dtype="float64")
    rgb = c0 + (c1 - c0) * t[..., None]
    alpha = 0.95 * t**0.8 * 255
    rgba = np.dstack([rgb, alpha]).round().astype("uint8")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # WebP (lossy colour, lossless alpha): ~4x smaller than PNG for the same ramp.
    Image.fromarray(rgba, "RGBA").save(OUT_DIR / "no2_india_2024.webp", quality=90, alpha_quality=100, method=6)
    meta = {
        "source": "COPERNICUS/S5P/OFFL/L3_NO2, tropospheric_NO2_column_number_density, mean 2024-01-01..2024-12-31",
        "units": "mol/m^2",
        "bounds": {"lon": [LON0, LON1], "lat": [LAT0, LAT1]},
        "resolution_deg": RES,
        "ramp": {"transparent_below": float(lo), "full_at": float(hi), "percentiles": [60, 99.5]},
        "max": float(np.nanmax(v)),
    }
    (OUT_DIR / "no2_india_2024.json").write_text(json.dumps(meta, indent=1))
    log.info("no2: lo %.3g hi %.3g max %.3g mol/m2", lo, hi, meta["max"])


def _fetch(name: str) -> dict | None:
    NE_DIR.mkdir(parents=True, exist_ok=True)
    path = NE_DIR / name
    if not path.exists():
        r = requests.get(NE_BASE + name, timeout=60)
        if r.status_code != 200:
            log.warning("%s: HTTP %d", name, r.status_code)
            return None
        path.write_bytes(r.content)
    return json.loads(path.read_text(encoding="utf-8"))


def _rings(geom: dict):
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    for poly in polys:
        yield poly[0], poly[1:]  # exterior, holes


def _draw(draw: ImageDraw.ImageDraw, geom: dict) -> None:
    px = lambda ring: [((lon + 180) / 360 * MASK_W, (90 - lat) / 180 * MASK_H) for lon, lat in ring]
    for ext, holes in _rings(geom):
        draw.polygon(px(ext), fill=255)
        for hole in holes:
            draw.polygon(px(hole), fill=0)


def export_land() -> None:
    land = _fetch(NE_LAND)
    if land is None:
        raise RuntimeError("could not download Natural Earth land")
    land_img = Image.new("L", (MASK_W, MASK_H), 0)
    d = ImageDraw.Draw(land_img)
    for f in land["features"]:
        _draw(d, f["geometry"])

    india_img = Image.new("L", (MASK_W, MASK_H), 0)
    for name in NE_COUNTRIES:
        countries = _fetch(name)
        if countries is None:
            continue
        feats = [f for f in countries["features"] if f["properties"].get("ADM0_A3") == "IND"]
        if feats:
            d = ImageDraw.Draw(india_img)
            for f in feats:
                _draw(d, f["geometry"])
            log.info("india from %s", name)
            break

    zero = Image.new("L", (MASK_W, MASK_H), 0)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    Image.merge("RGB", (land_img, india_img, zero)).save(OUT_DIR / "land_mask.png", optimize=True)
    log.info("land mask %d x %d", MASK_W, MASK_H)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-no2", action="store_true")
    ap.add_argument("--skip-land", action="store_true")
    a = ap.parse_args()
    if not a.skip_land:
        export_land()
    if not a.skip_no2:
        export_no2()


if __name__ == "__main__":
    main()
