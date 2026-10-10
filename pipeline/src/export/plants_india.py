"""plants_india.json and states.json: every Indian coal plant >= 500 MW with its state, and per-state totals.

Inputs (all committed): config/all_coal_plants_india.csv (GEM operating units summed per plant),
config/plant_states.csv and config/india_states.csv (src/ingest/states.py), config/plants.yaml.

plants_india.json  {boundaries, plants: [{id, name, lat, lon, capacity_mw, state, status, cluster_id}]}
  id          slug of the GEM plant name (unique)
  state       state / union territory name as in states.json
  status      "operating" for every row: the list is built from GEM operating units only
  cluster_id  one of the 11 analysed clusters when the plant is within SAME_PLANT_KM (3 km, the rule of
              risk_score.unreported_capacity) of a registry plant in plants.yaml, else null. Captive plants inside
              a cluster's ring that are not in the registry stay null.
states.json  {boundaries, states: [{code, name, lat, lon, plant_count, total_capacity_mw, plant_ids}]}
  all 36 states / union territories, by name; those without a listed plant have plant_count 0 and plant_ids [].
  lat/lon = centroid of the unit's largest polygon. plant_ids are ordered by capacity, largest first.
Neither file has a timestamp, so a re-export without new inputs is byte-identical.
"""

import re

import pandas as pd

from src.ingest import states
from src.ingest.plants import INDIA_CSV
from src.ingest.satellite import haversine_km
from src.scoring.risk_score import SAME_PLANT_KM

BOUNDARIES = "State and union territory boundaries: geoBoundaries gbOpen IND ADM1 (DataMeet India community), CC BY 2.5 IN"


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", states.plain(name).lower()).strip("-")


def cluster_of(plant: dict, registry: list[dict]) -> str | None:
    km, cluster = min((haversine_km(plant, r), r["cluster"]) for r in registry)
    return cluster if km <= SAME_PLANT_KM else None


def build(registry: list[dict]) -> tuple[dict, dict]:
    units = pd.read_csv(states.STATES_CSV, encoding="utf-8")
    name_of = dict(zip(units["code"], units["name"]))
    code_of = pd.read_csv(states.PLANT_STATES_CSV, encoding="utf-8").set_index("name")["state_code"]
    plants = []
    for p in pd.read_csv(INDIA_CSV).to_dict("records"):
        plants.append({"id": slug(p["name"]), "name": p["name"], "lat": p["lat"], "lon": p["lon"],
                       "capacity_mw": p["capacity_mw"], "state": name_of[code_of[p["name"]]], "status": "operating",
                       "cluster_id": cluster_of(p, registry)})
    assert len({p["id"] for p in plants}) == len(plants), "plant ids are not unique"
    rows = []
    for u in units.sort_values("name").to_dict("records"):
        members = sorted((p for p in plants if p["state"] == u["name"]), key=lambda p: -p["capacity_mw"])
        rows.append({"code": u["code"], "name": u["name"], "lat": u["lat"], "lon": u["lon"], "plant_count": len(members),
                     "total_capacity_mw": sum(p["capacity_mw"] for p in members), "plant_ids": [p["id"] for p in members]})
    return {"boundaries": BOUNDARIES, "plants": plants}, {"boundaries": BOUNDARIES, "states": rows}
