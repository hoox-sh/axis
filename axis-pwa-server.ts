/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Minimal static server for AXIS dist/
import { join, resolve } from "node:path";
const ROOT = resolve(import.meta.dir, "dist");
const PORT = Number(process.env.PORT || 8081);
const HOST = process.env.HOST || "0.0.0.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const HEALTH_BODY = "ok\n";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".whl": "application/zip",
  ".py": "text/x-python; charset=utf-8",
  ".wasm": "application/wasm",
};

function contentType(path: string) {
  const i = path.lastIndexOf(".");
  return MIME[i >= 0 ? path.slice(i) : ""] || "application/octet-stream";
}

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  async fetch(req) {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    const url = new URL(req.url);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/health" || pathname === "/healthz") {
      return new Response(HEALTH_BODY, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
          ...CORS_HEADERS,
        },
      });
    }
    if (pathname === "/") pathname = "/index.html";
    if (pathname === "/favicon.ico") pathname = "/assets/icon-192.png";
    // SPA fallback for client routes — not for static assets/plugins
    let filePath = join(ROOT, pathname);
    let file = Bun.file(filePath);
    const isStatic =
      pathname.startsWith("/assets/") ||
      pathname.startsWith("/plugins/") ||
      pathname.startsWith("/vendor/") ||
      pathname.startsWith("/pyodide/") ||
      /\.(js|css|png|webmanifest|json|map|svg|ico|woff2|whl|py|wasm|data)$/i.test(pathname);
    if (!(await file.exists())) {
      if (isStatic) {
        return new Response("Not found", { status: 404 });
      }
      filePath = join(ROOT, "index.html");
      file = Bun.file(filePath);
    }
    if (!(await file.exists())) {
      return new Response("Not found", { status: 404 });
    }
    return new Response(file, {
      headers: {
        "Content-Type": contentType(filePath),
        "Cache-Control": pathname.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
        ...CORS_HEADERS,
      },
    });
  },
});

console.log(`[axis-pwa] http://${server.hostname}:${server.port} → ${ROOT}`);
