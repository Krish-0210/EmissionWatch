"""Types and values of every served file against frontend/src/api.ts (the key-set checks are in test_api.py).

Strict JSON (no NaN/Infinity), numbers vs number|null, enum values, and the summary fields of
cluster_{id}.json equal to that cluster's row in clusters.json. The last section compares the specs with the
interfaces declared in api.ts: every interface is checked and its fields must equal the spec exactly.
"""

import json
import math
import re

import pytest

from conftest import CLUSTER_IDS, EXPORT

LEVEL = ("low", "medium", "high")
ANOMALY = ("persistent_excess", "intensity_trend", "peer_intensity", "none")
ADDED_SUMMARY = {"primary_anomaly_type": ANOMALY, "primary_anomaly_label": "str", "population_20km": "num"}
SUMMARY = {"id": "str", "name": "str", "states": ["str"], "lat": "num", "lon": "num", "capacity_mw": "num", "n_plants": "num",
           "risk_score": "num", "risk_level": LEVEL, "confidence": LEVEL, "headline": "str", **ADDED_SUMMARY}
PERIOD = {"start": "str", "end": "str", "peak_z": "num", "reason": ("excess", "score_window")}
SOURCE = {"id": "str", "name": "str", "used_for": "str", "access": "str", "license": "str|null", "citation": "str|null",
          "doi": "str|null"}
MS = {k: "num" for k in ("coef", "t", "p", "partial_r2", "r2", "n")}
DETAIL = dict(
    SUMMARY,
    as_of="str",
    flagged_periods=[PERIOD],
    plants=[{"id": "str", "name": "str", "state": "str", "lat": "num", "lon": "num", "capacity_mw": "num", "status": ("operating", "retired")}],
    weights={"persistent_excess": "num", "intensity_trend": "num", "peer_intensity": "num"},
    signals={
        "persistent_excess": {"z": "num", "score": "num"},
        "intensity_trend": {"pct_per_year": "num", "t": "num", "score": "num", "yearly": [{"year": "num", "coef": "num", "se": "num", "days": "num"}]},
        "peer_intensity": {"ratio": "num", "score": "num"},
    },
    model={"enhancement": MS, "ratio": MS},
    confidence_notes=["str"],
    coverage={"recent_valid_days": "num", "ring_capacity_mw": "num", "unreported_capacity_mw": "num", "unreported_plants": ["str"]},
)
MONTH = {"month": "str", **{k: "num|null" for k in ("generation_mu", "expected_no2", "observed_no2", "residual", "valid_fraction")}}
BACKTEST = {"cluster": "str", **{k: "num" for k in ("gen_2019", "gen_2020", "days_2019", "days_2020", "observed_2019", "observed_2020",
                                                   "predicted_2020", "gen_change_pct", "observed_change_pct", "predicted_change_pct", "error")}}
SUMMARY_FILE = {"generated_at": "str", "units": {"coef": "str", "backtest": "str"}, "pooled_model": {"enhancement": MS, "ratio": MS},
                "clusters": [{"id": "str", "generation_coef": "num", "p": "num"}], "backtest": [BACKTEST], "findings": ["str"], "sources": [SOURCE]}


def load(name: str):
    def reject(c):
        raise ValueError(f"{name}: non-standard JSON constant {c}")

    return json.loads((EXPORT / name).read_bytes().decode("utf-8"), parse_constant=reject)


