"""Join daily cluster generation, daily NO2 and daily weather into cluster_daily.parquet.

generation_mu: plant-total rows of generation_daily summed per cluster (the DGR2 report date is the
generation date: the column is "TODAY'S ACTUAL"). plants_reported counts the cluster's plants with a
row that day. Only days with all three sources and NO2 valid_fraction >= MIN_VALID are kept.

Usage (from pipeline/):
    python -m src.process.cluster_daily
"""

import logging
from pathlib import Path

import pandas as pd
import yaml

log = logging.getLogger(__name__)

PIPELINE_DIR = Path(__file__).resolve().parents[2]
PROCESSED = PIPELINE_DIR / "data" / "processed"
PLANTS_PATH = PIPELINE_DIR / "config" / "plants.yaml"
OUT_PATH = PROCESSED / "cluster_daily.parquet"
MIN_VALID = 0.5


def daily_generation() -> pd.DataFrame:
    plants = yaml.safe_load(PLANTS_PATH.read_text(encoding="utf-8"))["plants"]
    cluster_of = {p["id"]: p["cluster"] for p in plants}
    gen = pd.read_parquet(PROCESSED / "generation_daily.parquet")
    gen = gen[gen["unit"].isna()].assign(cluster=lambda d: d["plant_id"].map(cluster_of))
    return (gen.groupby(["date", "cluster"])
            .agg(generation_mu=("actual_mu", "sum"), plants_reported=("plant_id", "nunique"),
                 outage_mw=("outage_mw", "sum"))
            .reset_index())


def build() -> pd.DataFrame:
    no2 = pd.read_parquet(PROCESSED / "no2_daily.parquet")
    weather = pd.read_parquet(PROCESSED / "weather_daily.parquet")
    df = (no2[no2["valid_fraction"] >= MIN_VALID]
          .merge(daily_generation(), on=["date", "cluster"], how="inner")
          .merge(weather, on=["date", "cluster"], how="inner")
          .dropna(subset=["enhancement", "generation_mu", "wind_speed", "blh"]))
    return df.sort_values(["cluster", "date"]).reset_index(drop=True)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    df = build()
    df.to_parquet(OUT_PATH, index=False)
    log.info("wrote %d rows (%s .. %s) to %s", len(df), df["date"].min().date(), df["date"].max().date(), OUT_PATH)
    print(df.groupby("cluster").size().rename("days").to_string())


if __name__ == "__main__":
    main()
