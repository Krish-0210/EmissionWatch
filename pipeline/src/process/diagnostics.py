"""Diagnostics on the monthly cluster table: how much generation varies, and its seasonal cycle vs NO2.

Prints, per cluster, the coefficient of variation (std / mean) of monthly generation over the
months used in the correlation (complete months, not the combined Apr-May 2020 row). Saves a
month-of-year climatology figure (mean generation and mean NO2 enhancement per calendar month,
valid months only) to docs/figures/climatology_generation_vs_no2.png.

Usage (from pipeline/):
    python -m src.process.diagnostics
"""

import logging
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

from src.process.cluster_monthly import FIG_DIR, GEN_COLOR, GRID, INK, INK_2, MIN_DAYS_SHARE, MIN_VALID, NO2_COLOR, OUT_PATH  # noqa: E402

log = logging.getLogger(__name__)

MONTHS = "JFMAMJJASOND"


def complete_months(df: pd.DataFrame) -> pd.DataFrame:
    keep = (~df["combined_period"] & df["generation_mu"].notna()
            & (df["days_reported"] >= MIN_DAYS_SHARE * df["month"].dt.days_in_month))
    return df[keep]


def generation_cv(df: pd.DataFrame) -> pd.DataFrame:
    g = complete_months(df).groupby("cluster")["generation_mu"]
    out = pd.DataFrame({"months": g.size(), "mean_mu": g.mean(), "std_mu": g.std()})
    out["cv"] = out["std_mu"] / out["mean_mu"]
    return out.sort_values("cv", ascending=False).reset_index()


def climatology(df: pd.DataFrame) -> pd.DataFrame:
    gen = complete_months(df).assign(moy=lambda d: d["month"].dt.month).groupby(["cluster", "moy"])["generation_mu"].mean()
    valid = df[(df["valid_fraction"] >= MIN_VALID) & ~df["combined_period"]]
    no2 = valid.assign(moy=lambda d: d["month"].dt.month).groupby(["cluster", "moy"])["enhancement"].agg(["mean", "size"])
    return pd.concat([gen, no2.rename(columns={"mean": "enhancement", "size": "no2_months"})], axis=1).reset_index()


def plot_climatology(clim: pd.DataFrame, path: Path = FIG_DIR / "climatology_generation_vs_no2.png") -> Path:
    clusters = sorted(clim["cluster"].unique())
    ncol = 4
    nrow = -(-len(clusters) // ncol)
    fig, axes = plt.subplots(nrow, ncol, figsize=(15, 3.1 * nrow), dpi=150, squeeze=False)
    for ax, cluster in zip(axes.flat, clusters):
        c = clim[clim["cluster"] == cluster].set_index("moy").reindex(range(1, 13))
        ax2 = ax.twinx()
        ax.plot(c.index, c["generation_mu"], color=GEN_COLOR, lw=2, marker="o", ms=3)
        ax2.plot(c.index, c["enhancement"] * 1e6, color=NO2_COLOR, lw=2, marker="o", ms=3)
        ax.set_title(cluster.title(), color=INK, fontsize=10, loc="left")
        ax.set_xticks(range(1, 13), list(MONTHS))
        for a in (ax, ax2):
            a.tick_params(colors=INK_2, labelsize=8)
            a.spines["top"].set_visible(False)
            a.spines[["left", "right", "bottom"]].set_color(GRID)
        ax.tick_params(axis="y", colors=GEN_COLOR)
        ax2.tick_params(axis="y", colors=NO2_COLOR)
        ax.grid(axis="y", color=GRID, lw=0.8)
    for ax in list(axes.flat)[len(clusters):]:
        ax.set_visible(False)
    fig.suptitle("Month-of-year climatology: generation (blue, MU/month, left) vs NO₂ enhancement "
                 "(orange, µmol/m², right)", color=INK, fontsize=12, x=0.01, ha="left")
    fig.text(0.01, 0.005, f"Generation: complete months only. NO₂: months with valid_fraction ≥ {MIN_VALID:.0%}; "
             "monsoon calendar months can rest on few years. Source: CEA DGR2, Sentinel-5P OFFL L3 NO₂.",
             fontsize=7.5, color=INK_2)
    fig.tight_layout(rect=(0, 0.02, 1, 0.97))
    fig.savefig(path, facecolor="#fcfcfb")
    plt.close(fig)
    return path


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    df = pd.read_parquet(OUT_PATH)
    print(generation_cv(df).to_string(index=False, float_format=lambda v: f"{v:.3f}"))
    clim = climatology(df)
    corr = clim.groupby("cluster").apply(lambda c: c["generation_mu"].corr(c["enhancement"]), include_groups=False)
    print("\nPearson of the 12 climatological means (generation vs enhancement):")
    print(corr.round(2).to_string())
    log.info("saved %s", plot_climatology(clim))


if __name__ == "__main__":
    main()
