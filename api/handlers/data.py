"""Exported pipeline JSON in S3, cached in memory across warm Lambda invocations.

Objects live at s3://$DATA_BUCKET/$DATA_PREFIX<file> with the same names as
pipeline/data/export/ (clusters.json, cluster_{id}.json, timeseries_{id}.json, summary.json).
"""

import json
import os
import re
import time

import boto3
from botocore.exceptions import ClientError

CACHE_TTL_SECONDS = float(os.environ.get("CACHE_TTL_SECONDS", "300"))
CLUSTER_ID = re.compile(r"^[a-z0-9-]{1,40}$")

_cache: dict[str, tuple[float, str]] = {}  # key -> (fetched_at, body text)
_s3 = None


class NotFound(Exception):
    pass


def _client():
    global _s3
    if _s3 is None:
        _s3 = boto3.client("s3")
    return _s3


def clear_cache() -> None:
    global _s3
    _cache.clear()
    _s3 = None


def get_text(name: str) -> str:
    """Raw JSON text of one export file; NotFound if the object does not exist."""
    now = time.monotonic()
    hit = _cache.get(name)
    if hit and now - hit[0] < CACHE_TTL_SECONDS:
        return hit[1]
    bucket = os.environ["DATA_BUCKET"]
    key = os.environ.get("DATA_PREFIX", "data/") + name
    try:
        body = _client().get_object(Bucket=bucket, Key=key)["Body"].read().decode("utf-8")
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
            raise NotFound(name) from e
        raise
    _cache[name] = (now, body)
    return body


def get_json(name: str):
    return json.loads(get_text(name))


def cluster_ids() -> set[str]:
    return {c["id"] for c in get_json("clusters.json")["clusters"]}


def require_cluster(cid: str) -> str:
    """Validate a path id against clusters.json; NotFound for anything else."""
    if not cid or not CLUSTER_ID.match(cid) or cid not in cluster_ids():
        raise NotFound(cid)
    return cid