def check(obj, spec, where: str, errs: list[str]):
    if isinstance(spec, dict):
        if not isinstance(obj, dict):
            return errs.append(f"{where}: expected object")
        for k, v in spec.items():
            if k not in obj:
                errs.append(f"{where}.{k}: missing")
            else:
                check(obj[k], v, f"{where}.{k}", errs)
    elif isinstance(spec, list):
        if not isinstance(obj, list):
            return errs.append(f"{where}: expected array")
        for i, o in enumerate(obj):
            check(o, spec[0], f"{where}[{i}]", errs)
    elif isinstance(spec, tuple):
        if obj not in spec:
            errs.append(f"{where}: {obj!r} not in {spec}")
    elif spec == "str":
        if not isinstance(obj, str):
            errs.append(f"{where}: expected string, got {obj!r}")
    elif spec == "str|null":
        if obj is not None and not isinstance(obj, str):
            errs.append(f"{where}: expected string or null, got {obj!r}")
    else:  # num / num|null
        if obj is None and spec == "num|null":
            return
        if isinstance(obj, bool) or not isinstance(obj, (int, float)) or not math.isfinite(obj):
            errs.append(f"{where}: expected {spec}, got {obj!r}")


def test_clusters_file():
    errs: list[str] = []
    check(load("clusters.json"), {"generated_at": "str", "as_of": "str", "clusters": [SUMMARY]}, "clusters.json", errs)
    assert not errs, errs


@pytest.mark.parametrize("cid", CLUSTER_IDS)
def test_cluster_and_timeseries_files(cid):
    errs: list[str] = []
    det = load(f"cluster_{cid}.json")
    check(det, DETAIL, f"cluster_{cid}", errs)
    row = next(c for c in load("clusters.json")["clusters"] if c["id"] == cid)
    errs += [f"cluster_{cid}.{k} != clusters.json" for k in SUMMARY if det.get(k) != row.get(k)]
    ts = load(f"timeseries_{cid}.json")
    check(ts, {"id": "str", "months": [MONTH]}, f"timeseries_{cid}", errs)
    errs += [f"timeseries_{cid}: bad month {m['month']!r}" for m in ts["months"] if len(m["month"]) != 7]
    assert ts["id"] == cid
    assert not errs, errs


def test_summary_file():
    errs: list[str] = []
    s = load("summary.json")
    check(s, SUMMARY_FILE, "summary.json", errs)
    assert {r["cluster"] for r in s["backtest"]} <= set(CLUSTER_IDS) | {"POOLED"}
    assert {c["id"] for c in s["clusters"]} == set(CLUSTER_IDS)
    assert not errs, errs


# ---------- Scorecard fields, flagged periods, sources, wind, plants and states ----------
TOWN = {"name": "str", "state": "str", "lat": "num", "lon": "num", "population": "num", "distance_km": "num", "bearing_deg": "num"}
TRACE = {"source": ("era5",), "as_of": "str", "speed_kmh": "num", "bearing_deg": "num",
         "cone_polygon": {"type": ("Polygon",), "coordinates": [[["num"]]]}, "towns_in_path": [TOWN], "sentence": "str",
         "attribution": "str"}
WIND_FILE = {"id": "str", "name": "str", "lat": "num", "lon": "num",
             "era5": {"date": "str", "time_utc": "str", "speed_kmh": "num", "from_deg": "num"},
             "cone": {"half_angle_deg": "num", "length_km": "num", "max_towns": "num", "min_town_population": "num"},
             "towns_within_cone_length": [TOWN], "trace": TRACE}


@pytest.mark.parametrize("cid", CLUSTER_IDS)
def test_added_cluster_fields(cid):
    errs: list[str] = []
    det = load(f"cluster_{cid}.json")
    check(det, ADDED_SUMMARY | {"flagged_periods": [PERIOD]}, f"cluster_{cid}", errs)
    row = next(c for c in load("clusters.json")["clusters"] if c["id"] == cid)
    check(row, ADDED_SUMMARY, f"clusters.json[{cid}]", errs)
    errs += [f"cluster_{cid}.{k} != clusters.json" for k in ADDED_SUMMARY if det.get(k) != row.get(k)]
    assert not errs, errs
    # primary anomaly = the signal adding the most points above neutral 50 (risk_score - 50 = sum w (s - 50))
    w, s = det["weights"], det["signals"]
    points = {k: w[k] * (s[k]["score"] - 50) for k in ("persistent_excess", "intensity_trend", "peer_intensity")}
    best = max(points, key=points.get)
    assert det["primary_anomaly_type"] == (best if points[best] > 0 else "none")
    assert abs(det["risk_score"] - 50 - sum(points.values())) < 0.01
    assert isinstance(det["population_20km"], int) and det["population_20km"] > 0 and det["population_20km"] % 100 == 0
    fp = det["flagged_periods"]
    assert 1 <= len(fp) <= 3
    for p in fp:
        assert len(p["start"]) == len(p["end"]) == 10 and p["start"] < p["end"] <= det["as_of"]
    assert [p["end"] for p in fp] == sorted((p["end"] for p in fp), reverse=True)


