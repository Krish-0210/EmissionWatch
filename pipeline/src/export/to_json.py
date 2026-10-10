"""Export risk scores, model stats and monthly series as static JSON for the frontend.

Contract: frontend/src/api.ts. Writes to pipeline/data/export/ and copies to frontend/public/data/:
  clusters.json            all clusters: location, capacity, score, level, confidence, headline
  cluster_{id}.json        + plants, signals, model stats, confidence notes, coverage
  timeseries_{id}.json     monthly generation_mu, expected_no2, observed_no2, residual, valid_fraction
  summary.json             pooled model, per-cluster generation coef/p, lockdown backtest, findings, sources
  wind_{id}.json           latest ERA5 wind, direction cone, towns (export/wind.py; read by GET /clusters/{id}/wind)
  plants_india.json        every Indian coal plant >= 500 MW with its state and cluster_id (export/plants_india.py)
  states.json              all 36 states / union territories: centroid, plant count, capacity, plant ids
Also copies docs/figures/backtest.png to frontend/public/data/.

Additive fields (not yet in api.ts; FRONTEND_TODO.md):
  clusters.json rows + cluster_{id}.json: primary_anomaly_type, primary_anomaly_label, population_20km
  cluster_{id}.json: flagged_periods (risk_score.flagged_periods)
  summary.json: sources
primary_anomaly_type: the signal adding the most points above the neutral 50 (risk_score - 50 = sum of
weight x (sub-score - 50)); "none" when no signal is above neutral.
population_20km needs data/processed/population_20km.csv (python -m src.ingest.population, GEE) and the wind
files need config/india_towns_50k.csv (python -m src.ingest.towns) and weather_daily.parquet.

expected/observed/residual are monthly means of the daily model (residuals_daily.parquet) over valid
days, in µmol/m²; months without a valid day are null. valid_fraction is from no2_monthly.parquet.
generation_mu is null for months with < 90% of days reported (and for Apr/May 2020, a combined period).

Usage (from pipeline/):
    python -m src.export.to_json
"""

import json
import logging
import math
import shutil
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from src.export import plants_india, wind
from src.ingest import population, states, towns
from src.ingest.satellite import cluster_centroids, load_plants
from src.process import model
from src.process.cluster_monthly import MIN_DAYS_SHARE
from src.scoring import risk_score

log = logging.getLogger(__name__)

PIPELINE_DIR = Path(__file__).resolve().parents[2]
PROCESSED = PIPELINE_DIR / "data" / "processed"
EXPORT_DIR = PIPELINE_DIR / "data" / "export"
FRONTEND_DIR = PIPELINE_DIR.parent / "frontend" / "public" / "data"
BACKTEST_PNG = PIPELINE_DIR.parent / "docs" / "figures" / "backtest.png"


