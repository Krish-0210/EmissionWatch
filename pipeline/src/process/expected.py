"""Estimate expected NOx emissions from generation, capacity, and control status.

Step 1 (this module so far): monthly generation per plant and per cluster from
generation_daily.parquet (plant-total rows only).

Apr-May 2020 has no daily reports (COVID gap). The FY-to-date column includes the
report day, so FY-to-date on 2020-06-01 minus that day's actual gives Apr 1-May 31.
That total becomes one row (month=2020-04-01, combined_period=True) covering both months.

Usage (from pipeline/):
    python -m src.process.expected
"""

import logging
from pathlib import Path

import pandas as pd
import yaml

log = logging.getLogger(__name__)

PIPELINE_DIR = Path(__file__).resolve().parents[2]
PLANTS_PATH = PIPELINE_DIR / "config" / "plants.yaml"
DAILY_PATH = PIPELINE_DIR / "data" / "processed" / "generation_daily.parquet"
OUT_PATH = PIPELINE_DIR / "data" / "processed" / "generation_monthly.parquet"

GAP_MONTHS = (pd.Timestamp("2020-04-01"), pd.Timestamp("2020-05-01"))
GAP_ANCHOR = pd.Timestamp("2020-06-01")

COLUMNS = ["month", "entity_type", "entity_id", "generation_mu", "days_reported",
           "avg_outage_mw", "combined_period"]


def _monthly(daily: pd.DataFrame, entity_type: str) -> pd.DataFrame:
    """daily: one row per (date, entity_id) with actual_mu and outage_mw."""
    m = (daily.assign(month=daily["date"].dt.to_period("M").dt.to_timestamp())
         .groupby(["month", "entity_id"])
         .agg(generation_mu=("actual_mu", "sum"), days_reported=("date", "nunique"),
              avg_outage_mw=("outage_mw", "mean"))
         .reset_index())
    m["entity_type"] = entity_type
    m["combined_period"] = False
    return m


def _gap_rows(totals: pd.DataFrame, entity_type: str, key: str) -> pd.DataFrame:
    """One combined Apr+May 2020 row per entity, from the 2020-06-01 FY-to-date value."""
    anchor = totals[totals["date"] == GAP_ANCHOR]
    if anchor.empty:
        log.warning("no %s report: Apr-May 2020 row not built", GAP_ANCHOR.date())
        return pd.DataFrame(columns=COLUMNS)
    if not totals[totals["date"].between(GAP_MONTHS[0], GAP_ANCHOR - pd.Timedelta(days=1))].empty:
        raise ValueError("daily reports exist inside Apr-May 2020; the combined row would double count")
    g = (anchor.assign(apr_may=anchor["actual_fy_to_date_mu"] - anchor["actual_mu"])
         .groupby(key)["apr_may"].sum().reset_index()
         .rename(columns={key: "entity_id", "apr_may": "generation_mu"}))
    g["month"] = GAP_MONTHS[0]
    g["entity_type"] = entity_type
    g["days_reported"] = 0
    g["avg_outage_mw"] = float("nan")
    g["combined_period"] = True
    return g


def build(daily_path: Path = DAILY_PATH, plants_path: Path = PLANTS_PATH) -> pd.DataFrame:
    plants = yaml.safe_load(plants_path.read_text(encoding="utf-8"))["plants"]
    cluster_of = {p["id"]: p["cluster"] for p in plants}

    totals = pd.read_parquet(daily_path)
    totals = totals[totals["unit"].isna()].copy()
    totals["cluster"] = totals["plant_id"].map(cluster_of)

    plant_daily = totals.rename(columns={"plant_id": "entity_id"})
    cluster_daily = (totals.groupby(["date", "cluster"])
                     .agg(actual_mu=("actual_mu", "sum"), outage_mw=("outage_mw", "sum"))
                     .reset_index().rename(columns={"cluster": "entity_id"}))

    out = pd.concat([
        _monthly(plant_daily, "plant"), _gap_rows(totals, "plant", "plant_id"),
        _monthly(cluster_daily, "cluster"), _gap_rows(totals, "cluster", "cluster"),
    ], ignore_index=True)
    out["days_reported"] = out["days_reported"].astype(int)
    out["combined_period"] = out["combined_period"].astype(bool)
    return out[COLUMNS].sort_values(["entity_type", "entity_id", "month"]).reset_index(drop=True)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    df = build()
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(OUT_PATH, index=False)
    log.info("wrote %d rows to %s", len(df), OUT_PATH)


if __name__ == "__main__":
    main()
