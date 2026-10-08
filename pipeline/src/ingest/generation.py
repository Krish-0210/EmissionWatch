"""Download and parse CEA daily plant-level generation reports.

Source: CEA Daily Generation Report, Subreport-2 (DGR2), published on the National
Power Portal as one legacy .xls file per day. The sheet is a hierarchy marked by label
rows (region -> state -> SECTOR: -> TYPE: -> plant -> Unit), not a flat table.
Its column layout changed over time (15 columns in 2019, 18 in 2026), so columns
are located by header text.

Usage (from pipeline/):
    python -m src.ingest.generation download --start 2019-01-01 [--end 2026-10-07]
    python -m src.ingest.generation parse
"""

import argparse
import logging
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import pandas as pd
import requests
import xlrd
import yaml

log = logging.getLogger(__name__)

PIPELINE_DIR = Path(__file__).resolve().parents[2]
RAW_DIR = PIPELINE_DIR / "data" / "raw" / "cea"
PROCESSED_PATH = PIPELINE_DIR / "data" / "processed" / "generation_daily.parquet"
PLANTS_PATH = PIPELINE_DIR / "config" / "plants.yaml"
MISSING_LOG = RAW_DIR / "missing_dates.log"

URL_TEMPLATE = "https://npp.gov.in/public-reports/cea/daily/dgr/{d:%d-%m-%Y}/dgr2-{d:%Y-%m-%d}.xls"
XLS_MAGIC = b"\xd0\xcf\x11\xe0"  # OLE2 compound file; a missing report returns an HTML 404 page
USER_AGENT = "Mozilla/5.0 (EmissionWatch research pipeline)"

# Old CSPGCL Korba East units (since retired). Never map them to Korba STPS (NTPC).
EXCLUDED_NAMES = {"KORBA-II", "KORBA-III"}

NUMERIC = ["monitored_capacity_mw", "planned_mu", "actual_mu", "actual_fy_to_date_mu", "outage_mw"]
COLUMNS = [
    "date", "plant_id", "cea_name", "unit", "monitored_capacity_mw", "planned_mu", "actual_mu",
    "actual_fy_to_date_mu", "outage_mw", "outage_reason",
]


# ---------------------------------------------------------------- download

def report_path(d: date, raw_dir: Path = RAW_DIR) -> Path:
    return raw_dir / f"dgr2-{d:%Y-%m-%d}.xls"


def _is_xls(path: Path) -> bool:
    with open(path, "rb") as f:
        return f.read(4) == XLS_MAGIC


def _log_missing(d: date, reason: str, log_path: Path) -> None:
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(f"{d:%Y-%m-%d}\t{reason}\n")


def download(start: date, end: date, raw_dir: Path = RAW_DIR, delay: float = 0.5,
             retries: int = 3, missing_log: Path = MISSING_LOG) -> dict:
    """Fetch DGR2 .xls files for start..end inclusive. Never raises on a missing date."""
    raw_dir.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    stats = {"downloaded": 0, "skipped": 0, "missing": 0}
    d = start
    while d <= end:
        path = report_path(d, raw_dir)
        if path.exists() and _is_xls(path):
            stats["skipped"] += 1
            d += timedelta(days=1)
            continue

        reason = None
        for attempt in range(1, retries + 1):
            try:
                resp = session.get(URL_TEMPLATE.format(d=d), timeout=60)
                if resp.status_code == 404:
                    reason = "404"
                    break
                resp.raise_for_status()
                if not resp.content.startswith(XLS_MAGIC):
                    reason = "not-xls"
                    break
                tmp = path.with_suffix(".part")
                tmp.write_bytes(resp.content)
                tmp.replace(path)
                reason = None
                break
            except requests.RequestException as e:
                reason = f"error: {e}"
                log.warning("%s attempt %d/%d failed: %s", d, attempt, retries, e)
                time.sleep(delay * 2 ** attempt)
        time.sleep(delay)

        if reason:
            stats["missing"] += 1
            _log_missing(d, reason, missing_log)
        else:
            stats["downloaded"] += 1
        if (stats["downloaded"] + stats["missing"]) % 50 == 0:
            log.info("%s: %s", d, stats)
        d += timedelta(days=1)
    log.info("download done: %s", stats)
    return stats


# ---------------------------------------------------------------- parse

def _norm(value) -> str:
    return " ".join(str(value).split())


def _num(value):
    if isinstance(value, (int, float)):
        return float(value)
    text = _norm(value)
    return float(text) if text else None


def load_name_map(plants_path: Path = PLANTS_PATH) -> dict:
    """Map each normalised CEA name to its plant_id."""
    plants = yaml.safe_load(plants_path.read_text(encoding="utf-8"))["plants"]
    name_map = {}
    for p in plants:
        for name in p["cea_names"]:
            key = _norm(name)
            if key in EXCLUDED_NAMES:
                raise ValueError(f"{p['id']}: cea_name {key!r} is excluded")
            name_map[key] = p["id"]
    return name_map


def _find_columns(sh) -> tuple[int, dict]:
    """Locate the header block and return (first data row, column index map)."""
    header = next(r for r in range(min(sh.nrows, 15)) if _norm(sh.cell_value(r, 0)).startswith("POWER STATION"))

    def find(row, pred):
        for c in range(sh.ncols):
            if pred(_norm(sh.cell_value(row, c)).upper()):
                return c
        raise ValueError(f"header not found in row {row}")

    cols = {
        "capacity": find(header, lambda t: t.startswith("MONITORED")),
        "outage": find(header, lambda t: t.startswith("CAP. UNDER OUTAGE")),
        "remarks": find(header, lambda t: t == "REMARKS"),
        "planned": find(header + 1, lambda t: t.startswith("TODAY'S PROGRAM")),
        "actual": find(header + 1, lambda t: t.startswith("TODAY'S ACTUAL")),
        "fy_planned": find(header + 1, lambda t: t.startswith("APRIL 1 TILL DATE")),
        "fy_actual": find(header + 2, lambda t: t == "ACTUAL"),
    }
    return header + 3, cols


