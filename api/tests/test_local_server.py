"""api/local_server.py: every route over real HTTP, bodies equal to the files, CORS, 404s (no S3, no network)."""

import http.client
import json
import threading

import pytest

import local_server
from conftest import CLUSTER_IDS, EXPORT
from handlers import data


@pytest.fixture
def server(monkeypatch):
    monkeypatch.setattr(data, "get_text", data.get_text)  # make_server replaces it; restored after the test
    srv = local_server.make_server(EXPORT, host="127.0.0.1", port=0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv.server_address[1]
    srv.shutdown()
    srv.server_close()


def request(port: int, method: str, path: str, headers: dict | None = None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    c.request(method, path, headers=headers or {})
    r = c.getresponse()
    body = r.read()
    c.close()
    return r.status, {k.lower(): v for k, v in r.getheaders()}, body


@pytest.mark.parametrize("path,file", [
    ("/clusters", "clusters.json"), ("/summary", "summary.json"), ("/plants", "plants_india.json"), ("/states", "states.json"),
    ("/clusters/talcher", "cluster_talcher.json"), ("/clusters/korba/timeseries", "timeseries_korba.json"),
    ("/clusters?x=1", "clusters.json"),
])
def test_get_serves_the_file(server, path, file):
    status, headers, body = request(server, "GET", path)
    assert status == 200 and headers["content-type"] == "application/json; charset=utf-8"
    assert body == (EXPORT / file).read_bytes() and int(headers["content-length"]) == len(body)


def test_all_nine_routes_answer(server, aws):
    # the moto bucket is not used: empty it to prove the server reads files
    for o in aws.list_objects_v2(Bucket="emissionwatch-test-data").get("Contents", []):
        aws.delete_object(Bucket="emissionwatch-test-data", Key=o["Key"])
    cid = CLUSTER_IDS[0]
    gets = ["/clusters", f"/clusters/{cid}", f"/clusters/{cid}/timeseries", f"/clusters/{cid}/wind", "/summary", "/plants", "/states"]
    assert len(gets) + 2 == len(local_server.ROUTES) == 9
    for path in gets:
        assert request(server, "GET", path)[0] == 200, path
    wind = json.loads(request(server, "GET", f"/clusters/{cid}/wind")[2])
    assert wind["source"] == "era5"  # the network is disabled in tests, so the ERA5 fallback answers
    status, _, body = request(server, "POST", f"/brief/{cid}")
    assert status == 200 and json.loads(body)["source"] == "auto"
    status, _, body = request(server, "POST", f"/rti/{cid}")
    assert status == 200 and set(json.loads(body)) == {"markdown", "plain_text"}


@pytest.mark.parametrize("method,path", [("GET", "/"), ("GET", "/nowhere"), ("GET", "/clusters/atlantis"), ("GET", "/clusters/"),
                                         ("GET", "/clusters/talcher/wind/x"), ("POST", "/clusters"), ("GET", "/brief/talcher"),
                                         ("POST", "/rti/..%2Fsummary"), ("GET", "/clusters/..%2Fsummary")])
def test_404(server, method, path):
    status, _, body = request(server, method, path)
    assert status == 404 and json.loads(body) == {"error": "not found"}


def test_cors(server):
    _, h, _ = request(server, "GET", "/clusters", {"Origin": "http://localhost:5173"})
    assert h["access-control-allow-origin"] == "http://localhost:5173"
    _, h, _ = request(server, "GET", "/clusters", {"Origin": "https://example.com"})
    assert "access-control-allow-origin" not in h
    status, h, body = request(server, "OPTIONS", "/brief/talcher", {"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"})
    assert status == 204 and body == b"" and h["access-control-allow-origin"] == "http://localhost:5173"
    assert "POST" in h["access-control-allow-methods"]


def test_missing_export_folder(tmp_path, monkeypatch):
    monkeypatch.setattr(data, "get_text", data.get_text)
    with pytest.raises(FileNotFoundError):
        local_server.make_server(tmp_path, port=0)
