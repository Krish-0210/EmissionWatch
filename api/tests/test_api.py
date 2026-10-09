"""Endpoint shapes against frontend/src/api.ts, 404s, and the brief's Bedrock/template paths."""

import json

import pytest
from botocore.exceptions import ClientError, ReadTimeoutError

from conftest import CLUSTER_IDS, EXPORT, PIPELINE_EXPORT, call, event
from handlers.app import handler

# Keys of the TypeScript interfaces in frontend/src/api.ts.
SUMMARY_KEYS = {"id", "name", "states", "lat", "lon", "capacity_mw", "n_plants", "risk_score", "risk_level", "confidence", "headline"}
DETAIL_KEYS = SUMMARY_KEYS | {"as_of", "plants", "weights", "signals", "model", "confidence_notes", "coverage"}
PLANT_KEYS = {"id", "name", "state", "lat", "lon", "capacity_mw", "status"}
MODEL_KEYS = {"coef", "t", "p", "partial_r2", "r2", "n"}
MONTH_KEYS = {"month", "generation_mu", "expected_no2", "observed_no2", "residual", "valid_fraction"}
BACKTEST_KEYS = {"cluster", "gen_2019", "gen_2020", "days_2019", "days_2020", "observed_2019", "observed_2020", "predicted_2020", "gen_change_pct", "observed_change_pct", "predicted_change_pct", "error"}


def test_eleven_clusters():
    assert len(CLUSTER_IDS) == 11


def test_clusters_list():
    status, body = call("GET", "/clusters")
    assert status == 200
    assert {"generated_at", "as_of", "clusters"} <= body.keys()
    assert [c["id"] for c in body["clusters"]] == CLUSTER_IDS
    for c in body["clusters"]:
        assert set(c) == SUMMARY_KEYS
        assert c["risk_level"] in ("low", "medium", "high") and c["confidence"] in ("low", "medium", "high")
        assert 0 <= c["risk_score"] <= 100


