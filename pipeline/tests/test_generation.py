"""Parser checks against one 2019-layout and one 2026-layout DGR2 report.

Run from pipeline/:  python -m tests.test_generation   (or: python -m pytest tests)
Downloads the two reports into data/raw/cea/ if they are not already there.
"""

from datetime import date

import yaml

from src.ingest.generation import PLANTS_PATH, download, load_name_map, parse_file, report_path

SAMPLE_DATES = [date(2019, 1, 15), date(2026, 10, 6)]
EXPECTED_IDS = {p["id"] for p in yaml.safe_load(PLANTS_PATH.read_text(encoding="utf-8"))["plants"]}


def _rows(d):
    if not report_path(d).exists():
        download(d, d)
    return parse_file(report_path(d), load_name_map())


def test_all_plants_found():
    for d in SAMPLE_DATES:
        totals = [r for r in _rows(d) if r["unit"] is None]
        found = {r["plant_id"] for r in totals}
        assert found == EXPECTED_IDS, f"{d}: missing {EXPECTED_IDS - found}"
        assert len(totals) == len(EXPECTED_IDS), f"{d}: duplicate plant rows"


def test_values_and_units():
    for d in SAMPLE_DATES:
        rows = _rows(d)
        for r in rows:
            assert r["monitored_capacity_mw"] is not None and r["actual_mu"] is not None, r
            assert r["actual_fy_to_date_mu"] is not None, r
        # Unit capacities should add up to the plant's monitored capacity.
        for pid in EXPECTED_IDS:
            total = next(r for r in rows if r["plant_id"] == pid and r["unit"] is None)
            units = [r for r in rows if r["plant_id"] == pid and r["unit"] is not None]
            assert units, f"{d} {pid}: no unit rows"
            assert len({u["unit"] for u in units}) == len(units), f"{d} {pid}: duplicate unit rows"
            assert abs(sum(u["monitored_capacity_mw"] for u in units) - total["monitored_capacity_mw"]) < 1, f"{d} {pid}"


def test_known_values():
    # Spot values read by hand from the files.
    vin_2019 = next(r for r in _rows(date(2019, 1, 15)) if r["plant_id"] == "vindhyachal-stps" and r["unit"] is None)
    assert (vin_2019["monitored_capacity_mw"], vin_2019["actual_mu"], vin_2019["actual_fy_to_date_mu"]) == (4760.0, 102.78, 29959.74)
    vin_u5 = next(r for r in _rows(date(2026, 10, 6)) if r["plant_id"] == "vindhyachal-stps" and r["unit"] == "5")
    assert vin_u5["actual_mu"] == 0.0 and vin_u5["outage_mw"] == 210.0 and vin_u5["outage_reason"] == "OVERHAULING WORKS"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("PASS", name)
