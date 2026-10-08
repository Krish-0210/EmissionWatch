"""Lambda entry point behind the API Gateway HTTP API (payload format 2.0).

Routes (contract: frontend/src/api.ts):
    GET  /clusters                  -> ClustersFile
    GET  /clusters/{id}             -> ClusterDetail
    GET  /clusters/{id}/timeseries  -> TimeseriesFile
    GET  /summary                   -> SummaryFile
    POST /brief/{id}                -> {markdown, source: "bedrock" | "template"}
CORS and throttling are configured on the HTTP API (infra/), not here.
"""

import json
import logging

from handlers import brief, data, plants

log = logging.getLogger()
log.setLevel(logging.INFO)


def _resp(status: int, body, cache: bool = False) -> dict:
    headers = {"content-type": "application/json; charset=utf-8"}
    if cache:
        headers["cache-control"] = "public, max-age=300"
    return {
        "statusCode": status,
        "headers": headers,
        "body": body if isinstance(body, str) else json.dumps(body, ensure_ascii=False),
    }


def handler(event, context=None):
    route = event.get("routeKey", "")
    cid = (event.get("pathParameters") or {}).get("id", "")
    try:
        if route == "GET /clusters":
            return _resp(200, plants.clusters(), cache=True)
        if route == "GET /clusters/{id}":
            return _resp(200, plants.cluster(cid), cache=True)
        if route == "GET /clusters/{id}/timeseries":
            return _resp(200, plants.timeseries(cid), cache=True)
        if route == "GET /summary":
            return _resp(200, plants.summary(), cache=True)
        if route == "POST /brief/{id}":
            return _resp(200, brief.make_brief(cid))
        return _resp(404, {"error": "not found"})
    except data.NotFound:
        return _resp(404, {"error": "not found"})
    except Exception:
        log.exception("unhandled error on %s", route)
        return _resp(500, {"error": "internal error"})