def clean(v):
    """JSON-safe: NaN/NA -> None, numpy scalars -> python, floats to 6 significant digits (keeps tiny p-values)."""
    if isinstance(v, dict):
        return {k: clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [clean(x) for x in v]
    if v is None or (not isinstance(v, str) and pd.isna(v)):
        return None
    if hasattr(v, "item"):
        v = v.item()
    if isinstance(v, float):
        return None if math.isinf(v) else float(f"{v:.6g}")
    return v


def write(path: Path, obj) -> None:
    path.write_text(json.dumps(clean(obj), ensure_ascii=False, allow_nan=False, indent=1), encoding="utf-8")


def model_stats(res: pd.DataFrame, cluster: str, target: str) -> dict:
    r = res[(res["cluster"] == cluster) & (res["target"] == target)].iloc[0]
    return {k: r[k] for k in ("coef", "t", "p", "partial_r2", "r2")} | {"n": int(r["n"])}


def monthly_series(cluster: str, resid: pd.DataFrame, gen: pd.DataFrame, no2: pd.DataFrame) -> list[dict]:
    r = resid[resid["cluster"] == cluster].assign(month=lambda d: d["date"].dt.to_period("M").dt.to_timestamp())
    m = r.groupby("month").agg(expected_no2=("enhancement_fitted", "mean"), observed_no2=("enhancement_observed", "mean"),
                               residual=("enhancement_residual", "mean"))
    g = gen[(gen["entity_id"] == cluster) & ~gen["combined_period"]]
    g = g[g["days_reported"] >= MIN_DAYS_SHARE * g["month"].dt.days_in_month].set_index("month")["generation_mu"]
    v = no2[no2["entity_id"] == cluster].set_index("month")["valid_fraction"]
    months = pd.date_range(min(v.index.min(), g.index.min()), max(v.index.max(), m.index.max()), freq="MS")
    out = pd.concat([g.rename("generation_mu"), m, v.rename("valid_fraction")], axis=1, sort=True).reindex(months)
    return [{"month": f"{ts:%Y-%m}", **row} for ts, row in zip(out.index, out.to_dict("records"))]


FINDINGS = [
    "In clusters where generation fell sharply during the 2020 lockdown (Chandrapur, Ramagundam, Marwa), "
    "satellite NO2 fell with it.",
    "Where generation stayed flat, NO2 still fell, showing non-power sources also contribute; so risk is based on "
    "sustained patterns, not absolute levels.",
]


ANOMALY_LABELS = {
    "persistent_excess": "Recent excess: NO₂ above what reported generation and weather predict",
    "intensity_trend": "Rising NO₂ per unit of electricity over the years",
    "peer_intensity": "More NO₂ per unit of electricity than peer clusters",
    "none": "No signal above the neutral level",
}
SIGNAL_SCORES = {"persistent_excess": "excess_score", "intensity_trend": "trend_score", "peer_intensity": "peer_score"}


def primary_anomaly(s: dict) -> str:
    points = {k: risk_score.WEIGHTS[col] * (s[col] - 50) for k, col in SIGNAL_SCORES.items()}
    best = max(points, key=points.get)
    return best if points[best] > 0 else "none"


SOURCES = [
    {"id": "cea_dgr", "name": "CEA Daily Generation Report (DGR Subreport-2), National Power Portal",
     "used_for": "reported daily generation per plant", "access": "npp.gov.in", "license": None, "citation": None, "doi": None},
    {"id": "s5p_no2", "name": "Sentinel-5P TROPOMI tropospheric NO2 (OFFL L3), Copernicus / ESA",
     "used_for": "NO2 enhancement around each cluster", "access": "Google Earth Engine COPERNICUS/S5P/OFFL/L3_NO2",
     "license": None, "citation": None, "doi": None},
    {"id": "era5", "name": "ERA5 hourly reanalysis, Copernicus Climate Change Service / ECMWF",
     "used_for": "10 m wind and boundary-layer height (model controls, wind trace)", "access": "Google Earth Engine ECMWF/ERA5/HOURLY",
     "license": None, "citation": None, "doi": None},
    {"id": "gem", "name": "Global Energy Monitor, Global Coal Plant Tracker", "used_for": "plant coordinates, capacity in each ring",
     "access": "gem.wiki", "license": None, "citation": None, "doi": None},
    population.SOURCE,
    {"id": "geonames", "name": "GeoNames cities15000", "used_for": "towns over 50,000 people in the wind trace",
     "access": "download.geonames.org/export/dump", "license": "CC BY 4.0", "citation": towns.ATTRIBUTION, "doi": None},
    {"id": "open_meteo", "name": "Open-Meteo forecast API", "used_for": "live 10 m wind for the wind trace (API only)",
     "access": "api.open-meteo.com", "license": "CC BY 4.0", "citation": "Weather data by Open-Meteo.com", "doi": None},
    states.SOURCE,
]


def build_summary(res: pd.DataFrame) -> dict:
    """Pooled model, per-cluster generation coefficients, lockdown backtest and headline findings."""
    enh = res[res["target"] == "enhancement_umol"]
    pooled = res[res["cluster"].str.startswith("POOLED")]
    backtest = pd.read_csv(PROCESSED / "backtest.csv")
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "units": {"coef": "µmol/m² NO2 enhancement per MU/day (enhancement); ratio units per MU/day (ratio)",
                  "backtest": "µmol/m², means over valid days of Apr 1 - May 31; generation in MU/day"},
        "pooled_model": {r["target"].replace("_umol", ""): {k: r[k] for k in ("coef", "t", "p", "partial_r2", "r2")}
                         | {"n": int(r["n"])} for r in pooled.to_dict("records")},
        "clusters": [{"id": r["cluster"], "generation_coef": r["coef"], "p": r["p"]}
                     for r in enh[~enh["cluster"].str.startswith("POOLED")].to_dict("records")],
        "backtest": backtest.to_dict("records"),
        "findings": FINDINGS,
        "sources": [{k: src.get(k) for k in ("id", "name", "used_for", "access", "license", "citation", "doi")} for src in SOURCES],
    }