@pytest.mark.parametrize("cid", CLUSTER_IDS)
def test_cluster_detail(cid):
    status, c = call("GET", "/clusters/{id}", cid)
    assert status == 200
    assert set(c) == DETAIL_KEYS and c["id"] == cid
    assert c["plants"] and all(set(p) == PLANT_KEYS for p in c["plants"])
    assert set(c["weights"]) == {"persistent_excess", "intensity_trend", "peer_intensity"}
    s = c["signals"]
    assert {"z", "score"} <= s["persistent_excess"].keys()
    assert {"pct_per_year", "t", "score", "yearly"} <= s["intensity_trend"].keys()
    assert {"ratio", "score"} <= s["peer_intensity"].keys()
    assert set(c["model"]) == {"enhancement", "ratio"} and set(c["model"]["enhancement"]) == MODEL_KEYS
    assert set(c["coverage"]) == {"recent_valid_days", "ring_capacity_mw", "unreported_capacity_mw", "unreported_plants"}
    # Served unchanged from the export.
    assert c == json.loads((EXPORT / f"cluster_{cid}.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("cid", CLUSTER_IDS)
def test_timeseries(cid):
    status, t = call("GET", "/clusters/{id}/timeseries", cid)
    assert status == 200
    assert t["id"] == cid and t["months"]
    assert all(set(m) == MONTH_KEYS for m in t["months"])


def test_summary():
    status, s = call("GET", "/summary")
    assert status == 200
    assert {"generated_at", "units", "pooled_model", "clusters", "backtest", "findings"} <= s.keys()
    assert set(s["pooled_model"]["enhancement"]) == MODEL_KEYS
    assert {c["id"] for c in s["clusters"]} == set(CLUSTER_IDS)
    assert all(set(r) == BACKTEST_KEYS for r in s["backtest"])
    assert s["findings"] and all(isinstance(f, str) for f in s["findings"])


@pytest.mark.parametrize("route,method", [("/clusters/{id}", "GET"), ("/clusters/{id}/timeseries", "GET"), ("/brief/{id}", "POST")])
@pytest.mark.parametrize("cid", ["atlantis", "", "../summary", "TALCHER", "a" * 60])
def test_unknown_cluster_404(route, method, cid, bedrock):
    fake = bedrock(reply="unused")
    status, body = call(method, route, cid)
    assert status == 404 and body == {"error": "not found"}
    assert fake.calls == []


def test_unknown_route_404():
    assert call("GET", "/plants")[0] == 404
    assert call("DELETE", "/clusters")[0] == 404


def test_responses_are_cached(aws):
    call("GET", "/clusters/{id}", "talcher")
    aws.delete_object(Bucket="emissionwatch-test-data", Key="data/cluster_talcher.json")
    assert call("GET", "/clusters/{id}", "talcher")[0] == 200


# ---------- brief ----------

def good_reply(kw):
    """A compliant model answer that only reuses numbers from the FACTS in the prompt."""
    facts = json.loads(kw["messages"][0]["content"][0]["text"].split("\n", 1)[1].split("\n\nMETHOD:")[0])
    return (
        f"## Inspection brief: {facts['cluster']}\n\n### Summary\nAudit Risk Score {facts['audit_risk_score']}/100, "
        f"{facts['risk_level']} risk. This is an anomaly that warrants an audit, not proof of a violation."
    )


@pytest.mark.parametrize("cid", CLUSTER_IDS)
def test_brief_bedrock(cid, bedrock):
    fake = bedrock(reply=good_reply)
    status, b = call("POST", "/brief/{id}", cid)
    assert status == 200 and set(b) == {"markdown", "source"}
    assert b["source"] == "bedrock"
    kw = fake.calls[0]
    assert kw["modelId"] == "in.anthropic.claude-haiku-4-5-20251001-v1:0"
    assert "not proof of a violation" in kw["system"][0]["text"] and "Do not add" in kw["system"][0]["text"]


@pytest.mark.parametrize("cid", CLUSTER_IDS)
@pytest.mark.parametrize(
    "error",
    [
        ClientError({"Error": {"Code": "AccessDeniedException", "Message": "no access"}}, "Converse"),
        ClientError({"Error": {"Code": "ThrottlingException", "Message": "slow down"}}, "Converse"),
        ReadTimeoutError(endpoint_url="https://bedrock-runtime"),
        RuntimeError("boom"),
    ],
)
def test_brief_falls_back_on_bedrock_error(cid, error, bedrock):
    bedrock(error=error)
    status, b = call("POST", "/brief/{id}", cid)
    assert status == 200 and b["source"] == "template"
    assert b["markdown"].startswith("## Inspection brief:")
    assert "not proof of a violation" in b["markdown"]


def test_brief_rejects_invented_numbers(bedrock):
    bedrock(reply="## Inspection brief: Talcher\nEmissions were 4,321 tonnes above the limit.")
    status, b = call("POST", "/brief/{id}", "talcher")
    assert status == 200 and b["source"] == "template"


def test_brief_rejects_empty_reply(bedrock):
    bedrock(reply="   ")
    assert call("POST", "/brief/{id}", "talcher")[1]["source"] == "template"


@pytest.mark.parametrize("cid", CLUSTER_IDS)
def test_template_uses_only_provided_numbers(cid):
    from handlers import brief

    facts = brief.build_facts(cid)
    md = brief.template_brief(facts)
    assert brief.check_numbers(md, facts) == set()
    assert facts["audit_risk_score"] in md and facts["confidence"] in md
    c = json.loads((EXPORT / f"cluster_{cid}.json").read_text(encoding="utf-8"))
    assert facts["audit_risk_score"] == f"{c['risk_score']:.0f}"


def test_brief_without_bedrock_credentials_falls_back():
    # No fake installed: the real client fails (no Bedrock in moto) and the template is used.
    status, b = call("POST", "/brief/{id}", "korba")
    assert status == 200 and b["source"] == "template"
    assert "BALCO" in b["markdown"]


# ---------- Deployed API == local static site ----------
@pytest.mark.parametrize(
    "route,cid,file",
    [("/clusters", None, "clusters.json"), ("/summary", None, "summary.json")]
    + [("/clusters/{id}", c, f"cluster_{c}.json") for c in CLUSTER_IDS]
    + [("/clusters/{id}/timeseries", c, f"timeseries_{c}.json") for c in CLUSTER_IDS],
)
def test_api_body_is_the_static_file(route, cid, file):
    """The frontend reads public/data/<file> locally and the API in production: same bytes, JSON, UTF-8."""
    r = handler(event("GET", route, cid))
    assert r["statusCode"] == 200
    assert r["headers"]["content-type"] == "application/json; charset=utf-8"
    assert r["body"] == (EXPORT / file).read_bytes().decode("utf-8")  # exact bytes (no newline translation)


def test_every_frontend_file_is_routable():
    """Each JSON file the static site can fetch has an API route (api.ts url() mapping)."""
    names = {p.name for p in EXPORT.glob("*.json")}
    routable = {"clusters.json", "summary.json"} | {f"cluster_{c}.json" for c in CLUSTER_IDS} | {f"timeseries_{c}.json" for c in CLUSTER_IDS}
    assert names == routable


@pytest.mark.skipif(not (PIPELINE_EXPORT / "clusters.json").exists(), reason="pipeline export not present (fresh clone)")
def test_pipeline_export_matches_committed_copy():
    """to_json writes both folders; a stale committed copy would make the deployed API differ from a fresh export."""
    a = {p.name: p.read_bytes() for p in PIPELINE_EXPORT.glob("*.json")}
    b = {p.name: p.read_bytes() for p in EXPORT.glob("*.json")}
    assert a == b


def test_brief_names_panopticoal(bedrock):
    bedrock(error=RuntimeError("no Bedrock in tests"))
    status, b = call("POST", "/brief/{id}", "talcher")
    assert status == 200 and b["source"] == "template"
    assert "PanoptiCoal" in b["markdown"] and "EmissionWatch" not in b["markdown"]
    from handlers.brief import SYSTEM_PROMPT

    assert "PanoptiCoal" in SYSTEM_PROMPT and "EmissionWatch" not in SYSTEM_PROMPT
