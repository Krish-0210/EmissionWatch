"""Checks on the daily enhancement residuals from model.py, and the outlier cap used downstream.

Per cluster:
  acf_1..acf_7: autocorrelation at lags of 1-7 calendar days. Residuals exist only on valid days, so
      each lag is the Pearson correlation over the pairs (t, t-k) where both days are present.
  outlier_share: share of days with |z| > 3 (z standardised per cluster).
  p01, p99: winsorisation bounds (1st / 99th percentile per cluster) applied by `winsorise`.

Usage (from pipeline/):
    python -m src.process.residual_checks
"""

import logging
from pathlib import Path

import pandas as pd

log = logging.getLogger(__name__)

PIPELINE_DIR = Path(__file__).resolve().parents[2]
PROCESSED = PIPELINE_DIR / "data" / "processed"
RESID_PATH = PROCESSED / "residuals_daily.parquet"
OUT_PATH = PROCESSED / "residual_checks.csv"
LAGS = range(1, 8)
Z_OUTLIER = 3
WINSOR = (0.01, 0.99)


def winsorise(s: pd.Series) -> pd.Series:
    lo, hi = s.quantile(WINSOR[0]), s.quantile(WINSOR[1])
    return s.clip(lo, hi)


def calendar_acf(s: pd.Series, lag: int) -> float:
    """s indexed by date with gaps; correlation of s_t with s_{t-lag} in calendar days."""
    full = s.asfreq("D")
    return full.corr(full.shift(lag))


def checks(resid: pd.DataFrame, col: str = "enhancement_residual") -> pd.DataFrame:
    rows = []
    for cluster, g in resid.groupby("cluster"):
        s = g.set_index("date")[col].dropna().sort_index()
        z = (s - s.mean()) / s.std()
        row = {"cluster": cluster, "n": len(s)}
        row.update({f"acf_{k}": calendar_acf(s, k) for k in LAGS})
        row["outlier_share"] = (z.abs() > Z_OUTLIER).mean()
        row["p01"], row["p99"] = s.quantile(WINSOR[0]), s.quantile(WINSOR[1])
        rows.append(row)
    return pd.DataFrame(rows)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    out = checks(pd.read_parquet(RESID_PATH))
    out.to_csv(OUT_PATH, index=False)
    log.info("wrote %s", OUT_PATH)
    with pd.option_context("display.width", 200):
        print(out.to_string(index=False, float_format=lambda v: f"{v:.3f}"))


if __name__ == "__main__":
    main()
