"""Inspection brief for one cluster: a deterministic template, or Bedrock (Converse) with the template as fallback.

BRIEF_MODE (Lambda env, set by the CDK stack): "template" (default) never calls Bedrock and returns the
template with source "auto"; "bedrock" calls Bedrock and falls back to the template (source "template")
on any error. Any other value is treated as "template".

Both paths use the same FACTS, built only from the exported numbers (cluster_{id}.json and the
cluster's row/coefficient in summary.json). Numbers are pre-formatted here; the model is told to
copy them and add none. As a guard, a Bedrock answer containing any number that is not in FACTS
(or in the fixed method description) is discarded and the template is returned instead.

Returns {"markdown": str, "source": "auto" | "bedrock" | "template"}.
"""

import json
import logging
import os
import re

import boto3
from botocore.config import Config

from handlers import data

log = logging.getLogger(__name__)

DEFAULT_MODEL_ID = "in.anthropic.claude-haiku-4-5-20251001-v1:0"
LEVEL = {"high": "High", "medium": "Medium", "low": "Low"}

# Fixed method description; its numbers are allowed in the output too.
METHOD = (
    "Sentinel-5P TROPOMI tropospheric NO2, averaged inside a 20 km ring around the cluster minus a "
    "50-80 km background ring, compared each day with CEA reported generation, ERA5 wind and "
    "boundary-layer height and the season. The Audit Risk Score (0-100) combines persistent "
    "excess over the latest 90 days (weight 0.5), the trend in NO2 per unit of generation "
    "(weight 0.25) and intensity relative to peer clusters (weight 0.25)."
)

SYSTEM_PROMPT = """You write short inspection briefs for PanoptiCoal, a satellite screening tool that helps
environmental regulators in India decide which coal plant clusters to inspect first.
Rules:
- Use ONLY the facts provided in FACTS and METHOD. Do not add, derive, round differently, estimate or
  recompute any number, date, percentage, unit count or capacity. If a number is not written in FACTS
  or METHOD, do not write it. Copy numbers exactly as written.
- Do not use numbered lists or numbered headings (use bullets), so that no new numbers appear.
- Frame every finding as an anomaly that warrants an audit, not proof of a violation. Satellite NO2
  is not a stack measurement and other sources (traffic, industry, mining, burning) also emit NO2.
- Mention the confidence level and every confidence note.
- No speculation about intent, legal liability or specific companies beyond the plant names given.
- Output GitHub-flavoured Markdown, at most about 300 words, with these sections:
  "## Inspection brief: <cluster name>", "### Summary", "### What the data shows",
  "### Confidence and caveats", "### Suggested focus for inspectors" (qualitative only),
  and this exact final line: "_PanoptiCoal flags an anomaly that warrants an audit, not proof of a violation._".
"""


def _f(x, nd=2) -> str:
    """Fixed formatting so the template, the prompt and the number check agree."""
    if x is None:
        return "n/a"
    if isinstance(x, (int,)) or (isinstance(x, float) and nd == 0):
        return f"{x:,.0f}"
    return f"{x:,.{nd}f}"


def _signed(x, nd=0) -> str:
    return "n/a" if x is None else f"{x:+,.{nd}f}"


def _p(p) -> str:
    if p is None:
        return "n/a"
    return "< 0.001" if p < 0.001 else f"{p:.3f}"


