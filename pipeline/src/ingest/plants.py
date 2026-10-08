"""Load the plant registry (GEM Global Coal Plant Tracker + config/plants.yaml).

Also builds config/all_coal_plants_india.csv: every operating Indian coal plant of
>= 500 MW (operating units only) from GEM's public API. satellite.py uses it to keep
other plants' plumes out of the background annulus.

Usage (from pipeline/):
    python -m src.ingest.plants build-india-csv
"""

import argparse
import logging
import time
from pathlib import Path

import pandas as pd
import requests
import yaml

log = logging.getLogger(__name__)

PIPELINE_DIR = Path(__file__).resolve().parents[2]
PLANTS_PATH = PIPELINE_DIR / "config" / "plants.yaml"
INDIA_CSV = PIPELINE_DIR / "config" / "all_coal_plants_india.csv"

GEM_ASSETS_URL = "https://api.globalenergymonitor.org/assets"
MIN_CAPACITY_MW = 500


def load_registry(path: Path = PLANTS_PATH) -> list[dict]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))["plants"]


def load_india_plants(path: Path = INDIA_CSV) -> pd.DataFrame:
    return pd.read_csv(path)


def fetch_gem_units(country: str = "India", page: int = 500) -> pd.DataFrame:
    """All coal units for a country from GEM's public assets API (one row per unit)."""
    session = requests.Session()
    session.headers["User-Agent"] = "Mozilla/5.0 (EmissionWatch research pipeline)"  # the API rejects the default UA
    units, offset = [], 0
    while True:
        resp = session.get(GEM_ASSETS_URL, params={"asset_class": "coal-plants", "country": country,
                                                    "limit": page, "offset": offset}, timeout=120)
        resp.raise_for_status()
        body = resp.json()
        units += body["results"]
        offset += body["count"]
        if body["count"] == 0 or offset >= body["total"]:
            break
        time.sleep(0.5)
    return pd.DataFrame(units)


def build_india_csv(out_path: Path = INDIA_CSV) -> pd.DataFrame:
    units = fetch_gem_units()
    op = units[units["operating_status"] == "operating"].copy()
    op["w_lat"] = op["latitude"] * op["capacity_value"]
    op["w_lon"] = op["longitude"] * op["capacity_value"]
    plants = op.groupby("location_id").agg(
        name=("project_name", "first"), capacity_mw=("capacity_value", "sum"),
        w_lat=("w_lat", "sum"), w_lon=("w_lon", "sum"), source=("wiki_url", "first")).reset_index()
    # Capacity-weighted mean of the unit coordinates (units of one plant sit within a few hundred metres).
    plants["lat"] = (plants["w_lat"] / plants["capacity_mw"]).round(6)
    plants["lon"] = (plants["w_lon"] / plants["capacity_mw"]).round(6)
    plants = plants[plants["capacity_mw"] >= MIN_CAPACITY_MW]
    out = (plants[["name", "lat", "lon", "capacity_mw", "source"]]
           .sort_values("capacity_mw", ascending=False).reset_index(drop=True))
    out.to_csv(out_path, index=False)
    log.info("wrote %d plants (%.0f MW) to %s", len(out), out["capacity_mw"].sum(), out_path)
    return out


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("build-india-csv")
    parser.parse_args()
    build_india_csv()


if __name__ == "__main__":
    main()
