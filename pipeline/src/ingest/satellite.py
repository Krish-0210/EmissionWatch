"""Fetch Sentinel-5P TROPOMI NO2 columns around plants via Google Earth Engine.

Monthly tropospheric NO2 (mol/m^2) from COPERNICUS/S5P/OFFL/L3_NO2 for:
  - each cluster in plants.yaml (centroid of its operating plants): 10 km and 20 km disks, plus a
    background annulus 50-80 km out that excludes a 25 km buffer around every registry plant and
    every operating Indian coal plant >= 500 MW in config/all_coal_plants_india.csv
  - each plant: 10 km disk (flagged `overlapping` when another plant is < 15 km away)

How a month is built: the orbits for each day are averaged into one daily image,
and the month value is the mean of those daily images. valid_fraction is the
share of (pixel, day) pairs in the 20 km disk that have a valid retrieval, i.e. how
much of the month cloud, monsoon or swath gaps removed.

background_valid_fraction = (annulus area left after exclusion / full annulus area)
x (valid share of the remaining pixel-days). A cluster gets background_flag=True when the
median of this over all months is below BACKGROUND_MIN_VALID: its background then rests on
little data.

Daily mode (--daily) writes no2_daily.parquet: per cluster and day, ring_20km and background from
that day's orbits, enhancement, valid_fraction (share of 20 km disk pixels with a valid
retrieval) and background_valid_fraction (annulus area fraction x valid share).

Usage (from pipeline/):
    python -m src.ingest.satellite [--start 2019-01] [--end 2026-08]
    python -m src.ingest.satellite --daily [--start 2019-01-01] [--end YYYY-MM-DD]
"""

import argparse
import logging
import math
import os
import time
from datetime import date, datetime, timezone
from pathlib import Path

import ee
import pandas as pd
import yaml
from dotenv import load_dotenv

log = logging.getLogger(__name__)

PIPELINE_DIR = Path(__file__).resolve().parents[2]
PLANTS_PATH = PIPELINE_DIR / "config" / "plants.yaml"
INDIA_CSV = PIPELINE_DIR / "config" / "all_coal_plants_india.csv"
OUT_PATH = PIPELINE_DIR / "data" / "processed" / "no2_monthly.parquet"
DAILY_OUT_PATH = PIPELINE_DIR / "data" / "processed" / "no2_daily.parquet"
DAILY_PARTS_DIR = PIPELINE_DIR / "data" / "processed" / "no2_daily_parts"  # per-year raw records (resume)

COLLECTION = "COPERNICUS/S5P/OFFL/L3_NO2"
BAND = "tropospheric_NO2_column_number_density"
SCALE_M = 1113.2  # native grid of the GEE L3 product (0.01 deg)
BACKGROUND_KM = (50, 80)
EXCLUDE_KM = 25
OVERLAP_KM = 15
BACKGROUND_MIN_VALID = 0.3

COLUMNS = ["month", "entity_type", "entity_id", "ring_10km", "ring_20km", "background",
           "enhancement", "valid_fraction", "background_valid_fraction", "background_flag", "overlapping"]
DAILY_COLUMNS = ["date", "cluster", "ring_20km", "background", "enhancement", "valid_fraction",
                 "background_valid_fraction"]


def load_plants(path: Path = PLANTS_PATH) -> list[dict]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))["plants"]


def haversine_km(a: dict, b: dict) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a["lat"], a["lon"], b["lat"], b["lon"]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def cluster_centroids(plants: list[dict]) -> dict[str, tuple[float, float]]:
    """(lon, lat) per cluster: mean of its operating plants (retired plants would pull it off-centre)."""
    out = {}
    for c in sorted({p["cluster"] for p in plants}):
        members = [p for p in plants if p["cluster"] == c and p.get("status", "operating") == "operating"]
        out[c] = (sum(p["lon"] for p in members) / len(members), sum(p["lat"] for p in members) / len(members))
    return out


