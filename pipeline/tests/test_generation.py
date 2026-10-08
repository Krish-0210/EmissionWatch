"""Parser checks against one 2019-layout and one 2026-layout DGR2 report.

Run from pipeline/:  python -m tests.test_generation   (or: python -m pytest tests)
Downloads the two reports into data/raw/cea/ if they are not already there.
"""

from datetime import date

import yaml

from src.ingest.generation import PLANTS_PATH, download, load_name_map, parse_file, report_path

SAMPLE_DATES = [date(2019, 1, 15), date(2026, 10, 6)]
PLANTS = yaml.safe_load(PLANTS_PATH.read_text(encoding="utf-8"))["plants"]
ALL_IDS = {p["id"] for p in PLANTS}
# Registry plants that are legitimately absent from a sample report.
ABSENT = {
    date(2019, 1, 15): {"sepc-tuticorin"},                    # not yet in DGR2
    date(2026, 10, 6): {"talcher-old-tps", "neyveli-tps-i"},  # retired
}
# Plants reported as several CEA rows that must be summed into one total.
MULTI_ROW = {date(2026, 10, 6): {"adani-mundra-tpp": 2, "ramagundam-stps": 2, "neyveli-tps-ii": 2},
             date(2019, 1, 15): {"neyveli-tps-ii": 2}}


def _rows(d):
    if not report_path(d).exists():
        download(d, d)
    return parse_file(report_path(d), load_name_map())


def test_all_plants_found():
    for d in SAMPLE_DATES:
        totals = [r for r in _rows(d) if r["unit"] is None]
        found = {r["plant_id"] for r in totals}
        expected = ALL_IDS - ABSENT[d]
        assert found == expected, f"{d}: missing {expected - found}, unexpected {found - expected}"
        assert len(totals) == len(expected), f"{d}: duplicate plant rows"


def test_multi_row_plants_summed():
    for d, plants in MULTI_ROW.items():
        totals = {r["plant_id"]: r for r in _rows(d) if r["unit"] is None}
        for pid, n in plants.items():
            assert len(totals[pid]["cea_name"].split(" + ")) == n, (d, pid, totals[pid]["cea_name"])


def test_values_and_units():
    for d in SAMPLE_DATES:
        rows = _rows(d)
        for r in rows:
            assert r["monitored_capacity_mw"] is not None and r["actual_mu"] is not None, r
            assert r["actual_fy_to_date_mu"] is not None, r
        for pid in ALL_IDS - ABSENT[d]:
            total = next(r for r in rows if r["plant_id"] == pid and r["unit"] is None)
            units = [r for r in rows if r["plant_id"] == pid and r["unit"] is not None]
            if total["monitored_capacity_mw"] == 0:
                continue  # not yet commissioned in this report
            assert units, f"{d} {pid}: no unit rows"
            keys = [(u["cea_name"], u["unit"]) for u in units]
            assert len(set(keys)) == len(keys), f"{d} {pid}: duplicate unit rows"
            # Unit capacities should add up to the plant's monitored capacity.
            assert abs(sum(u["monitored_capacity_mw"] for u in units) - total["monitored_capacity_mw"]) < 1, f"{d} {pid}"


def test_known_values():
    # Spot values read by hand from the files.
    vin_2019 = next(r for r in _rows(date(2019, 1, 15)) if r["plant_id"] == "vindhyachal-stps" and r["unit"] is None)
    assert (vin_2019["monitored_capacity_mw"], vin_2019["actual_mu"], vin_2019["actual_fy_to_date_mu"]) == (4760.0, 102.78, 29959.74)
    vin_u5 = next(r for r in _rows(date(2026, 10, 6)) if r["plant_id"] == "vindhyachal-stps" and r["unit"] == "5")
    assert vin_u5["actual_mu"] == 0.0 and vin_u5["outage_mw"] == 210.0 and vin_u5["outage_reason"] == "OVERHAULING WORKS"
    # Adani Mundra: one 4620 MW row in 2019, two rows (2640 + 1980) in 2026.
    for d in SAMPLE_DATES:
        mundra = next(r for r in _rows(d) if r["plant_id"] == "adani-mundra-tpp" and r["unit"] is None)
        assert mundra["monitored_capacity_mw"] == 4620.0, (d, mundra)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("PASS", name)