def test_labels_are_consistent():
    labels = {}
    for c in load("clusters.json")["clusters"]:
        labels.setdefault(c["primary_anomaly_type"], set()).add(c["primary_anomaly_label"])
    assert all(len(v) == 1 for v in labels.values()), labels


def test_summary_sources():
    errs: list[str] = []
    s = load("summary.json")
    check(s, {"sources": [SOURCE]}, "summary.json", errs)
    assert not errs, errs
    ghsl = next(x for x in s["sources"] if x["id"] == "ghsl_pop")
    assert "GHS-POP R2023A" in ghsl["citation"] and ghsl["doi"] == "10.2905/2FF68A52-5B5B-4A22-8F40-C41DA8332CFE"
    assert {"geonames", "open_meteo", "era5"} <= {x["id"] for x in s["sources"]}


INDIA_PLANT = {"id": "str", "name": "str", "lat": "num", "lon": "num", "capacity_mw": "num", "state": "str",
               "status": ("operating",), "cluster_id": "str|null"}
STATE = {"code": "str", "name": "str", "lat": "num", "lon": "num", "plant_count": "num", "total_capacity_mw": "num",
         "plant_ids": ["str"]}


def test_plants_and_states_files():
    """GET /plants and GET /states bodies (plants_india.json, states.json): types, and the two files agree."""
    errs: list[str] = []
    plants, states = load("plants_india.json"), load("states.json")
    check(plants, {"boundaries": "str", "plants": [INDIA_PLANT]}, "plants_india.json", errs)
    check(states, {"boundaries": "str", "states": [STATE]}, "states.json", errs)
    assert not errs, errs
    plants, states = plants["plants"], states["states"]
    assert all(set(p) == set(INDIA_PLANT) for p in plants) and all(set(s) == set(STATE) for s in states)
    ids = [p["id"] for p in plants]
    assert len(set(ids)) == len(ids) and all(re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", i) for i in ids)
    assert {p["cluster_id"] for p in plants} - {None} == set(CLUSTER_IDS)
    # every state / union territory is present (also those without a plant) and every plant is in exactly one
    by_name = {s["name"]: s for s in states}
    assert len(states) == len(by_name) == 36 and {"Ladakh", "Telangana"} <= set(by_name)
    assert by_name["Ladakh"]["plant_count"] == 0 and by_name["Ladakh"]["plant_ids"] == []
    assert sorted(i for s in states for i in s["plant_ids"]) == sorted(ids)
    for s in states:
        members = [p for p in plants if p["state"] == s["name"]]
        assert s["plant_count"] == len(members) == len(s["plant_ids"]) and {p["id"] for p in members} == set(s["plant_ids"])
        assert abs(s["total_capacity_mw"] - sum(p["capacity_mw"] for p in members)) < 1e-6
    # plants of an analysed cluster lie in one of that cluster's states (clusters.json)
    cluster_states = {c["id"]: set(c["states"]) for c in load("clusters.json")["clusters"]}
    assert all(p["state"] in cluster_states[p["cluster_id"]] for p in plants if p["cluster_id"])
    assert "geoboundaries_ind_adm1" in {x["id"] for x in load("summary.json")["sources"]}


@pytest.mark.parametrize("cid", CLUSTER_IDS)
def test_wind_file(cid):
    errs: list[str] = []
    w = load(f"wind_{cid}.json")
    check(w, WIND_FILE, f"wind_{cid}", errs)
    assert not errs, errs
    assert w["id"] == cid
    assert all(t["population"] > 50_000 and t["distance_km"] <= 75 for t in w["towns_within_cone_length"])
    assert w["trace"]["bearing_deg"] == round((w["era5"]["from_deg"] + 180) % 360, 1)


# ---------- The specs above against the live frontend/src/api.ts (strict) ----------
API_TS = EXPORT.parents[1] / "src" / "api.ts"
# Interface -> the spec (or key set) the API serves for it. WindTrace: the file spec has source ("era5",); the API
# also answers "live" (test_wind.py); the keys are the same.
INTERFACES = {
    "ClusterSummary": SUMMARY,
    "ClustersFile": {"generated_at", "as_of", "clusters"},
    "Plant": DETAIL["plants"][0],
    "ModelStats": MS,
    "Signals": DETAIL["signals"],
    "FlaggedPeriod": PERIOD,
    "ClusterDetail": DETAIL,
    "MonthPoint": MONTH,
    "TimeseriesFile": {"id", "months"},
    "BacktestRow": BACKTEST,
    "Source": SOURCE,
    "SummaryFile": SUMMARY_FILE,
    "IndiaPlant": INDIA_PLANT,
    "PlantsIndiaFile": {"boundaries", "plants"},
    "StateSummary": STATE,
    "StatesFile": {"boundaries", "states"},
    "WindTown": TOWN,
    "WindTrace": TRACE,
    "RtiDraft": {"markdown", "plain_text"},
    "Brief": {"markdown", "source"},
}


def ts_interfaces() -> dict[str, set[str]]:
    """Top-level keys of every `export interface` in api.ts (inline object types are not descended; extends merged)."""
    src = API_TS.read_text(encoding="utf-8")
    out: dict[str, set[str]] = {}
    for m in re.finditer(r"^export interface (\w+)(?: extends (\w+))? \{\n(.*?)^\}", src, re.M | re.S):
        keys = set(re.findall(r"^  (\w+)\??:", m.group(3), re.M))
        out[m.group(1)] = keys | out.get(m.group(2), set()) if m.group(2) else keys
    return out


def test_every_api_ts_interface_is_checked():
    """A new interface in api.ts needs a spec here (and a served shape) before this passes."""
    assert set(ts_interfaces()) == set(INTERFACES)


@pytest.mark.parametrize("iface", INTERFACES)
def test_specs_match_api_ts(iface):
    """The fields api.ts declares are exactly the fields the API serves: nothing missing, nothing extra."""
    keys, spec = ts_interfaces()[iface], set(INTERFACES[iface])
    assert keys == spec, {"only in api.ts": keys - spec, "only in the API": spec - keys}


def _union(src: str, iface: str, field: str) -> set[str]:
    return set(re.findall(r"'(\w+)'", re.search(rf"interface {iface} \{{.*?^  {field}: ([^\n/]+)", src, re.S | re.M).group(1)))


def test_unions_match_api_ts():
    """String unions in api.ts equal the values the API can return."""
    src = API_TS.read_text(encoding="utf-8")
    assert _union(src, "Brief", "source") == {"auto", "bedrock", "template"}  # handlers/brief.py
    assert _union(src, "WindTrace", "source") == {"live", "era5"}  # handlers/wind.py
    assert _union(src, "FlaggedPeriod", "reason") == set(PERIOD["reason"])
    assert _union(src, "Plant", "status") == set(DETAIL["plants"][0]["status"])
    assert _union(src, "IndiaPlant", "status") == set(INDIA_PLANT["status"])
    anomaly = re.search(r"^export type AnomalyType = ([^\n]+)", src, re.M).group(1)
    assert set(re.findall(r"'(\w+)'", anomaly)) == set(ANOMALY)
    level = re.search(r"^export type RiskLevel = ([^\n]+)", src, re.M).group(1)
    assert set(re.findall(r"'(\w+)'", level)) == set(LEVEL)