def build_regions(plants: list[dict], other_plants: list[tuple[float, float]] = ()) -> ee.FeatureCollection:
    """One feature per (entity, region) that gets a mean reduction.

    other_plants: extra (lon, lat) points kept out of the background annulus.
    """
    point = lambda p: ee.Geometry.Point([p["lon"], p["lat"]])
    points = [point(p) for p in plants] + [ee.Geometry.Point([lon, lat]) for lon, lat in other_plants]
    exclusion = ee.FeatureCollection([ee.Feature(pt.buffer(EXCLUDE_KM * 1000)) for pt in points]).union(1).geometry()

    feats = []
    for c, (lon, lat) in cluster_centroids(plants).items():
        centroid = ee.Geometry.Point([lon, lat])
        full = centroid.buffer(BACKGROUND_KM[1] * 1000).difference(centroid.buffer(BACKGROUND_KM[0] * 1000), 1)
        annulus = full.difference(exclusion, 1)
        area_fraction = annulus.area(1).divide(full.area(1))
        for region, geom in (("ring_10km", centroid.buffer(10_000)),
                             ("ring_20km", centroid.buffer(20_000)),
                             ("background", annulus)):
            props = {"entity_type": "cluster", "entity_id": c, "region": region}
            feat = ee.Feature(geom, props)
            if region == "background":
                feat = feat.set("area_fraction", area_fraction)
            feats.append(feat)
    for p in plants:
        feats.append(ee.Feature(point(p).buffer(10_000),
                                {"entity_type": "plant", "entity_id": p["id"], "region": "ring_10km"}))
    return ee.FeatureCollection(feats)


def monthly_image(collection: ee.ImageCollection, month_start: ee.Date) -> ee.Image:
    """Bands: no2 (mean of daily means, masked if no valid day) and valid (fraction of valid days)."""
    n_days = month_start.advance(1, "month").difference(month_start, "day").round()
    empty = ee.Image.constant(0).toFloat().rename(BAND).updateMask(0)

    def daily(i):
        start = month_start.advance(i, "day")
        day = collection.filterDate(start, start.advance(1, "day")).select(BAND).map(lambda img: img.toFloat())
        # Merge with a fully masked image so days with no overpass still yield a band.
        return day.merge(ee.ImageCollection([empty])).mean().rename(BAND)

    days = ee.ImageCollection(ee.List.sequence(0, n_days.subtract(1)).map(daily))
    no2 = days.mean().rename("no2")
    valid = days.map(lambda img: img.mask().gt(0)).sum().divide(n_days).unmask(0).rename("valid")
    return no2.addBands(valid)


def reduce_months(months: list[date], regions: ee.FeatureCollection, collection: ee.ImageCollection) -> list[dict]:
    """Reduce every region for the given months in a single server-side request."""
    def per_month(m):
        m = ee.Date(m)
        stats = monthly_image(collection, m).reduceRegions(regions, ee.Reducer.mean(), scale=SCALE_M)
        return stats.map(lambda f: f.set("month", m.format("YYYY-MM")).setGeometry(None))

    starts = ee.List([ee.Date(m.isoformat()) for m in months])
    fc = ee.FeatureCollection(starts.map(per_month)).flatten()
    return [f["properties"] for f in fc.getInfo()["features"]]


def with_retry(fn, *args, attempts: int = 4, wait: float = 10):
    for attempt in range(1, attempts + 1):
        try:
            return fn(*args)
        except Exception as e:  # ee.EEException, HTTP and socket errors
            if attempt == attempts:
                raise
            log.warning("attempt %d/%d failed: %s", attempt, attempts, e)
            time.sleep(wait * attempt)


def latest_full_month(collection: ee.ImageCollection) -> date:
    last_ms = collection.aggregate_max("system:time_start").getInfo()
    last = datetime.fromtimestamp(last_ms / 1000, tz=timezone.utc).date()
    first_of_month = last.replace(day=1)
    # The last image's month is complete only if that image is from the month's final day.
    nxt = (first_of_month.replace(year=first_of_month.year + 1, month=1) if first_of_month.month == 12
           else first_of_month.replace(month=first_of_month.month + 1))
    if (nxt - last).days == 1:
        return first_of_month
    return (first_of_month - pd.DateOffset(months=1)).date()