def parse_file(path: Path, name_map: dict) -> list[dict]:
    """Extract plant-total and unit rows for registry plants from one DGR2 file."""
    report_date = datetime.strptime(path.stem.removeprefix("dgr2-"), "%Y-%m-%d").date()
    sh = xlrd.open_workbook(path).sheet_by_index(0)
    start, cols = _find_columns(sh)
    label_end = cols["capacity"]  # labels (sector/type names, unit numbers) sit left of the numbers

    def label(r):
        return next((_norm(sh.cell_value(r, c)) for c in range(1, label_end) if _norm(sh.cell_value(r, c))), "")

    def record(r, plant_id, cea_name, unit):
        reason = _norm(sh.cell_value(r, cols["remarks"]))
        return {
            "date": report_date,
            "plant_id": plant_id,
            "cea_name": cea_name,
            "unit": unit,
            "monitored_capacity_mw": _num(sh.cell_value(r, cols["capacity"])),
            "planned_mu": _num(sh.cell_value(r, cols["planned"])),
            "actual_mu": _num(sh.cell_value(r, cols["actual"])),
            "actual_fy_to_date_mu": _num(sh.cell_value(r, cols["fy_actual"])),
            "outage_mw": _num(sh.cell_value(r, cols["outage"])),
            "outage_reason": reason or None,
        }

    rows, seen = [], set()
    region = state = sector = plant_type = None
    current = None  # (plant_id, cea_name) of the registry plant whose unit rows follow
    for r in range(start, sh.nrows):
        name = _norm(sh.cell_value(r, 0))
        if not name or name in ("REGION TOTAL", "STATE TOTAL"):
            continue
        nxt = _norm(sh.cell_value(r + 1, 0)) if r + 1 < sh.nrows else ""
        if nxt == "REGION TOTAL":
            region, state, current = name, None, None
        elif nxt == "STATE TOTAL":
            state, current = name, None
        elif name == "SECTOR:":
            sector, current = label(r), None
        elif name == "TYPE:":
            plant_type, current = label(r), None
        elif name == "Unit":
            if current:
                rec = record(r, *current, label(r) or None)
                prev = rows[-1]
                if prev["cea_name"] == rec["cea_name"] and prev["unit"] is not None and prev["unit"] == rec["unit"]:
                    # A long remark wraps onto a repeated Unit row with duplicated numbers.
                    if rec["outage_reason"]:
                        prev["outage_reason"] = " ".join(filter(None, [prev["outage_reason"], rec["outage_reason"]]))
                    continue
                rows.append(rec)
        else:
            # A plant row. Only thermal plants from the registry count.
            current = None
            if name in name_map and name not in EXCLUDED_NAMES and plant_type == "THERMAL":
                current = (name_map[name], name)
                if name in seen:
                    raise ValueError(f"{path.name}: {name} appears twice")
                seen.add(name)
                rows.append(record(r, *current, None))
                log.debug("%s %s / %s / %s / %s", current, region, state, sector, plant_type)
    return _merge_totals(rows)


def _merge_totals(rows: list[dict]) -> list[dict]:
    """Sum plant-total rows when a plant is reported as several CEA rows (e.g. Adani Mundra after 2019).

    Unit rows are kept as they are; (cea_name, unit) identifies a unit.
    """
    totals: dict[str, dict] = {}
    out = []
    for row in rows:
        if row["unit"] is not None:
            out.append(row)
            continue
        merged = totals.get(row["plant_id"])
        if merged is None:
            totals[row["plant_id"]] = merged = dict(row)
            out.append(merged)
            continue
        merged["cea_name"] = f'{merged["cea_name"]} + {row["cea_name"]}'
        for col in NUMERIC:
            if row[col] is not None:
                merged[col] = (merged[col] or 0.0) + row[col]
        merged["outage_reason"] = None
    return out


def parse_all(raw_dir: Path = RAW_DIR, plants_path: Path = PLANTS_PATH) -> pd.DataFrame:
    name_map = load_name_map(plants_path)
    rows = []
    for path in sorted(raw_dir.glob("dgr2-*.xls")):
        try:
            rows.extend(parse_file(path, name_map))
        except Exception as e:  # keep going; one bad report should not stop the run
            log.warning("skipping %s: %s", path.name, e)
    df = pd.DataFrame(rows, columns=COLUMNS)
    df["date"] = pd.to_datetime(df["date"])
    # Plant total first, then units grouped by CEA row.
    order = df.assign(_is_unit=df["unit"].notna())
    return (order.sort_values(["date", "plant_id", "_is_unit", "cea_name", "unit"])
            .drop(columns="_is_unit").reset_index(drop=True))


def save(df: pd.DataFrame, out_path: Path = PROCESSED_PATH) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out_path, index=False)
    return out_path


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    dl = sub.add_parser("download")
    dl.add_argument("--start", type=date.fromisoformat, required=True)
    dl.add_argument("--end", type=date.fromisoformat, default=date.today())
    sub.add_parser("parse")
    args = parser.parse_args()

    if args.cmd == "download":
        download(args.start, args.end)
    else:
        df = parse_all()
        path = save(df)
        log.info("wrote %d rows (%d report dates) to %s", len(df), df["date"].nunique(), path)


if __name__ == "__main__":
    main()
