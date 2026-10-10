"""Tests for the state assignment and plants_india.json / states.json (src/ingest/states.py, src/export/plants_india.py).

They read the committed config files, not the boundary download. Run from pipeline/:
    python -m tests.test_plants_india        (or pytest tests/test_plants_india.py)
"""

import pandas as pd

from src.export import plants_india
from src.ingest import states
from src.ingest.plants import INDIA_CSV
from src.ingest.satellite import haversine_km, load_plants
from src.scoring.risk_score import SAME_PLANT_KM

CLUSTERS = {"singrauli", "korba", "marwa", "talcher", "jharsuguda", "chandrapur", "mundra", "ramagundam", "kahalgaon",
            "neyveli", "tuticorin"}


def _build():
    registry = load_plants()
    plants, units = plants_india.build(registry)
    return registry, plants["plants"], units["states"]


def test_point_in_polygon():
    square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
    hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]
    assert states.in_polygon(2, 2, [square, hole]) and not states.in_polygon(5, 5, [square, hole])
    assert not states.in_polygon(11, 5, [square]) and not states.in_polygon(5, -1, [square])
    area, lon, lat = states.ring_area_centroid(square)
    assert (area, lon, lat) == (100, 5, 5)
    assert states.plain("Chhattīsgarh") == "Chhattisgarh" and plants_india.slug("Mundra Thermal Power Project (Adani)") == "mundra-thermal-power-project-adani"


def test_every_plant_has_a_state():
    _, plants, units = _build()
    names = {u["name"] for u in units}
    assert len(plants) == len(pd.read_csv(INDIA_CSV)) and len({p["id"] for p in plants}) == len(plants)
    assert all(p["state"] in names for p in plants)
    assert all(set(p) == {"id", "name", "lat", "lon", "capacity_mw", "state", "status", "cluster_id"} for p in plants)
    assert all(p["capacity_mw"] >= 500 and p["status"] == "operating" for p in plants)


def test_states_file():
    _, plants, units = _build()
    by_name = {u["name"]: u for u in units}
    assert len(units) == 36 and len(by_name) == 36 and [u["name"] for u in units] == sorted(by_name)
    assert {"Ladakh", "Telangana", "Jammu and Kashmir", "Andhra Pradesh"} <= set(by_name)  # separate units
    assert by_name["Ladakh"]["plant_count"] == 0 and by_name["Ladakh"]["plant_ids"] == [] and by_name["Ladakh"]["total_capacity_mw"] == 0
    assert all(by_name[s]["plant_count"] >= 5 for s in ("Chhattisgarh", "Madhya Pradesh", "Odisha", "Uttar Pradesh", "Maharashtra"))
    assert by_name["Telangana"]["plant_count"] >= 1
    assert all(6 < u["lat"] < 36 and 68 < u["lon"] < 98 for u in units)
    # every plant is listed under exactly one state, and the totals add up
    listed = [i for u in units for i in u["plant_ids"]]
    assert sorted(listed) == sorted(p["id"] for p in plants)
    assert all(u["plant_count"] == len(u["plant_ids"]) for u in units)
    cap = {p["id"]: p["capacity_mw"] for p in plants}
    assert all(abs(u["total_capacity_mw"] - sum(cap[i] for i in u["plant_ids"])) < 1e-6 for u in units)
    assert sum(u["plant_count"] for u in units) == len(plants)


def test_cluster_plants_are_matched():
    """Each operating registry plant >= 500 MW (the size cut of the GEM list) has a GEM plant within 3 km that carries
    its cluster and lies in the registry's state; all 11 clusters appear."""
    registry, plants, _ = _build()
    assert {p["cluster_id"] for p in plants} - {None} == CLUSTERS
    for r in registry:
        if r.get("status", "operating") != "operating" or r["capacity_mw"] < 500:
            continue
        km, g = min(((haversine_km(r, p), p) for p in plants), key=lambda t: t[0])
        assert km <= SAME_PLANT_KM and g["cluster_id"] == r["cluster"] and g["state"] == r["state"], (r["id"], km, g)
    # a plant with a cluster is within 3 km of that cluster's registry plants
    for p in plants:
        if p["cluster_id"]:
            assert min(haversine_km(p, r) for r in registry if r["cluster"] == p["cluster_id"]) <= SAME_PLANT_KM


def test_known_plants():
    _, plants, _ = _build()
    state = {p["id"]: p["state"] for p in plants}
    assert state["vindhyachal-power-station"] == "Madhya Pradesh" and state["rihand-power-station"] == "Uttar Pradesh"
    assert state["ramagundam-power-station"] == "Telangana" and state["mundra-thermal-power-project-adani"] == "Gujarat"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("PASS", name)
