"""Daily ERA5 weather at each cluster centroid at the Sentinel-5P overpass time, via Google Earth Engine.

Source: ECMWF/ERA5/HOURLY (0.25 deg). ERA5-Land has no boundary layer height, so it is not used.
One value per day from the 08:00 UTC image: TROPOMI crosses at ~13:30 local solar time, which is
~08:00 UTC at the cluster longitudes (69-88 E). Values are sampled at the cluster centroid
(same centroids as satellite.py).

Columns: date, cluster, u10, v10 (m/s), wind_speed (m/s), wind_dir (deg, direction the wind blows
FROM, 0 = north, clockwise), blh (boundary layer height, m).

Usage (from pipeline/):
    python -m src.ingest.weather [--start 2019-01-01] [--end YYYY-MM-DD]
"""

import argparse
import logging
import os
from datetime import date
from pathlib import Path

import ee
import numpy as np
import pandas as pd
from dotenv import load_dotenv

from src.ingest.satellite import PIPELINE_DIR, cluster_centroids, load_plants, with_retry

log = logging.getLogger(__name__)

OUT_PATH = PIPELINE_DIR / "data" / "processed" / "weather_daily.parquet"
COLLECTION = "ECMWF/ERA5/HOURLY"
HOUR_UTC = 8
BANDS = {"u_component_of_wind_10m": "u10", "v_component_of_wind_10m": "v10", "boundary_layer_height": "blh"}
SCALE_M = 27830  # 0.25 deg

COLUMNS = ["date", "cluster", "u10", "v10", "wind_speed", "wind_dir", "blh"]


def centroid_points() -> ee.FeatureCollection:
    return ee.FeatureCollection([ee.Feature(ee.Geometry.Point([lon, lat]), {"cluster": c})
                                 for c, (lon, lat) in cluster_centroids(load_plants()).items()])


def sample_range(start: date, end: date, points: ee.FeatureCollection) -> list[dict]:
    """All 08:00 UTC images in [start, end) sampled at the points, in one request."""
    ic = (ee.ImageCollection(COLLECTION).filterDate(start.isoformat(), end.isoformat())
          .filter(ee.Filter.calendarRange(HOUR_UTC, HOUR_UTC, "hour")).select(list(BANDS), list(BANDS.values())))

    def per_image(img):
        day = img.date().format("YYYY-MM-dd")
        return img.reduceRegions(points, ee.Reducer.first(), scale=SCALE_M).map(
            lambda f: f.set("date", day).setGeometry(None))

    return [f["properties"] for f in ic.map(per_image).flatten().getInfo()["features"]]


def to_table(records: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(records)
    df["date"] = pd.to_datetime(df["date"])
    df["wind_speed"] = np.hypot(df["u10"], df["v10"])
    df["wind_dir"] = np.degrees(np.arctan2(-df["u10"], -df["v10"])) % 360
    return df[COLUMNS].sort_values(["cluster", "date"]).reset_index(drop=True)


def run(start: date, end: date | None = None, out_path: Path = OUT_PATH) -> pd.DataFrame:
    load_dotenv(PIPELINE_DIR.parent / ".env")
    ee.Initialize(project=os.environ["GEE_PROJECT_ID"])
    points = centroid_points()
    if end is None:
        last_ms = ee.ImageCollection(COLLECTION).filterDate("2026-01-01", "2100-01-01").aggregate_max(
            "system:time_start").getInfo()
        end = pd.Timestamp(last_ms, unit="ms").date()

    records = []
    for year in range(start.year, end.year + 1):
        a, b = max(start, date(year, 1, 1)), min(end + pd.Timedelta(days=1), date(year + 1, 1, 1))
        try:
            records += with_retry(sample_range, a, b, points)
        except Exception as e:
            log.warning("%d as one batch failed (%s); retrying per month", year, e)
            for m in pd.date_range(a.replace(day=1), b, freq="MS", inclusive="left"):
                nxt = (m + pd.offsets.MonthBegin(1)).date()
                records += with_retry(sample_range, max(m.date(), a), min(nxt, b), points)
        log.info("%d done (%d records)", year, len(records))

    df = to_table(records)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out_path, index=False)
    log.info("wrote %d rows (%s .. %s) to %s", len(df), df["date"].min().date(), df["date"].max().date(), out_path)
    return df


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--start", type=date.fromisoformat, default=date(2019, 1, 1))
    parser.add_argument("--end", type=date.fromisoformat, default=None, help="default: latest ERA5 image")
    args = parser.parse_args()
    run(args.start, args.end)


if __name__ == "__main__":
    main()
