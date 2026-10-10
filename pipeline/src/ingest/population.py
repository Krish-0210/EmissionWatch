"""Resident population within 20 km of each cluster centroid (the NO2 ring of satellite.py).

Source: GHSL GHS-POP R2023A, 2020 epoch (Earth Engine JRC/GHSL/P2023A/GHS_POP/2020, band population_count,
people per 100 m cell; European Commission JRC, reuse with acknowledgement):
  Schiavina, M., Freire, S., Carioli, A., MacManus, K. (2023): GHS-POP R2023A - GHS population grid
  multitemporal (1975-2030). European Commission, Joint Research Centre (JRC). doi:10.2905/2FF68A52-5B5B-4A22-8F40-C41DA8332CFE
GHS-POP is a modelled grid (census totals disaggregated onto built-up areas), not a head count, so the sum
is rounded to the nearest 100.

Writes data/processed/population_20km.csv: cluster, population_20km, dataset, epoch.

Usage (from pipeline/):
    python -m src.ingest.population
"""

import logging
import os
from pathlib import Path

import ee
import pandas as pd
from dotenv import load_dotenv

from src.ingest.satellite import cluster_centroids, load_plants

log = logging.getLogger(__name__)

PIPELINE_DIR = Path(__file__).resolve().parents[2]
OUT_PATH = PIPELINE_DIR / "data" / "processed" / "population_20km.csv"
ASSET, EPOCH, BAND = "JRC/GHSL/P2023A/GHS_POP/2020", 2020, "population_count"
RING_M, SCALE_M = 20_000, 100

SOURCE = {
    "id": "ghsl_pop",
    "name": "GHSL GHS-POP R2023A population grid, 2020 epoch (100 m)",
    "used_for": "population_20km: people living within 20 km of the cluster centroid (sum of the grid, rounded to 100)",
    "citation": "Schiavina, M., Freire, S., Carioli, A., MacManus, K. (2023): GHS-POP R2023A - GHS population grid "
                "multitemporal (1975-2030). European Commission, Joint Research Centre (JRC).",
    "doi": "10.2905/2FF68A52-5B5B-4A22-8F40-C41DA8332CFE",
    "access": "Google Earth Engine JRC/GHSL/P2023A/GHS_POP",
    "license": "European Commission reuse notice: free reuse with acknowledgement of the source",
}


def run() -> pd.DataFrame:
    load_dotenv(PIPELINE_DIR.parent / ".env")
    ee.Initialize(project=os.environ["GEE_PROJECT_ID"])
    image = ee.Image(ASSET).select(BAND)
    image = image.updateMask(image.gte(0))  # sea cells carry a negative no-data value instead of a mask
    centroids = cluster_centroids(load_plants())
    feats = ee.FeatureCollection([ee.Feature(ee.Geometry.Point([lon, lat]).buffer(RING_M), {"cluster": c})
                                  for c, (lon, lat) in centroids.items()])
    out = image.reduceRegions(collection=feats, reducer=ee.Reducer.sum(), scale=SCALE_M).getInfo()
    rows = [{"cluster": f["properties"]["cluster"], "population_20km": int(round(f["properties"]["sum"] / 100) * 100),
             "dataset": ASSET, "epoch": EPOCH} for f in out["features"]]
    df = pd.DataFrame(rows).sort_values("cluster").reset_index(drop=True)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT_PATH, index=False)
    return df


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    df = run()
    log.info("wrote %s", OUT_PATH)
    print(df.to_string(index=False))


if __name__ == "__main__":
    main()
