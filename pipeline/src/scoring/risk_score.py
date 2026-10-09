"""Audit Risk Score per cluster from the daily model (model.py) residuals and coefficients.

Signals (all on enhancement in µmol/m², per-cluster model of model.py):
  1. persistent_excess: residuals winsorised at the 1st/99th percentile (residual_checks.winsorise),
     90-calendar-day rolling mean (>= 30 valid days), standardised against the cluster's own rolling-mean
     history. Value = z at the latest date. Positive = more NO2 than generation + weather + season explain.
  2. intensity_trend: per-year generation coefficient (µmol/m² per MU/day, i.e. NO2 per unit of
     electricity after weather/season adjustment) from one model per cluster with a generation slope and
     an intercept per year plus the model.py controls (HAC errors); years with >= MIN_YEAR_DAYS valid days.
     Trend = WLS slope of the yearly coefficients on year (weights 1/se²), reported as % of the
     full-period coefficient per year, with its t-stat. Rising = more NO2 per unit of electricity.
     Mean(enhancement)/mean(generation) is not used: enhancement has a large part unrelated to reported
     generation (intercept, captive plants), so that ratio inflates low-generation clusters/years.
  3. peer_intensity: the cluster's full-period generation coefficient (model.py) / median over clusters.

Sub-scores (0-100, 50 = neutral), Φ = standard normal CDF:
  excess_score = 100 Φ(z)
  trend_score  = 100 Φ(trend_t / 2)       the yearly coefficients are noisy, so the slope's t-stat is used
  peer_score   = 100 Φ(log2(peer_ratio))  2x the median -> 84
Audit Risk Score = WEIGHTS · sub-scores (excess 0.5, trend 0.25, peer 0.25).
risk_level: low < 40 <= medium < 65 <= high.

Confidence starts high and drops one level per issue (>= 2 issues = low):
  - enhancement model: generation p >= 0.01
  - ratio model: generation p >= 0.05
  - generation partial R² < 0.01
  - < MIN_RECENT_DAYS valid days in the last 365
  - > 10% of GEM coal capacity inside the 20 km ring is not in the CEA generation figures

Usage (from pipeline/):
    python -m src.scoring.risk_score
"""

import logging
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy.stats import norm  # statsmodels dependency

from src.ingest.satellite import INDIA_CSV, cluster_centroids, haversine_km, load_plants
from src.process import model
from src.process.residual_checks import winsorise

log = logging.getLogger(__name__)

PIPELINE_DIR = Path(__file__).resolve().parents[2]
PROCESSED = PIPELINE_DIR / "data" / "processed"
OUT_PATH = PROCESSED / "risk_scores.csv"
ROLLING_PATH = PROCESSED / "risk_rolling_daily.parquet"
YEARLY_PATH = PROCESSED / "intensity_yearly.csv"

ROLL_DAYS, ROLL_MIN = 90, 30
MIN_YEAR_DAYS = 100
MIN_RECENT_DAYS = 120
WEIGHTS = {"excess_score": 0.5, "trend_score": 0.25, "peer_score": 0.25}
LEVELS = [(65, "high"), (40, "medium"), (0, "low")]
RING_KM, SAME_PLANT_KM, UNREPORTED_MAX = 20, 3, 0.10


def unreported_capacity() -> pd.DataFrame:
    """GEM capacity inside each 20 km ring that matches no registry plant (within 3 km)."""
    plants = load_plants()
    india = pd.read_csv(INDIA_CSV)
    rows = []
    for c, (lon, lat) in cluster_centroids(plants).items():
        centre = {"lat": lat, "lon": lon}
        inside = india[[haversine_km(centre, r) <= RING_KM for r in india.to_dict("records")]]
        unreg = inside[[min(haversine_km(r, p) for p in plants) > SAME_PLANT_KM for r in inside.to_dict("records")]]
        rows.append({"cluster": c, "ring_mw": inside["capacity_mw"].sum(), "unreported_mw": unreg["capacity_mw"].sum(),
                     "unreported_plants": "; ".join(unreg["name"])})
    out = pd.DataFrame(rows)
    out["unreported_share"] = out["unreported_mw"] / out["ring_mw"]
    return out


def persistent_excess(resid: pd.DataFrame) -> pd.DataFrame:
    out = []
    for cluster, g in resid.groupby("cluster"):
        s = winsorise(g.set_index("date")["enhancement_residual"].dropna().sort_index())
        roll = s.rolling(f"{ROLL_DAYS}D", min_periods=ROLL_MIN).mean()
        z = (roll - roll.mean()) / roll.std()
        out.append(pd.DataFrame({"date": s.index, "cluster": cluster, "residual_w": s.values,
                                 "rolling_mean": roll.values, "rolling_z": z.values}))
    return pd.concat(out, ignore_index=True)


def yearly_coefficients(g: pd.DataFrame) -> pd.DataFrame:
    """Generation coefficient per year (with year intercepts and the model.py controls), HAC errors."""
    g = g.assign(year=g["date"].dt.year)
    counts = g["year"].value_counts()
    years = sorted(counts[counts >= MIN_YEAR_DAYS].index)
    g = g[g["year"].isin(years)]
    X = g[model.CONTROLS].astype(float).copy()
    for y in years:
        X[f"gen_{y}"] = g["generation_mu"] * (g["year"] == y)
        X[f"year_{y}"] = (g["year"] == y).astype(float)
    fit = sm.OLS(g["enhancement_umol"], X).fit(cov_type="HAC", cov_kwds={"maxlags": model.nw_lags(len(g))})
    return pd.DataFrame({"year": years, "days": [int(counts[y]) for y in years],
                         "coef": [fit.params[f"gen_{y}"] for y in years],
                         "se": [fit.bse[f"gen_{y}"] for y in years]})


