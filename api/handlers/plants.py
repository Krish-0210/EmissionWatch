"""Read endpoints: same shapes as frontend/src/api.ts (the exported JSON is served as-is)."""

from handlers import data


def clusters() -> str:
    return data.get_text("clusters.json")


def cluster(cid: str) -> str:
    return data.get_text(f"cluster_{data.require_cluster(cid)}.json")


def timeseries(cid: str) -> str:
    return data.get_text(f"timeseries_{data.require_cluster(cid)}.json")


def summary() -> str:
    return data.get_text("summary.json")