def build_facts(cid: str) -> dict:
    c = data.get_json(f"cluster_{cid}.json")
    s = data.get_json("summary.json")
    sig, enh, ratio, cov = c["signals"], c["model"]["enhancement"], c["model"]["ratio"], c["coverage"]
    bt = next((r for r in s.get("backtest", []) if r.get("cluster") == cid), None)
    plants = [p["name"] for p in c.get("plants", []) if p.get("status") == "operating"]
    facts = {
        "cluster": c["name"],
        "states": ", ".join(c.get("states", [])),
        "as_of": c.get("as_of"),
        "operating_plants": plants,
        "operating_capacity_mw": _f(c.get("capacity_mw"), 0),
        "audit_risk_score": _f(c["risk_score"], 0),
        "risk_level": LEVEL.get(c["risk_level"], c["risk_level"]),
        "confidence": LEVEL.get(c["confidence"], c["confidence"]),
        "confidence_notes": ", ".join(c.get("confidence_notes", [])) or "none",
        "headline": c.get("headline", ""),
        "signals": {
            "persistent_excess_z_90d": _f(sig["persistent_excess"]["z"]),
            "persistent_excess_subscore": _f(sig["persistent_excess"]["score"], 0),
            "intensity_trend_pct_per_year": _signed(sig["intensity_trend"]["pct_per_year"], 1),
            "intensity_trend_t": _f(sig["intensity_trend"]["t"]),
            "intensity_trend_subscore": _f(sig["intensity_trend"]["score"], 0),
            "peer_intensity_ratio": _f(sig["peer_intensity"]["ratio"]),
            "peer_intensity_subscore": _f(sig["peer_intensity"]["score"], 0),
        },
        "model": {
            "generation_coef_umol_m2_per_mu_day": _f(enh["coef"], 3),
            "generation_t": _f(enh["t"], 1),
            "generation_p": _p(enh["p"]),
            "partial_r2": _f(enh["partial_r2"], 3),
            "days": _f(enh["n"], 0),
            "ratio_model_p": _p(ratio["p"]),
        },
        "coverage": {
            "valid_no2_days_last_365": _f(cov["recent_valid_days"], 0),
            "ring_coal_capacity_mw": _f(cov["ring_capacity_mw"], 0),
            "capacity_not_in_cea_reports_mw": _f(cov["unreported_capacity_mw"], 0),
            "plants_not_in_cea_reports": cov.get("unreported_plants", []),
        },
    }
    if bt:
        facts["lockdown_backtest_apr_may_2020_vs_2019"] = {
            "generation_change_pct": _signed(bt["gen_change_pct"]),
            "observed_no2_change_pct": _signed(bt["observed_change_pct"]),
            "predicted_no2_change_pct": _signed(bt["predicted_change_pct"]),
        }
    return facts


def template_brief(f: dict) -> str:
    s, m, cov = f["signals"], f["model"], f["coverage"]
    lines = [
        f"## Inspection brief: {f['cluster']}",
        "",
        "### Summary",
        f"{f['cluster']} ({f['states']}) has an Audit Risk Score of {f['audit_risk_score']}/100 "
        f"({f['risk_level']} risk, {f['confidence']} confidence) as of {f['as_of']}.",
        "",
        f"> {f['headline']}",
        "",
        "### What the data shows",
        f"- Persistent excess: over the latest 90 days, NO2 ran {s['persistent_excess_z_90d']} standard "
        f"deviations from what reported generation and weather predict (sub-score {s['persistent_excess_subscore']}).",
        f"- Intensity trend: NO2 per unit of generation changes by {s['intensity_trend_pct_per_year']}% a year "
        f"(t = {s['intensity_trend_t']}, sub-score {s['intensity_trend_subscore']}).",
        f"- Peer comparison: {s['peer_intensity_ratio']}x the median cluster's NO2 per unit generated "
        f"(sub-score {s['peer_intensity_subscore']}).",
        f"- Daily model: {m['generation_coef_umol_m2_per_mu_day']} µmol/m² of NO2 enhancement per MU/day of "
        f"reported generation (t = {m['generation_t']}, p {m['generation_p']}, partial R² {m['partial_r2']}, "
        f"{m['days']} days).",
    ]
    bt = f.get("lockdown_backtest_apr_may_2020_vs_2019")
    if bt:
        lines.append(
            f"- 2020 lockdown check (Apr-May): generation {bt['generation_change_pct']}%, observed NO2 "
            f"{bt['observed_no2_change_pct']}%, model-predicted NO2 {bt['predicted_no2_change_pct']}% vs 2019."
        )
    lines += [
        "",
        "### Confidence and caveats",
        f"- Confidence: {f['confidence']}. Notes: {f['confidence_notes']}.",
        f"- Valid satellite days in the last 365: {cov['valid_no2_days_last_365']}. Coal capacity in the 20 km "
        f"ring: {cov['ring_coal_capacity_mw']} MW, of which {cov['capacity_not_in_cea_reports_mw']} MW is not in CEA reports.",
        "- Satellite NO2 is a column average over pixels of several km, not a stack measurement; other "
        "sources also emit NO2.",
        "",
        "### Suggested focus for inspectors",
        "- Compare unit-level generation logs and fuel receipts with reported daily generation for the recent period.",
        "- Check the operating status of NOx controls and continuous emission monitoring records.",
        "- Note other large NO2 sources near the cluster that could explain part of the signal.",
        "",
        "_PanoptiCoal flags an anomaly that warrants an audit, not proof of a violation._",
    ]
    return "\n".join(lines)


