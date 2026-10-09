"""Textures for the frontend globe. All equirectangular (lon -180..180, lat 90..-90, north up)
unless noted.

1. no2_india_2024.webp: 2024 mean tropospheric NO2 column (COPERNICUS/S5P/OFFL/L3_NO2) over
   lon 68-98, lat 6-37 on a 0.04 degree grid. Colour ramp: transparent below the 60th percentile,
   then #FF8A3D (ember) to #FF5A3C with alpha rising to 0.95 at the 99.5th percentile. The value
   range is written to no2_india_2024.json.
2. no2_world_2024.webp: the same 2024 mean worldwide, 2048 x 1024 (~0.18 degree). Log ramp:
   transparent below the 90th percentile, ember -> hot red, full at the 99.9th (no2_world_2024.json).
3. earth_mask.webp: 2048 x 1024, lossless, drawn at 2x and downsampled (anti-aliased).
   Red = land, green = country land borders (ne_110m_admin_0_boundary_lines_land), blue = India.
4. night_lights.webp (3600 x 1800) and night_lights_1k.webp (1024 x 512): NASA Black Marble 2016,
   0.1 degree greyscale (public domain, NASA Earth Observatory). The dark floor is subtracted so only
   lights remain.
5. clouds.webp: NASA Blue Marble cloud composite (public domain, NASA Visible Earth), 2048 x 1024, grey.

Usage (from pipeline/):
    python -m src.export.textures [--skip-no2] [--skip-world] [--skip-earth] [--skip-nasa]
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
NE_BORDERS = "ne_110m_admin_0_boundary_lines_land.geojson"
EARTH_W, EARTH_H = 2048, 1024
WORLD_W, WORLD_H = 2048, 1024

NASA_DIR = PIPELINE_DIR / "data" / "raw" / "nasa"
BLACK_MARBLE = "https://eoimages.gsfc.nasa.gov/images/imagerecords/144000/144897/BlackMarble_2016_01deg_gray.jpg"
CLOUDS = "https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_2048.jpg"

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


def export_no2_world() -> None:
    import ee

    load_dotenv(PIPELINE_DIR.parent / ".env")
    ee.Initialize(project=os.environ["GEE_PROJECT_ID"])
    img = (
        ee.ImageCollection("COPERNICUS/S5P/OFFL/L3_NO2")
        .filterDate("2024-01-01", "2025-01-01")
        .select(NO2_BAND)
        .mean()
        .toFloat()
    )
    res = 360 / WORLD_W
    # One global request times out; 4 x 2 tiles of 512 x 512 run in parallel.
    TW, TH = WORLD_W // 4, WORLD_H // 2

    def tile(ij):
        i, j = ij
        arr = ee.data.computePixels(
            {
                "expression": img,
                "fileFormat": "NUMPY_NDARRAY",
                "grid": {
                    "dimensions": {"width": TW, "height": TH},
                    "affineTransform": {"scaleX": res, "shearX": 0, "translateX": -180 + i * TW * res, "shearY": 0, "scaleY": -res, "translateY": 90 - j * TH * res},
                    "crsCode": "EPSG:4326",
                },
            }
        )
        log.info("tile %d,%d done", i, j)
        return ij, np.asarray(arr[NO2_BAND], dtype="float64")

    from concurrent.futures import ThreadPoolExecutor

    log.info("computePixels world %d x %d in 8 tiles", WORLD_W, WORLD_H)
    v = np.full((WORLD_H, WORLD_W), np.nan)
    with ThreadPoolExecutor(8) as pool:
        for (i, j), a in pool.map(tile, [(i, j) for j in range(2) for i in range(4)]):
            v[j * TH : (j + 1) * TH, i * TW : (i + 1) * TW] = a
    valid = np.isfinite(v) & (v > 0)
    pct = (50, 90, 99, 99.9)
    p = dict(zip(pct, np.percentile(v[valid], pct)))
    # Log ramp from the 90th percentile (transparent) to the 99.9th (full): global hotspots only.
    lo, hi = p[90], p[99.9]
    t = np.clip((np.log(np.where(valid, v, lo)) - np.log(lo)) / (np.log(hi) - np.log(lo)), 0, 1)
    c0 = np.array([0xFF, 0x8A, 0x3D], dtype="float64")  # ember
    c1 = np.array([0xFF, 0x3B, 0x2F], dtype="float64")  # hot red
    rgb = c0 + (c1 - c0) * t[..., None]
    alpha = 0.9 * t**1.1 * 255
    rgba = np.dstack([rgb, alpha]).round().astype("uint8")
    Image.fromarray(rgba, "RGBA").save(OUT_DIR / "no2_world_2024.webp", quality=88, alpha_quality=90, method=6)
    meta = {
        "source": "COPERNICUS/S5P/OFFL/L3_NO2, tropospheric_NO2_column_number_density, mean 2024-01-01..2024-12-31",
        "units": "mol/m^2",
        "size": [WORLD_W, WORLD_H],
        "resolution_deg": res,
        "ramp": {"scale": "log", "transparent_below": float(lo), "full_at": float(hi), "percentiles": [90, 99.9]},
        "percentiles": {str(k): float(x) for k, x in p.items()},
        "max": float(np.nanmax(v)),
    }
    (OUT_DIR / "no2_world_2024.json").write_text(json.dumps(meta, indent=1))
    log.info("no2 world: p50 %.3g p90 %.3g p99 %.3g p99.9 %.3g max %.3g mol/m2", *p.values(), meta["max"])


def _lines(geom: dict):
    yield from ([geom["coordinates"]] if geom["type"] == "LineString" else geom["coordinates"])


def export_earth() -> None:
    """Anti-aliased land / borders / India mask: drawn at 2x, downsampled with Lanczos."""
    W, H = EARTH_W * 2, EARTH_H * 2
    px = lambda ring: [((lon + 180) / 360 * W, (90 - lat) / 180 * H) for lon, lat in ring]

    def fill(feats) -> Image.Image:
        img = Image.new("L", (W, H), 0)
        d = ImageDraw.Draw(img)
        for f in feats:
            for ext, holes in _rings(f["geometry"]):
                d.polygon(px(ext), fill=255)
                for hole in holes:
                    d.polygon(px(hole), fill=0)
        return img

    land, borders = _fetch(NE_LAND), _fetch(NE_BORDERS)
    if land is None or borders is None:
        raise RuntimeError("could not download Natural Earth land/borders")
    land_img = fill(land["features"])
    border_img = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(border_img)
    for f in borders["features"]:
        for line in _lines(f["geometry"]):
            d.line(px(line), fill=255, width=3)
    india_img = Image.new("L", (W, H), 0)
    for name in NE_COUNTRIES:
        feats = [f for f in (_fetch(name) or {}).get("features", []) if f["properties"].get("ADM0_A3") == "IND"]
        if feats:
            india_img = fill(feats)
            break
    size = (EARTH_W, EARTH_H)
    out = Image.merge("RGB", tuple(im.resize(size, Image.LANCZOS) for im in (land_img, border_img, india_img)))
    out.save(OUT_DIR / "earth_mask.webp", lossless=True, method=6)
    log.info("earth mask %d x %d", *size)


def _download(url: str) -> Path:
    NASA_DIR.mkdir(parents=True, exist_ok=True)
    path = NASA_DIR / url.rsplit("/", 1)[1]
    if not path.exists():
        r = requests.get(url, timeout=120)
        r.raise_for_status()
        path.write_bytes(r.content)
        log.info("downloaded %s (%d bytes)", path.name, len(r.content))
    return path


def export_nasa() -> None:
    # Night lights: subtract the dark land/ocean floor of the greyscale composite, keep only lights.
    g = np.asarray(Image.open(_download(BLACK_MARBLE)).convert("L"), dtype="float64")
    floor = np.percentile(g, 60)
    lights = np.clip((g - floor) / (255 - floor), 0, 1) ** 0.85 * 255
    img = Image.fromarray(lights.round().astype("uint8"), "L")
    img.save(OUT_DIR / "night_lights.webp", quality=82, method=6)
    img.resize((1024, 512), Image.LANCZOS).save(OUT_DIR / "night_lights_1k.webp", quality=82, method=6)
    log.info("night lights %d x %d (floor %.0f)", *img.size, floor)
    c = Image.open(_download(CLOUDS)).convert("L").resize((2048, 1024), Image.LANCZOS)
    c.save(OUT_DIR / "clouds.webp", quality=50, method=6)
    log.info("clouds %d x %d", *c.size)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-no2", action="store_true")
    ap.add_argument("--skip-world", action="store_true")
    ap.add_argument("--skip-earth", action="store_true")
    ap.add_argument("--skip-nasa", action="store_true")
    a = ap.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if not a.skip_earth:
        export_earth()
    if not a.skip_nasa:
        export_nasa()
    if not a.skip_no2:
        export_no2()
    if not a.skip_world:
        export_no2_world()


if __name__ == "__main__":
    main()
