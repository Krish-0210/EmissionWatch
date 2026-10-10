"""Tests for the additive exports: flagged periods, primary anomaly, wind trace geometry, towns list.

Run from pipeline/:  python -m tests.test_exports
"""

import json

import pandas as pd

from src.export import to_json, wind
from src.ingest import towns
from src.scoring import risk_score


def _rolling(zs: dict[str, float], cluster="x") -> pd.DataFrame:
    return pd.DataFrame({"date": pd.to_datetime(list(zs)), "cluster": cluster, "rolling_z": list(zs.values())})


def test_flagged_periods_merge_and_window():
    days = pd.date_range("2024-01-01", "2026-06-30", freq="D")
    z = pd.Series(0.0, index=days)
    z["2025-03-01":"2025-03-10"] = 2.0  # run A
    z["2025-03-25":"2025-04-01"] = 2.5  # within 30 days of A's end once A's 90-day window is counted -> merged
    z["2026-05-01":"2026-05-02"] = 1.6  # run B
    r = _rolling({d: v for d, v in z.items()})
    p = risk_score.flagged_periods(r, "x")
    assert [x["reason"] for x in p] == ["excess", "excess"]
    assert p[0] == {"start": "2026-02-01", "end": "2026-05-02", "peak_z": 1.6, "reason": "excess"}  # newest first
    assert p[1]["start"] == "2024-12-02" and p[1]["end"] == "2025-04-01" and p[1]["peak_z"] == 2.5


def test_flagged_periods_fallback_to_score_window():
    days = pd.date_range("2025-01-01", "2025-12-31", freq="D")
    r = _rolling({d: 0.3 for d in days})
    assert risk_score.flagged_periods(r, "x") == [{"start": "2025-10-03", "end": "2025-12-31", "peak_z": 0.3, "reason": "score_window"}]


def test_flagged_periods_only_recent_years():
    days = pd.date_range("2019-01-01", "2026-06-30", freq="D")
    z = pd.Series(0.0, index=days)
    z["2020-05-01":"2020-05-05"] = 3.0  # older than 3 years before the end of data -> dropped
    r = _rolling({d: v for d, v in z.items()})
    assert risk_score.flagged_periods(r, "x")[0]["reason"] == "score_window"


def test_primary_anomaly():
    base = {"excess_score": 50.0, "trend_score": 50.0, "peer_score": 50.0}
    assert to_json.primary_anomaly(base) == "none"
    assert to_json.primary_anomaly(base | {"excess_score": 60.0, "peer_score": 75.0}) == "peer_intensity"  # 5 vs 6.25 points
    assert to_json.primary_anomaly(base | {"excess_score": 70.0, "peer_score": 75.0}) == "persistent_excess"  # 10 vs 6.25
    assert to_json.primary_anomaly(base | {"trend_score": 51.0, "excess_score": 10.0}) == "intensity_trend"


def test_wind_geometry():
    lat, lon = 22.39, 82.70
    la, lo = wind.destination(lat, lon, 90, 75)
    assert abs(wind.haversine_km(lat, lon, la, lo) - 75) < 0.01 and abs(wind.initial_bearing(lat, lon, la, lo) - 90) < 0.01
    assert wind.angle_diff(350, 10) == 20 and wind.angle_diff(10, 350) == 20
    ring = wind.cone_polygon(lat, lon, 135)["coordinates"][0]
    assert ring[0] == ring[-1] and len(ring) == 15
    cands = [{"name": "A", "state": "", "lat": 0, "lon": 0, "population": 60000, "distance_km": d, "bearing_deg": b}
             for d, b in [(10, 100), (20, 170), (30, 106), (40, 164), (50, 135), (60, 140), (70, 150)]]
    t = wind.trace("X", lat, lon, cands, "era5", "2026-10-01T13:30+05:30", 10, 315)  # FROM 315 -> heads 135
    assert t["bearing_deg"] == 135 and [c["distance_km"] for c in t["towns_in_path"]] == [30, 40, 50, 60, 70]


def test_towns_file():
    t = pd.read_csv(towns.OUT_PATH, encoding="utf-8")
    assert len(t) > 1000 and (t["population"] > 50_000).all() and t["geonameid"].is_unique
    assert "Chandrapur" in set(t["name"]) and "Chanda" not in set(t["name"])
    assert not ({"Vriddhachalam", "Virudhachalam"} <= set(t["name"]))


def test_export_is_additive():
    """Exported cluster rows have exactly the api.ts fields plus the documented additions."""
    c = json.loads((to_json.EXPORT_DIR / "clusters.json").read_text(encoding="utf-8"))
    api_ts = {"id", "name", "states", "lat", "lon", "capacity_mw", "n_plants", "risk_score", "risk_level", "confidence", "headline"}
    added = {"primary_anomaly_type", "primary_anomaly_label", "population_20km"}
    assert all(set(r) == api_ts | added for r in c["clusters"])


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("PASS", name)