NUM = re.compile(r"\d+(?:[.,]\d+)*")


def _numbers(text: str) -> set[str]:
    return {n.replace(",", "") for n in NUM.findall(text)}


def check_numbers(markdown: str, facts: dict) -> set[str]:
    """Numbers in the output that are not in FACTS or METHOD (empty set = OK)."""
    allowed = _numbers(json.dumps(facts, ensure_ascii=False) + " " + METHOD + " " + SYSTEM_PROMPT)
    return _numbers(markdown) - allowed


_bedrock = None


def _bedrock_client():
    global _bedrock
    if _bedrock is None:
        # Fail fast: the Lambda timeout is 10 s and the template must still fit after an error.
        cfg = Config(connect_timeout=2, read_timeout=7, retries={"max_attempts": 1, "mode": "standard"})
        _bedrock = boto3.client("bedrock-runtime", region_name=os.environ.get("BEDROCK_REGION", "ap-south-1"), config=cfg)
    return _bedrock


def bedrock_brief(facts: dict) -> str:
    user = (
        "FACTS (JSON, numbers already formatted; copy them exactly):\n"
        + json.dumps(facts, ensure_ascii=False, indent=1)
        + "\n\nMETHOD:\n"
        + METHOD
        + "\n\nWrite the inspection brief."
    )
    r = _bedrock_client().converse(
        modelId=os.environ.get("BEDROCK_MODEL_ID") or DEFAULT_MODEL_ID,
        system=[{"text": SYSTEM_PROMPT}],
        messages=[{"role": "user", "content": [{"text": user}]}],
        inferenceConfig={"maxTokens": 700, "temperature": 0.2},
    )
    text = "".join(b.get("text", "") for b in r["output"]["message"]["content"]).strip()
    if not text:
        raise ValueError("empty Bedrock response")
    extra = check_numbers(text, facts)
    if extra:
        raise ValueError(f"Bedrock output has numbers not in FACTS: {sorted(extra)[:10]}")
    return text


def brief_mode() -> str:
    mode = os.environ.get("BRIEF_MODE", "template").strip().lower()
    if mode not in ("template", "bedrock"):
        log.warning("unknown BRIEF_MODE %r; using template", mode)
        return "template"
    return mode


def make_brief(cid: str) -> dict:
    data.require_cluster(cid)
    facts = build_facts(cid)
    if brief_mode() == "template":
        return {"markdown": template_brief(facts), "source": "auto"}
    try:
        return {"markdown": bedrock_brief(facts), "source": "bedrock"}
    except Exception as e:  # any Bedrock/network/validation failure -> deterministic template
        log.warning("brief for %s: Bedrock failed (%s: %s); using template", cid, type(e).__name__, e)
        return {"markdown": template_brief(facts), "source": "template"}
