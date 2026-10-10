"""Local dev server for the API: the Lambda handler (handlers.app) behind a plain HTTP server, no AWS.

Reads the exported JSON from pipeline/data/export/ instead of S3 (files are re-read on every request, so a new
`python -m src.export.to_json` shows up without a restart). All 9 routes of the HTTP API:
    GET  /clusters, /clusters/{id}, /clusters/{id}/timeseries, /clusters/{id}/wind, /summary, /plants, /states
    POST /brief/{id}, /rti/{id}
GET /clusters/{id}/wind calls Open-Meteo as in Lambda (ERA5 fallback when offline). Briefs follow BRIEF_MODE
(default template: no Bedrock, source "auto"; BRIEF_MODE=bedrock needs AWS credentials with Bedrock access).
CORS allows http://localhost:5173 and :4173, like the deployed HTTP API. Not deployed (excluded from the Lambda asset).

Usage (from api/, with its venv):
    .venv/Scripts/python.exe local_server.py [--port 8787] [--data DIR]
Then start the frontend with VITE_API_URL=http://localhost:8787 (DEPLOY.md, "Local API").
"""

import argparse
import logging
import re
import socket
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from handlers import app, data

log = logging.getLogger("local_server")

ROOT = Path(__file__).resolve().parents[1]
EXPORT_DIR = ROOT / "pipeline" / "data" / "export"
HOSTS, PORT = ("127.0.0.1", "::1"), 8787  # loopback only; both, so "localhost" connects without an IPv6 retry delay
ALLOWED_ORIGINS = ("http://localhost:5173", "http://localhost:4173")  # LOCAL_ORIGINS of the CDK stack

# (method, path pattern, route key as API Gateway sends it); {id} is one path segment.
ROUTES = [
    ("GET", r"/clusters", "GET /clusters"),
    ("GET", r"/clusters/([^/]+)", "GET /clusters/{id}"),
    ("GET", r"/clusters/([^/]+)/timeseries", "GET /clusters/{id}/timeseries"),
    ("GET", r"/clusters/([^/]+)/wind", "GET /clusters/{id}/wind"),
    ("GET", r"/summary", "GET /summary"),
    ("GET", r"/plants", "GET /plants"),
    ("GET", r"/states", "GET /states"),
    ("POST", r"/brief/([^/]+)", "POST /brief/{id}"),
    ("POST", r"/rti/([^/]+)", "POST /rti/{id}"),
]


def file_reader(export_dir: Path):
    """Replacement for data.get_text: the file from export_dir, uncached; data.NotFound when it does not exist."""

    def get_text(name: str) -> str:
        path = export_dir / name
        if not path.is_file():
            raise data.NotFound(name)
        return path.read_bytes().decode("utf-8")  # bytes: no newline translation, same body as S3

    return get_text


def event_for(method: str, raw_path: str) -> dict:
    """HTTP API v2 event for a request; routeKey "$default" (the handler answers 404) when no route matches."""
    path = urlsplit(raw_path).path
    for m, pattern, key in ROUTES:
        hit = re.fullmatch(pattern, path) if m == method else None
        if hit:
            params = {"id": unquote(hit.group(1))} if hit.groups() else None
            return {"version": "2.0", "routeKey": key, "rawPath": path, "pathParameters": params,
                    "requestContext": {"http": {"method": method, "path": path}}}
    return {"version": "2.0", "routeKey": "$default", "rawPath": path, "pathParameters": None,
            "requestContext": {"http": {"method": method, "path": path}}}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _cors(self) -> None:
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def _send(self, status: int, headers: dict, body: bytes) -> None:
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle(self, method: str) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            self.rfile.read(length)  # no route reads a body
        r = app.handler(event_for(method, self.path))
        self._send(r["statusCode"], r["headers"], r["body"].encode("utf-8"))

    def do_GET(self) -> None:
        self._handle("GET")

    def do_POST(self) -> None:
        self._handle("POST")

    def do_OPTIONS(self) -> None:  # CORS preflight, as configured on the HTTP API
        self._send(204, {"Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "content-type",
                         "Access-Control-Max-Age": "3600"}, b"")

    def log_message(self, fmt: str, *args) -> None:
        log.info("%s %s", self.address_string(), fmt % args)


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, handler):
        self.address_family = socket.AF_INET6 if ":" in address[0] else socket.AF_INET
        super().__init__(address, handler)


def make_server(export_dir: Path = EXPORT_DIR, host: str = HOSTS[0], port: int = PORT) -> ThreadingHTTPServer:
    if not (export_dir / "clusters.json").is_file():
        raise FileNotFoundError(f"{export_dir} has no clusters.json; run `python -m src.export.to_json` in pipeline/ "
                                f"or pass --data ../frontend/public/data")
    data.get_text = file_reader(export_dir)  # get_json / cluster_ids / require_cluster go through it
    return Server((host, port), Handler)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--data", type=Path, default=EXPORT_DIR, help="folder with the exported JSON (default pipeline/data/export)")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stderr, force=True)
    server = make_server(args.data.resolve(), port=args.port)
    try:  # second listener on the IPv6 loopback; skipped where IPv6 is off
        v6 = make_server(args.data.resolve(), host=HOSTS[1], port=args.port)
        threading.Thread(target=v6.serve_forever, daemon=True).start()
    except OSError as e:
        log.info("no IPv6 loopback listener (%s); use http://127.0.0.1:%d if localhost is slow", e, args.port)
    log.info("PanoptiCoal API on http://localhost:%d reading %s (Ctrl+C to stop)", args.port, args.data.resolve())
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
