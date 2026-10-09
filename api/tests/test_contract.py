"""Types and values of every served file against frontend/src/api.ts (the key-set checks are in test_api.py).

Strict JSON (no NaN/Infinity), numbers vs number|null, enum values, and the summary fields of
cluster_{id}.json equal to that cluster's row in clusters.json.
"""

import json
import math

import pytest

from conftest import CLUSTER_IDS, EXPORT

LEVEL = ("low", "medium", "high")
SUMMARY = {"id": "str", "name": "str", "states": ["str"], "lat": "num", "lon": "num", "capacity_mw": "num", "n_plants": "num",
           "risk_score": "num", "risk_level": LEVEL, "confidence": LEVEL, "headline": "str"}
MS = {k: "num" for k in ("coef", "t", "p", "partial_r2", "r2", "n")}
DETAIL = dict(
    SUMMARY,
    as_of="str",
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
                "clusters": [{"id": "str", "generation_coef": "num", "p": "num"}], "backtest": [BACKTEST], "findings": ["str"]}


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