def to_table(records: list[dict], plants: list[dict]) -> pd.DataFrame:
    raw = pd.DataFrame(records)
    wide = raw.pivot_table(index=["month", "entity_type", "entity_id"], columns="region",
                           values="no2", aggfunc="first").reset_index()
    valid = raw[raw.region.isin(["ring_20km"]) | (raw.entity_type == "plant")]
    # valid_fraction is defined on ring_20km; plants only have a 10 km disk, so use that for them.
    wide = wide.merge(valid[["month", "entity_type", "entity_id", "valid"]].rename(columns={"valid": "valid_fraction"}),
                      on=["month", "entity_type", "entity_id"], how="left")
    bg = raw[raw.region == "background"].assign(background_valid_fraction=lambda d: d["area_fraction"] * d["valid"])
    wide = wide.merge(bg[["month", "entity_type", "entity_id", "background_valid_fraction"]],
                      on=["month", "entity_type", "entity_id"], how="left")
    median_bg = wide.groupby("entity_id")["background_valid_fraction"].median()
    flag = (median_bg < BACKGROUND_MIN_VALID).astype("boolean")
    wide["background_flag"] = wide["entity_id"].map(flag).astype("boolean")
    wide.loc[wide["entity_type"] == "plant", "background_flag"] = pd.NA
    for col in ("ring_10km", "ring_20km", "background"):
        if col not in wide:
            wide[col] = float("nan")
    wide["enhancement"] = wide["ring_20km"] - wide["background"]

    overlapping = {p["id"]: any(q is not p and haversine_km(p, q) < OVERLAP_KM for q in plants) for p in plants}
    wide["overlapping"] = wide.apply(
        lambda r: overlapping.get(r.entity_id) if r.entity_type == "plant" else None, axis=1).astype("boolean")
    wide["month"] = pd.to_datetime(wide["month"])
    return wide[COLUMNS].sort_values(["entity_type", "entity_id", "month"]).reset_index(drop=True)


def run(start: date, end: date | None = None, out_path: Path = OUT_PATH) -> pd.DataFrame:
    load_dotenv(PIPELINE_DIR.parent / ".env")
    ee.Initialize(project=os.environ["GEE_PROJECT_ID"])

    plants = load_plants()
    india = pd.read_csv(INDIA_CSV)
    regions = build_regions(plants, list(zip(india["lon"], india["lat"])))
    collection = ee.ImageCollection(COLLECTION).filterBounds(regions.geometry().bounds())
    end = end or latest_full_month(collection)
    months = [d.date() for d in pd.date_range(start, end, freq="MS")]
    log.info("extracting %d months (%s .. %s) for %d regions", len(months), months[0], months[-1], regions.size().getInfo())

    records = []
    for year in sorted({m.year for m in months}):
        batch = [m for m in months if m.year == year]
        try:
            records += with_retry(reduce_months, batch, regions, collection)
        except Exception as e:
            # A year is too heavy for one request: fall back to one request per month.
            log.warning("%d as one batch failed (%s); retrying per month", year, e)
            for m in batch:
                records += with_retry(reduce_months, [m], regions, collection)
        log.info("%d done (%d records)", year, len(records))

    df = to_table(records, plants)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out_path, index=False)
    log.info("wrote %d rows to %s", len(df), out_path)
    return df


def daily_image(collection: ee.ImageCollection, day: ee.Date) -> ee.Image:
    """Bands: no2 (mean of the day's orbits, masked where none is valid) and valid (1/0 per pixel)."""
    empty = ee.Image.constant(0).toFloat().rename(BAND).updateMask(0)
    imgs = collection.filterDate(day, day.advance(1, "day")).select(BAND).map(lambda img: img.toFloat())
    no2 = imgs.merge(ee.ImageCollection([empty])).mean().rename("no2")
    return no2.addBands(no2.mask().gt(0).unmask(0).rename("valid"))


def reduce_days(days: list[date], regions: ee.FeatureCollection, collection: ee.ImageCollection) -> list[dict]:
    """Reduce every region for the given days in one request.

    The days are stacked as bands (no2_i, valid_i) of one image and reduced once: a reduceRegions per
    day trips EE's "Too many concurrent aggregations" limit. Band masks are per band, so each day's
    mean uses only that day's valid pixels.
    """
    stack = ee.Image.cat([daily_image(collection, ee.Date(d.isoformat())).rename([f"no2_{i}", f"valid_{i}"])
                          for i, d in enumerate(days)])
    fc = stack.reduceRegions(regions, ee.Reducer.mean(), scale=SCALE_M).map(lambda f: f.setGeometry(None))
    records = []
    for f in fc.getInfo()["features"]:
        p = f["properties"]
        base = {k: p[k] for k in ("entity_type", "entity_id", "region") if k in p}
        if "area_fraction" in p:
            base["area_fraction"] = p["area_fraction"]
        for i, d in enumerate(days):
            records.append({**base, "date": d.isoformat(), "no2": p.get(f"no2_{i}"), "valid": p.get(f"valid_{i}")})
    return records


