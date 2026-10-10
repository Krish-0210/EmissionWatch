"""Indian towns and cities with population > 50,000 from GeoNames, for the wind trace (export/wind.py).

Source: GeoNames cities15000 (all places with population > 15,000) and admin1CodesASCII, CC BY 4.0,
https://download.geonames.org/export/dump/ (download both into data/raw/geonames/ and unzip
cities15000.zip). Kept: country IN, populated-place codes (PPL, PPLA..PPLA4, PPLC, PPLG, PPLS; not PPLX
sections of a city or PPLH historical places), population > 50,000, ASCII names, duplicate spellings dropped
(dedupe), and NAME_OVERRIDES.GeoNames populations for India are
mostly census figures; the date varies by place (see the modification date column of the raw file).

Writes config/india_towns_50k.csv: geonameid, name, state, lat, lon, population (committed, with attribution).

Usage (from pipeline/):
    python -m src.ingest.towns
"""

import logging
from difflib import SequenceMatcher
from pathlib import Path

import pandas as pd

from src.ingest.satellite import haversine_km

log = logging.getLogger(__name__)

PIPELINE_DIR = Path(__file__).resolve().parents[2]
RAW_DIR = PIPELINE_DIR / "data" / "raw" / "geonames"
OUT_PATH = PIPELINE_DIR / "config" / "india_towns_50k.csv"
MIN_POPULATION = 50_000
FEATURE_CODES = {"PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLC", "PPLG", "PPLS"}
ATTRIBUTION = "GeoNames (geonames.org), CC BY 4.0"
DUP_KM, DUP_RATIO = 8, 0.75
# GeoNames ascii name -> current name, only where the current name is in the record's own alternate names.
NAME_OVERRIDES = {1274693: "Chandrapur"}  # listed as "Chanda", the city's historic name

GEONAMES_COLUMNS = ["geonameid", "name", "asciiname", "alternatenames", "lat", "lon", "feature_class", "feature_code",
                    "country", "cc2", "admin1", "admin2", "admin3", "admin4", "population", "elevation", "dem",
                    "timezone", "modified"]


def build() -> pd.DataFrame:
    cities = pd.read_csv(RAW_DIR / "cities15000.txt", sep="\t", header=None, names=GEONAMES_COLUMNS,
                         dtype={"admin1": str}, keep_default_na=False, quoting=3, encoding="utf-8")
    admin = pd.read_csv(RAW_DIR / "admin1CodesASCII.txt", sep="\t", header=None, names=["code", "name", "ascii", "id"],
                        keep_default_na=False, quoting=3, encoding="utf-8")
    states = dict(zip(admin["code"], admin["name"]))
    t = cities[(cities["country"] == "IN") & cities["feature_code"].isin(FEATURE_CODES)
               & (cities["population"] > MIN_POPULATION)].copy()
    t["state"] = ("IN." + t["admin1"]).map(states).fillna("")
    t["name"] = t["asciiname"].where(t["asciiname"] != "", t["name"])  # "Bilaspur", not "Bilāspur"
    for gid, name in NAME_OVERRIDES.items():
        row = t["geonameid"] == gid
        assert name in t.loc[row, "alternatenames"].iloc[0].split(","), (gid, name)
        t.loc[row, "name"] = name
    t = dedupe(t)
    t = t[["geonameid", "name", "state", "lat", "lon", "population"]].sort_values("geonameid")
    t["lat"], t["lon"] = t["lat"].round(5), t["lon"].round(5)
    return t.reset_index(drop=True)


def dedupe(t: pd.DataFrame) -> pd.DataFrame:
    """GeoNames has some towns twice under two spellings a few km apart (Vriddhachalam / Virudhachalam,
    Ramagundam / Ramgundam): drop the smaller of any pair within DUP_KM with similar names."""
    rows = t.sort_values("population", ascending=False).to_dict("records")
    kept: list[dict] = []
    for r in rows:
        if not any(haversine_km(r, k) <= DUP_KM and SequenceMatcher(None, r["name"].lower(), k["name"].lower()).ratio() >= DUP_RATIO
                   for k in kept):
            kept.append(r)
    return pd.DataFrame(kept)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    t = build()
    t.to_csv(OUT_PATH, index=False, encoding="utf-8", lineterminator="\n")
    log.info("wrote %d towns > %d people to %s", len(t), MIN_POPULATION, OUT_PATH)


if __name__ == "__main__":
    main()
