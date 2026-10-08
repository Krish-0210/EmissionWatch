"""COVID lockdown backtest: can the daily model predict NO2 for Apr+May 2020 from generation and weather?

1. Refit the per-cluster model of model.py (enhancement, µmol/m²) on cluster_daily without Mar-Jun 2020.
2. For each day of Apr 1 - May 31 2020 with NO2 valid_fraction >= 0.5: generation_mu = the combined
   Apr+May 2020 total (generation_monthly, from FY-to-date) / 61, actual ERA5 weather, harmonics.
   Predicted vs observed = means over those days.
3. Reference: observed mean over valid days of Apr+May 2019, and 2019 Apr+May generation per day.
Pooled: the pooled cluster-FE model of model.py refitted the same way, averaged over all cluster-days.

Writes data/processed/backtest.csv and docs/figures/backtest.png.

Usage (from pipeline/):
    python -m src.process.backtest
"""

import logging
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402
import statsmodels.api as sm  # noqa: E402

from src.process import model  # noqa: E402
from src.process.cluster_daily import MIN_VALID  # noqa: E402
from src.process.cluster_monthly import FIG_DIR, GRID, INK, INK_2, NO2_COLOR  # noqa: E402

log = logging.getLogger(__name__)

PROCESSED = model.PROCESSED
OUT_PATH = PROCESSED / "backtest.csv"
FIG_PATH = FIG_DIR / "backtest.png"
EXCLUDE = (pd.Timestamp("2020-03-01"), pd.Timestamp("2020-06-30"))
WINDOW_2020 = (pd.Timestamp("2020-04-01"), pd.Timestamp("2020-05-31"))
WINDOW_2019 = (pd.Timestamp("2019-04-01"), pd.Timestamp("2019-05-31"))
DAYS = 61
REF_COLOR = "#9b9a96"


def window_days(start: pd.Timestamp, end: pd.Timestamp, gen_per_day: pd.Series) -> pd.DataFrame:
    """Valid NO2 days in the window, with weather and a constant generation per day per cluster."""
    no2 = pd.read_parquet(PROCESSED / "no2_daily.parquet")
    weather = pd.read_parquet(PROCESSED / "weather_daily.parquet")
    d = no2[no2["date"].between(start, end) & (no2["valid_fraction"] >= MIN_VALID)].merge(weather, on=["date", "cluster"])
    d = d.assign(generation_mu=d["cluster"].map(gen_per_day)).dropna(subset=["enhancement", "wind_speed", "blh"])
    return model.prepare(d)


def generation_per_day() -> tuple[pd.Series, pd.Series]:
    gm = pd.read_parquet(PROCESSED / "generation_monthly.parquet")
    gm = gm[gm["entity_type"] == "cluster"]
    g2020 = gm[gm["combined_period"]].set_index("entity_id")["generation_mu"] / DAYS
    g2019 = gm[gm["month"].isin([WINDOW_2019[0], pd.Timestamp("2019-05-01")])].groupby("entity_id")["generation_mu"].sum()
    return g2020, g2019 / DAYS


def predict(fit, d: pd.DataFrame, regressors: list[str]) -> pd.Series:
    return fit.predict(sm.add_constant(d[regressors].astype(float), has_constant="add"))