def to_daily_table(records: list[dict]) -> pd.DataFrame:
    raw = pd.DataFrame(records)
    wide = raw.pivot_table(index=["date", "entity_id"], columns="region", values="no2", aggfunc="first")
    wide = wide.reindex(columns=["ring_20km", "background"]).reset_index()
    ring = raw[raw.region == "ring_20km"][["date", "entity_id", "valid"]].rename(columns={"valid": "valid_fraction"})
    bg = raw[raw.region == "background"].assign(background_valid_fraction=lambda d: d["area_fraction"] * d["valid"])
    wide = (ring.merge(wide, on=["date", "entity_id"], how="left")
            .merge(bg[["date", "entity_id", "background_valid_fraction"]], on=["date", "entity_id"], how="left"))
    wide["enhancement"] = wide["ring_20km"] - wide["background"]
    wide["date"] = pd.to_datetime(wide["date"])
    wide = wide.rename(columns={"entity_id": "cluster"})
    return wide[DAILY_COLUMNS].sort_values(["cluster", "date"]).reset_index(drop=True)


def run_daily(start: date, end: date | None = None, out_path: Path = DAILY_OUT_PATH) -> pd.DataFrame:
    """Daily ring_20km / background per cluster, one request per year (per month on failure), checkpointed per year."""
    load_dotenv(PIPELINE_DIR.parent / ".env")
    ee.Initialize(project=os.environ["GEE_PROJECT_ID"])

    india = pd.read_csv(INDIA_CSV)
    regions = (build_regions(load_plants(), list(zip(india["lon"], india["lat"])))
               .filter(ee.Filter.eq("entity_type", "cluster")).filter(ee.Filter.neq("region", "ring_10km")))
    collection = ee.ImageCollection(COLLECTION).filterBounds(regions.geometry().bounds())
    if end is None:
        last_ms = collection.aggregate_max("system:time_start").getInfo()
        end = datetime.fromtimestamp(last_ms / 1000, tz=timezone.utc).date()
    days = [d.date() for d in pd.date_range(start, end, freq="D")]
    log.info("extracting %d days (%s .. %s)", len(days), days[0], days[-1])

    # One request per year; per month if the year fails. Each finished year is checkpointed so reruns resume.
    DAILY_PARTS_DIR.mkdir(parents=True, exist_ok=True)
    parts = []
    for year in sorted({d.year for d in days}):
        batch = [d for d in days if d.year == year]
        part = DAILY_PARTS_DIR / f"{year}_{batch[0]:%m%d}_{batch[-1]:%m%d}.parquet"
        if not part.exists():
            try:
                records = with_retry(reduce_days, batch, regions, collection, attempts=2)
            except Exception as e:
                log.warning("%d as one batch failed (%s); retrying per month", year, e)
                records = []
                for m in sorted({d.month for d in batch}):
                    records += with_retry(reduce_days, [d for d in batch if d.month == m], regions, collection,
                                          attempts=6, wait=30)
            pd.DataFrame(records).to_parquet(part, index=False)
        parts.append(pd.read_parquet(part))
        log.info("%d done (%d records)", year, len(parts[-1]))

    df = to_daily_table(pd.concat(parts, ignore_index=True).to_dict("records"))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out_path, index=False)
    log.info("wrote %d rows to %s", len(df), out_path)
    return df


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--daily", action="store_true", help="daily per-cluster values -> no2_daily.parquet")
    parser.add_argument("--start", default="2019-01", help="YYYY-MM, or YYYY-MM-DD with --daily")
    parser.add_argument("--end", default=None, help="default: latest full month (monthly) / latest day (--daily)")
    args = parser.parse_args()
    as_date = lambda s: date.fromisoformat(s if len(s) == 10 else s + "-01")
    end = as_date(args.end) if args.end else None
    if args.daily:
        run_daily(as_date(args.start), end)
    else:
        run(as_date(args.start), end)


if __name__ == "__main__":
    main()