def intensity(df: pd.DataFrame, full_coef: pd.Series) -> tuple[pd.DataFrame, pd.DataFrame]:
    latest = df["date"].max()
    rows, yearly = [], []
    for cluster, g in df.groupby("cluster"):
        y = yearly_coefficients(g)
        yearly.append(y.assign(cluster=cluster))
        wls = sm.WLS(y["coef"], sm.add_constant(y["year"].astype(float)), weights=1 / y["se"] ** 2).fit()
        rows.append({"cluster": cluster, "trend_years": len(y),
                     "intensity_trend_pct": 100 * wls.params["year"] / full_coef[cluster],
                     "trend_t": wls.tvalues["year"],
                     "recent_days": int((g["date"] > latest - pd.Timedelta(days=365)).sum())})
    out = pd.DataFrame(rows)
    out["peer_ratio"] = out["cluster"].map(full_coef) / full_coef.median()
    return out, pd.concat(yearly, ignore_index=True)


def confidence(row: pd.Series) -> tuple[str, str]:
    issues = []
    if row["enh_p"] >= 0.01:
        issues.append(f"generation not significant in enhancement model (p={row['enh_p']:.2g})")
    if row["ratio_p"] >= 0.05:
        issues.append(f"generation not significant in ratio model (p={row['ratio_p']:.2g})")
    if row["partial_r2"] < 0.01:
        issues.append(f"generation explains <1% of residual variance (partial R²={row['partial_r2']:.3f})")
    if row["recent_days"] < MIN_RECENT_DAYS:
        issues.append(f"only {row['recent_days']} valid days in the last 365")
    if row["unreported_share"] > UNREPORTED_MAX:
        issues.append(f"{row['unreported_mw']:.0f} MW in ring not in CEA generation ({row['unreported_plants'].replace('; ', ', ')})")
    level = ["high", "medium", "low"][min(len(issues), 2)]
    return level, "; ".join(issues)


def headline(r: pd.Series) -> str:
    side = "above" if r["excess_z"] >= 0 else "below"
    if abs(r["trend_t"]) < 2:
        trend = "with no clear trend in NO₂ per unit of electricity"
    else:
        trend = (f"NO₂ per unit of electricity has been {'rising' if r['intensity_trend_pct'] > 0 else 'falling'} "
                 f"about {abs(r['intensity_trend_pct']):.0f}% a year")
    return (f"{r['cluster'].title()} is {r['risk_level']} risk: over the last 90 days NO₂ ran "
            f"{abs(r['excess_z']):.1f} SD {side} what reported generation and weather predict, {trend}, "
            f"and it is {r['peer_ratio']:.1f}× the peer median per unit generated "
            f"({r['confidence']} confidence).")


def score() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    df = model.prepare(pd.read_parquet(model.IN_PATH))
    rolling = persistent_excess(pd.read_parquet(model.RESID_PATH))
    latest = rolling.dropna(subset=["rolling_z"]).sort_values("date").groupby("cluster").tail(1)
    res = pd.read_csv(model.RESULTS_PATH)
    sig, yearly = intensity(df, res[res["target"] == "enhancement_umol"].set_index("cluster")["coef"])
    stats = (res[res["target"] == "enhancement_umol"][["cluster", "coef", "t", "p", "partial_r2", "n"]]
             .rename(columns={"coef": "gen_coef", "t": "enh_t", "p": "enh_p", "n": "n_days"})
             .merge(res[res["target"] == "ratio"][["cluster", "p"]].rename(columns={"p": "ratio_p"}), on="cluster"))

    out = (latest[["cluster", "date", "rolling_z"]].rename(columns={"date": "as_of", "rolling_z": "excess_z"})
           .merge(sig, on="cluster").merge(stats, on="cluster").merge(unreported_capacity(), on="cluster"))
    out["excess_score"] = 100 * norm.cdf(out["excess_z"])
    out["trend_score"] = 100 * norm.cdf(out["trend_t"] / 2)
    out["peer_score"] = 100 * norm.cdf(np.log2(out["peer_ratio"]))
    out["risk_score"] = sum(w * out[k] for k, w in WEIGHTS.items())
    out["risk_level"] = out["risk_score"].map(lambda s: next(lvl for cut, lvl in LEVELS if s >= cut))
    out[["confidence", "confidence_notes"]] = out.apply(confidence, axis=1, result_type="expand")
    out["headline"] = out.apply(headline, axis=1)
    return out.sort_values("risk_score", ascending=False).reset_index(drop=True), rolling, yearly


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    out, rolling, yearly = score()
    out.to_csv(OUT_PATH, index=False)
    rolling.to_parquet(ROLLING_PATH, index=False)
    yearly.to_csv(YEARLY_PATH, index=False)
    log.info("wrote %s, %s, %s", OUT_PATH, ROLLING_PATH, YEARLY_PATH)
    cols = ["cluster", "risk_score", "risk_level", "confidence", "excess_z", "intensity_trend_pct", "trend_t", "peer_ratio",
            "excess_score", "trend_score", "peer_score", "recent_days"]
    with pd.option_context("display.width", 250, "display.max_colwidth", 300):
        print(out[cols].to_string(index=False, float_format=lambda v: f"{v:.2f}"))
        print()
        for r in out.itertuples():
            print(f"- {r.headline}" + (f"  [{r.confidence_notes}]" if r.confidence_notes else ""))


if __name__ == "__main__":
    main()
