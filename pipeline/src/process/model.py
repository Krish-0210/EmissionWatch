"""Daily expected-vs-observed NO2 model per cluster (OLS with Newey-West / HAC errors).

Per cluster, two targets on the same regressors:
    enhancement (µmol/m², ring_20km - background)  ~ generation_mu + wind_speed + blh + harmonics
    ratio       (ring_20km / background)            ~ same
harmonics = sin/cos(2π·doy/365.25) and sin/cos(4π·doy/365.25).

Reported for generation_mu: coefficient, HAC t-stat and p-value, partial R² (share of the residual
variance of the model without generation that generation explains: (SSR_r - SSR_f) / SSR_r) and n days.
HAC lag = floor(4 (n/100)^(2/9)) on rows in date order; days dropped by the valid_fraction filter
are not filled, so a lag spans observed days, not calendar days.

The ratio is only taken on days with background >= MIN_BACKGROUND (a near-zero or negative daily
background makes it explode).

Pooled model: same formula + cluster fixed effects, HAC errors computed within each cluster
(statsmodels hac-panel).

Residuals (observed - fitted) of both per-cluster variants are saved to residuals_daily.parquet.

Usage (from pipeline/):
    python -m src.process.model
"""

import logging
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.api as sm

log = logging.getLogger(__name__)

PIPELINE_DIR = Path(__file__).resolve().parents[2]
PROCESSED = PIPELINE_DIR / "data" / "processed"
IN_PATH = PROCESSED / "cluster_daily.parquet"
RESID_PATH = PROCESSED / "residuals_daily.parquet"
RESULTS_PATH = PROCESSED / "model_results.csv"
MIN_BACKGROUND = 1e-5  # mol/m² (10 µmol/m²)

CONTROLS = ["wind_speed", "blh", "sin1", "cos1", "sin2", "cos2"]
REGRESSORS = ["generation_mu"] + CONTROLS


def prepare(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values(["cluster", "date"]).reset_index(drop=True)
    phase = 2 * np.pi * df["date"].dt.dayofyear / 365.25
    df = df.assign(sin1=np.sin(phase), cos1=np.cos(phase), sin2=np.sin(2 * phase), cos2=np.cos(2 * phase))
    df["enhancement_umol"] = df["enhancement"] * 1e6
    df["ratio"] = (df["ring_20km"] / df["background"]).where(df["background"] >= MIN_BACKGROUND)
    return df


def nw_lags(n: int) -> int:
    return int(np.floor(4 * (n / 100) ** (2 / 9)))


def fit(d: pd.DataFrame, target: str, regressors: list[str], **cov) -> sm.regression.linear_model.RegressionResultsWrapper:
    X = sm.add_constant(d[regressors].astype(float), has_constant="add")
    return sm.OLS(d[target].astype(float), X).fit(**cov)


def gen_stats(d: pd.DataFrame, target: str, regressors: list[str], **cov) -> tuple[dict, pd.Series]:
    full = fit(d, target, regressors, **cov)
    reduced = fit(d, target, [r for r in regressors if r != "generation_mu"])
    return {
        "coef": full.params["generation_mu"],
        "t": full.tvalues["generation_mu"],
        "p": full.pvalues["generation_mu"],
        "partial_r2": (reduced.ssr - full.ssr) / reduced.ssr,
        "r2": full.rsquared,
        "n": int(full.nobs),
    }, full.resid


def per_cluster(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    rows, resid = [], []
    for cluster, g in df.groupby("cluster"):
        for target in ("enhancement_umol", "ratio"):
            d = g.dropna(subset=[target])
            stats, r = gen_stats(d, target, REGRESSORS, cov_type="HAC", cov_kwds={"maxlags": nw_lags(len(d))})
            rows.append({"cluster": cluster, "target": target, **stats})
            resid.append(pd.DataFrame({"date": d["date"], "cluster": cluster, "target": target,
                                       "observed": d[target], "fitted": d[target] - r, "residual": r}))
    return pd.DataFrame(rows), pd.concat(resid, ignore_index=True)


def pooled(df: pd.DataFrame) -> pd.DataFrame:
    fe = pd.get_dummies(df["cluster"], prefix="fe", drop_first=True, dtype=float)
    d0 = pd.concat([df, fe], axis=1)
    rows = []
    for target in ("enhancement_umol", "ratio"):
        d = d0.dropna(subset=[target]).reset_index(drop=True)
        groups = d["cluster"].astype("category").cat.codes.to_numpy()
        lags = nw_lags(int(d.groupby("cluster").size().median()))
        stats, _ = gen_stats(d, target, REGRESSORS + list(fe.columns),
                             cov_type="hac-panel", cov_kwds={"groups": groups, "maxlags": lags})
        rows.append({"cluster": "POOLED (cluster FE)", "target": target, **stats})
    return pd.DataFrame(rows)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    df = prepare(pd.read_parquet(IN_PATH))
    results, resid = per_cluster(df)
    results = pd.concat([results, pooled(df)], ignore_index=True)
    results.to_csv(RESULTS_PATH, index=False)
    resid = (resid.pivot_table(index=["date", "cluster"], columns="target", values=["observed", "fitted", "residual"])
             .sort_index(axis=1))
    resid.columns = [f"{t.replace('_umol', '')}_{v}" for v, t in resid.columns]
    resid = resid.reset_index().sort_values(["cluster", "date"])
    resid.to_parquet(RESID_PATH, index=False)
    log.info("wrote %d rows to %s and %s", len(resid), RESID_PATH, RESULTS_PATH)
    fmt = {"coef": "{:.4f}", "t": "{:.2f}", "p": "{:.3g}", "partial_r2": "{:.4f}", "r2": "{:.3f}"}
    out = results.copy()
    for c, f in fmt.items():
        out[c] = out[c].map(f.format)
    with pd.option_context("display.width", 200):
        for target, g in out.groupby("target", sort=False):
            print(f"\n{target}\n" + g.drop(columns="target").to_string(index=False))


if __name__ == "__main__":
    main()