def run() -> pd.DataFrame:
    train = model.prepare(pd.read_parquet(model.IN_PATH))
    train = train[~train["date"].between(*EXCLUDE)]
    g2020, g2019 = generation_per_day()
    test = window_days(*WINDOW_2020, g2020)
    ref = window_days(*WINDOW_2019, g2019)

    rows = []
    for cluster, g in train.groupby("cluster"):
        fit = model.fit(g, "enhancement_umol", model.REGRESSORS)
        t, r = test[test["cluster"] == cluster], ref[ref["cluster"] == cluster]
        rows.append({"cluster": cluster, "gen_2019": g2019[cluster], "gen_2020": g2020[cluster],
                     "days_2019": len(r), "days_2020": len(t),
                     "observed_2019": r["enhancement_umol"].mean(),
                     "observed_2020": t["enhancement_umol"].mean(),
                     "predicted_2020": predict(fit, t, model.REGRESSORS).mean()})

    # Pooled cluster-FE model, same exclusion.
    clusters = sorted(train["cluster"].unique())
    fe = lambda d: pd.get_dummies(pd.Categorical(d["cluster"], categories=clusters), prefix="fe", dtype=float).iloc[:, 1:]
    regs = model.REGRESSORS + list(fe(train).columns)
    add_fe = lambda d: pd.concat([d.reset_index(drop=True), fe(d).reset_index(drop=True)], axis=1)
    fit = model.fit(add_fe(train), "enhancement_umol", regs)
    rows.append({"cluster": "POOLED", "gen_2019": g2019[clusters].sum(), "gen_2020": g2020[clusters].sum(),
                 "days_2019": len(ref), "days_2020": len(test),
                 "observed_2019": ref["enhancement_umol"].mean(), "observed_2020": test["enhancement_umol"].mean(),
                 "predicted_2020": predict(fit, add_fe(test), regs).mean()})

    out = pd.DataFrame(rows)
    out["gen_change_pct"] = 100 * (out["gen_2020"] / out["gen_2019"] - 1)
    out["observed_change_pct"] = 100 * (out["observed_2020"] / out["observed_2019"] - 1)
    out["predicted_change_pct"] = 100 * (out["predicted_2020"] / out["observed_2019"] - 1)
    out["error"] = out["predicted_2020"] - out["observed_2020"]
    return out


def plot(out: pd.DataFrame) -> None:
    d = out.reset_index(drop=True)
    x = range(len(d))
    w = 0.27
    fig, ax = plt.subplots(figsize=(12, 4.6), dpi=150)
    ax.bar([i - w for i in x], d["observed_2019"], w, color=REF_COLOR, label="Observed Apr+May 2019")
    ax.bar(list(x), d["observed_2020"], w, color=NO2_COLOR, label="Observed Apr+May 2020 (lockdown)")
    ax.bar([i + w for i in x], d["predicted_2020"], w, facecolor="none", edgecolor=NO2_COLOR, hatch="///", lw=1.2,
           label="Predicted Apr+May 2020 (model without Mar–Jun 2020)")
    ax.set_xticks(list(x), [c.title() if c != "POOLED" else "Pooled" for c in d["cluster"]], fontsize=9)
    ax.set_ylabel("NO₂ enhancement (µmol/m²)", color=INK_2)
    ax.axhline(0, color=INK_2, lw=0.8)
    ax.tick_params(colors=INK_2, labelsize=9)
    ax.spines[["top", "right"]].set_visible(False)
    ax.spines[["left", "bottom"]].set_color(GRID)
    ax.grid(axis="y", color=GRID, lw=0.8)
    ax.set_axisbelow(True)
    ax.set_title("Lockdown backtest: NO₂ enhancement, observed vs predicted from reported generation and weather",
                 color=INK, fontsize=11, loc="left", pad=26)
    ax.legend(loc="lower left", bbox_to_anchor=(0, 1.0), ncol=3, frameon=False, fontsize=9, labelcolor=INK_2)
    fig.text(0.01, 0.01, "Means over days with valid_fraction ≥ 50%. 2020 generation = combined Apr+May total / 61. "
             "Source: CEA DGR2, Sentinel-5P OFFL L3 NO₂, ERA5.", fontsize=7.5, color=INK_2)
    fig.tight_layout(rect=(0, 0.03, 1, 1))
    fig.savefig(FIG_PATH, facecolor="#fcfcfb")
    plt.close(fig)


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    out = run()
    out.to_csv(OUT_PATH, index=False)
    plot(out)
    log.info("wrote %s and %s", OUT_PATH, FIG_PATH)
    with pd.option_context("display.width", 250):
        print(out.to_string(index=False, float_format=lambda v: f"{v:.1f}"))


if __name__ == "__main__":
    main()
