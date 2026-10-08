"""Join monthly cluster generation with NO2 enhancement and sanity-check the relationship.

Writes data/processed/cluster_monthly.parquet. For each cluster it prints the Pearson
and Spearman correlation between generation_mu and enhancement, and saves a chart to
docs/figures/. Months used: valid_fraction >= MIN_VALID and daily reports for >= 90% of the
month's days (generation_mu is a monthly sum).
The combined Apr+May 2020 row covers two months of generation, so it is kept in the
table (with the two months' NO2 averaged) but left out of the correlation.

Usage (from pipeline/):
    python -m src.process.cluster_monthly
"""

import logging
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

log = logging.getLogger(__name__)

PIPELINE_DIR = Path(__file__).resolve().parents[2]
PROCESSED = PIPELINE_DIR / "data" / "processed"
FIG_DIR = PIPELINE_DIR.parent / "docs" / "figures"
OUT_PATH = PROCESSED / "cluster_monthly.parquet"
MIN_VALID = 0.5
MIN_DAYS_SHARE = 0.9  # generation_mu is a sum, so months with missing daily reports are understated

GEN_COLOR, NO2_COLOR = "#2a78d6", "#eb6834"  # categorical slots 1-2 of the reference palette
INK, INK_2, GRID = "#0b0b0b", "#52514e", "#e4e3df"


def build() -> pd.DataFrame:
    gen = pd.read_parquet(PROCESSED / "generation_monthly.parquet")
    gen = gen[gen["entity_type"] == "cluster"].drop(columns="entity_type").rename(columns={"entity_id": "cluster"})
    no2 = pd.read_parquet(PROCESSED / "no2_monthly.parquet")
    no2 = (no2[no2["entity_type"] == "cluster"]
           .drop(columns=["entity_type", "overlapping"]).rename(columns={"entity_id": "cluster"}))

    # background_flag is a per-cluster constant; set aside so the averaging below leaves it alone.
    flags = no2.groupby("cluster")["background_flag"].first() if "background_flag" in no2 else None
    no2 = no2.drop(columns=["background_flag"], errors="ignore")

    # Satellite months matching the combined Apr+May 2020 generation row: average them onto April.
    gap = no2["month"].isin(pd.to_datetime(["2020-04-01", "2020-05-01"]))
    gap_mean = no2[gap].groupby("cluster").mean(numeric_only=True).reset_index().assign(month=pd.Timestamp("2020-04-01"))
    no2 = pd.concat([no2[~gap], gap_mean], ignore_index=True)
    if flags is not None:
        no2["background_flag"] = no2["cluster"].map(flags).astype("boolean")

    df = no2.merge(gen, on=["month", "cluster"], how="outer")
    df["combined_period"] = df["combined_period"].astype("boolean").fillna(False)
    complete = df["days_reported"] >= MIN_DAYS_SHARE * df["month"].dt.days_in_month
    df["used_in_corr"] = ((df["valid_fraction"] >= MIN_VALID) & complete & df["generation_mu"].notna()
                          & df["enhancement"].notna() & ~df["combined_period"])
    return df.sort_values(["cluster", "month"]).reset_index(drop=True)


def correlations(df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for cluster, g in df.groupby("cluster"):
        used = g[g["used_in_corr"]]
        has_gen = g["generation_mu"].notna() & ~g["combined_period"]
        low = g[(g["valid_fraction"] < MIN_VALID) & has_gen]
        incomplete = g[has_gen & (g["days_reported"] < MIN_DAYS_SHARE * g["month"].dt.days_in_month)]
        rows.append({
            "cluster": cluster,
            "months_used": len(used),
            "pearson": used["generation_mu"].corr(used["enhancement"], method="pearson"),
            # Spearman = Pearson on ranks (avoids a scipy dependency).
            "spearman": used["generation_mu"].rank().corr(used["enhancement"].rank()),
            "excluded_low_valid": len(low),
            "excluded_months": ", ".join(low["month"].dt.strftime("%Y-%m")),
            "excluded_incomplete": len(incomplete),
        })
    return pd.DataFrame(rows)


def plot(df: pd.DataFrame, stats: pd.DataFrame, fig_dir: Path = FIG_DIR) -> list[Path]:
    fig_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for cluster, g in df.groupby("cluster"):
        g = g[~g["combined_period"]]
        s = stats.set_index("cluster").loc[cluster]
        fig, ax1 = plt.subplots(figsize=(11, 4.2), dpi=150)
        ax2 = ax1.twinx()
        ax1.plot(g["month"], g["generation_mu"], color=GEN_COLOR, lw=2, label="Generation (MU/month)")
        valid = g["enhancement"].where(g["valid_fraction"] >= MIN_VALID)
        ax2.plot(g["month"], g["enhancement"] * 1e6, color=NO2_COLOR, lw=1, alpha=0.35)
        ax2.plot(g["month"], valid * 1e6, color=NO2_COLOR, lw=2, marker="o", ms=4,
                 label=f"NO₂ enhancement (µmol/m²), valid ≥ {MIN_VALID:.0%}")
        ax1.set_ylabel("Generation (MU / month)", color=INK_2)
        ax2.set_ylabel("NO₂ enhancement (µmol/m²)", color=INK_2)
        for ax in (ax1, ax2):
            ax.tick_params(colors=INK_2, labelsize=9)
            for side in ("top",):
                ax.spines[side].set_visible(False)
            ax.spines[["left", "right", "bottom"]].set_color(GRID)
        ax1.grid(axis="y", color=GRID, lw=0.8)
        ax1.set_title(f"{cluster.title()} cluster: generation vs NO₂ enhancement  "
                      f"(n={s.months_used}, Pearson {s.pearson:.2f}, Spearman {s.spearman:.2f})",
                      color=INK, fontsize=11, loc="left", pad=26)
        handles = ax1.get_legend_handles_labels()[0] + ax2.get_legend_handles_labels()[0]
        ax1.legend(handles=handles, loc="lower left", bbox_to_anchor=(0, 1.0), ncol=2, frameon=False,
                   fontsize=9, labelcolor=INK_2, borderaxespad=0.2)
        fig.text(0.01, 0.01, "Faded segments: months with valid_fraction below threshold (excluded). "
                 "Source: CEA DGR2, Sentinel-5P OFFL L3 NO₂.", fontsize=7.5, color=INK_2)
        fig.tight_layout(rect=(0, 0.03, 1, 1))
        path = fig_dir / f"cluster_{cluster}_generation_vs_no2.png"
        fig.savefig(path, facecolor="#fcfcfb")
        plt.close(fig)
        paths.append(path)
    return paths


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    df = build()
    df.to_parquet(OUT_PATH, index=False)
    log.info("wrote %d rows to %s", len(df), OUT_PATH)
    stats = correlations(df)
    with pd.option_context("display.width", 200, "display.max_colwidth", 400):
        print(stats.to_string(index=False, float_format=lambda v: f"{v:.3f}"))
    for p in plot(df, stats):
        log.info("saved %s", p)


if __name__ == "__main__":
    main()