def run() -> list[Path]:
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    plants = load_plants()
    centroids = cluster_centroids(plants)
    scores = pd.read_csv(risk_score.OUT_PATH)
    yearly = pd.read_csv(risk_score.YEARLY_PATH)
    res = pd.read_csv(model.RESULTS_PATH)
    resid = pd.read_parquet(model.RESID_PATH)
    gen = pd.read_parquet(PROCESSED / "generation_monthly.parquet").query("entity_type == 'cluster'")
    no2 = pd.read_parquet(PROCESSED / "no2_monthly.parquet").query("entity_type == 'cluster'")
    as_of = pd.to_datetime(scores["as_of"]).max().strftime("%Y-%m-%d")
    rolling = pd.read_parquet(risk_score.ROLLING_PATH)
    pop = pd.read_csv(population.OUT_PATH).set_index("cluster")["population_20km"]
    era5, town_table = wind.latest_era5(), wind.load_towns()

    summaries, written = [], []
    for s in scores.sort_values("cluster").to_dict("records"):
        cid = s["cluster"]
        members = [p for p in plants if p["cluster"] == cid]
        operating = [p for p in members if p.get("status", "operating") == "operating"]
        lon, lat = centroids[cid]
        summary = {
            "id": cid, "name": cid.title(), "states": sorted({p["state"] for p in members}), "lat": lat, "lon": lon,
            "capacity_mw": sum(p["capacity_mw"] for p in operating), "n_plants": len(operating),
            "risk_score": s["risk_score"], "risk_level": s["risk_level"], "confidence": s["confidence"],
            "headline": s["headline"],
            "primary_anomaly_type": (kind := primary_anomaly(s)), "primary_anomaly_label": ANOMALY_LABELS[kind],
            "population_20km": int(pop[cid]),
        }
        summaries.append(summary)
        y = yearly[yearly["cluster"] == cid][["year", "coef", "se", "days"]].to_dict("records")
        unreported = s["unreported_plants"] if isinstance(s["unreported_plants"], str) else ""
        notes = s["confidence_notes"] if isinstance(s["confidence_notes"], str) else ""
        detail = summary | {
            "as_of": as_of,
            "plants": [{k: p.get(k, "operating") for k in ("id", "name", "state", "lat", "lon", "capacity_mw", "status")}
                       for p in members],
            "weights": {"persistent_excess": risk_score.WEIGHTS["excess_score"],
                        "intensity_trend": risk_score.WEIGHTS["trend_score"],
                        "peer_intensity": risk_score.WEIGHTS["peer_score"]},
            "signals": {
                "persistent_excess": {"z": s["excess_z"], "score": s["excess_score"]},
                "intensity_trend": {"pct_per_year": s["intensity_trend_pct"], "t": s["trend_t"],
                                    "score": s["trend_score"], "yearly": y},
                "peer_intensity": {"ratio": s["peer_ratio"], "score": s["peer_score"]},
            },
            "model": {"enhancement": model_stats(res, cid, "enhancement_umol"), "ratio": model_stats(res, cid, "ratio")},
            "confidence_notes": [n for n in notes.split("; ") if n],
            "coverage": {"recent_valid_days": int(s["recent_days"]), "ring_capacity_mw": s["ring_mw"],
                         "unreported_capacity_mw": s["unreported_mw"],
                         "unreported_plants": [n for n in unreported.split("; ") if n]},
            "flagged_periods": risk_score.flagged_periods(rolling, cid),
        }
        for name, obj in ((f"cluster_{cid}.json", detail),
                          (f"timeseries_{cid}.json", {"id": cid, "months": monthly_series(cid, resid, gen, no2)}),
                          (f"wind_{cid}.json", wind.build(cid, summary["name"], lat, lon, era5, town_table))):
            write(EXPORT_DIR / name, obj)
            written.append(EXPORT_DIR / name)

    write(EXPORT_DIR / "clusters.json", {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                                         "as_of": as_of, "clusters": summaries})
    written.append(EXPORT_DIR / "clusters.json")
    write(EXPORT_DIR / "summary.json", build_summary(res))
    written.append(EXPORT_DIR / "summary.json")
    for name, obj in zip(("plants_india.json", "states.json"), plants_india.build(plants)):
        write(EXPORT_DIR / name, obj)
        written.append(EXPORT_DIR / name)

    FRONTEND_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(BACKTEST_PNG, FRONTEND_DIR / BACKTEST_PNG.name)
    for p in written:
        shutil.copy2(p, FRONTEND_DIR / p.name)
    return written


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    written = run()
    log.info("wrote %d files to %s and %s", len(written), EXPORT_DIR, FRONTEND_DIR)


if __name__ == "__main__":
    main()
