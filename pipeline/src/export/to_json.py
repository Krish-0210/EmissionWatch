"""Export risk scores, model stats and monthly series as static JSON for the frontend.

Contract: frontend/src/api.ts. Writes to pipeline/data/export/ and copies to frontend/public/data/:
  clusters.json            all clusters: location, capacity, score, level, confidence, headline
  cluster_{id}.json        + plants, signals, model stats, confidence notes, coverage
  timeseries_{id}.json     monthly generation_mu, expected_no2, observed_no2, residual, valid_fraction

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

from src.ingest.satellite import cluster_centroids, load_plants
from src.process import model
from src.process.cluster_monthly import MIN_DAYS_SHARE
from src.scoring import risk_score

log = logging.getLogger(__name__)

PIPELINE_DIR = Path(__file__).resolve().parents[2]
PROCESSED = PIPELINE_DIR / "data" / "processed"
EXPORT_DIR = PIPELINE_DIR / "data" / "export"
FRONTEND_DIR = PIPELINE_DIR.parent / "frontend" / "public" / "data"


def clean(v):
    """JSON-safe: NaN/NA -> None, numpy scalars -> python, floats rounded."""
    if isinstance(v, dict):
        return {k: clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [clean(x) for x in v]
    if v is None or (not isinstance(v, str) and pd.isna(v)):
        return None
    if hasattr(v, "item"):
        v = v.item()
    if isinstance(v, float):
        return None if math.isinf(v) else round(v, 6)
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
        }
        for name, obj in ((f"cluster_{cid}.json", detail),
                          (f"timeseries_{cid}.json", {"id": cid, "months": monthly_series(cid, resid, gen, no2)})):
            write(EXPORT_DIR / name, obj)
            written.append(EXPORT_DIR / name)

    write(EXPORT_DIR / "clusters.json", {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                                         "as_of": as_of, "clusters": summaries})
    written.append(EXPORT_DIR / "clusters.json")

    FRONTEND_DIR.mkdir(parents=True, exist_ok=True)
    for p in written:
        shutil.copy2(p, FRONTEND_DIR / p.name)
    return written


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    written = run()
    log.info("wrote %d files to %s and %s", len(written), EXPORT_DIR, FRONTEND_DIR)


if __name__ == "__main__":
    main()
