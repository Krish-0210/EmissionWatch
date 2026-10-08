"""Fixtures: a moto S3 bucket loaded with the real exported JSON, and a fake Bedrock client."""

import json
import os
from pathlib import Path

import boto3
import pytest
from moto import mock_aws

ROOT = Path(__file__).resolve().parents[2]
# Same files in both places; the pipeline export is gitignored, the frontend copy is committed.
EXPORT = next(p for p in (ROOT / "pipeline/data/export", ROOT / "frontend/public/data") if (p / "clusters.json").exists())
BUCKET = "emissionwatch-test-data"
CLUSTER_IDS = [c["id"] for c in json.loads((EXPORT / "clusters.json").read_text(encoding="utf-8"))["clusters"]]


@pytest.fixture(autouse=True)
def aws(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "ap-south-1")
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    monkeypatch.setenv("DATA_BUCKET", BUCKET)
    monkeypatch.setenv("DATA_PREFIX", "data/")
    monkeypatch.setenv("BEDROCK_MODEL_ID", "in.anthropic.claude-haiku-4-5-20251001-v1:0")
    from handlers import brief, data

    data.clear_cache()
    brief._bedrock = None
    with mock_aws():
        s3 = boto3.client("s3", region_name="ap-south-1")
        s3.create_bucket(Bucket=BUCKET, CreateBucketConfiguration={"LocationConstraint": "ap-south-1"})
        for f in EXPORT.glob("*.json"):
            s3.put_object(Bucket=BUCKET, Key=f"data/{f.name}", Body=f.read_bytes())
        yield s3
    data.clear_cache()


class FakeBedrock:
    """Stands in for the bedrock-runtime client; records calls."""

    def __init__(self, reply=None, error: Exception | None = None):
        self.reply, self.error, self.calls = reply, error, []

    def converse(self, **kw):
        self.calls.append(kw)
        if self.error:
            raise self.error
        text = self.reply(kw) if callable(self.reply) else self.reply
        return {"output": {"message": {"role": "assistant", "content": [{"text": text}]}}}


@pytest.fixture
def bedrock(monkeypatch):
    from handlers import brief

    def install(**kw):
        fake = FakeBedrock(**kw)
        monkeypatch.setattr(brief, "_bedrock_client", lambda: fake)
        return fake

    return install


def event(method: str, route: str, cid: str | None = None) -> dict:
    path = route.replace("{id}", cid or "")
    return {
        "version": "2.0",
        "routeKey": f"{method} {route}",
        "rawPath": path,
        "pathParameters": {"id": cid} if cid is not None else None,
        "requestContext": {"http": {"method": method, "path": path}},
    }


def call(method: str, route: str, cid: str | None = None):
    from handlers.app import handler

    r = handler(event(method, route, cid))
    return r["statusCode"], json.loads(r["body"])
