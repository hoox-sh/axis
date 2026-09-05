# Copyright (c) 2026 HOOX · AXIS · hoox-sh
# SPDX-License-Identifier: AGPL-3.0-only

from __future__ import annotations
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "dist"
PORT = int(os.environ.get("PORT", "8081"))
HOST = os.environ.get("HOST", "0.0.0.0")
HEALTH_PATHS = {"/health", "/healthz"}

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        if self.path.startswith("/assets/"):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _send_health(self):
        body = b"ok\n"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_HEAD(self):
        req = self.path.split("?", 1)[0]
        if req in HEALTH_PATHS:
            self._send_health()
            return
        return super().do_HEAD()

    def do_GET(self):
        req = self.path.split("?", 1)[0]
        if req in HEALTH_PATHS:
            self._send_health()
            return
        if req == "/favicon.ico":
            icon = ROOT / "assets" / "icon-192.png"
            if icon.is_file():
                self.path = "/assets/icon-192.png"
        # SPA fallback — never rewrite real static assets (plugins, assets, pyodide wheels)
        path = self.translate_path(self.path)
        is_static = (
            req.startswith("/assets/")
            or req.startswith("/plugins/")
            or req.startswith("/vendor/")
            or req.startswith("/pyodide/")
            or req.endswith(
                (
                    ".js",
                    ".css",
                    ".png",
                    ".webmanifest",
                    ".json",
                    ".map",
                    ".svg",
                    ".ico",
                    ".whl",
                    ".py",
                    ".wasm",
                    ".data",
                    ".zip",
                )
            )
        )
        if not is_static and (
            not os.path.exists(path)
            or (os.path.isdir(path) and not os.path.exists(os.path.join(path, "index.html")))
        ):
            self.path = "/index.html"
        return super().do_GET()

if __name__ == "__main__":
    os.chdir(ROOT)
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[axis-pwa] http://{HOST}:{PORT} -> {ROOT}", flush=True)
    httpd.serve_forever()
