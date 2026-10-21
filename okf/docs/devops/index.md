# docs/devops

# Concepts

* [Build and serve](build-and-serve.md) - Vite production build, dist layout, axispwaserver.py SPA rules, and asset caching.
* [CI and testing](ci-and-testing.md) - GitHub Actions for AXIS: unit coverage gate, Playwright smoke, worker typecheck, nightly full e2e.
* [AXIS CLI](cli.md) - packages/cli — install, doctor, Worker setup (D1/OAuth), secrets, deploy, health — CLI-first operator path.
* [Cloudflare® deployment](cloudflare.md) - Pages + Worker for AXIS: Pages axis.hoox.sh (project axis), Worker worker.axis.hoox.sh, CLI deploy, bindings, security checklist.
* [CORS and origins](cors-and-origins.md) - Worker pickOrigin: local-dev, product hosts, project-scoped Pages previews, ALLOWEDORIGIN list, Flask constraints.
* [Desktop (Tauri)](desktop.md) - Run and package AXIS as a native desktop app with Tauri 2.
* [Engine-owned data plane (PYNE Pro every tick)](engine-owned-data-plane.md) - Migration plan and wire contract for PYNE Pro owning OHLCV data in every-tick live mode, with AXIS as cache-miss broker.
* [AXIS Hardening + Performance Audit](harden-perf-audit-2026-08-11.md) - Scope: Specialist findings across security, hardening, reliability, and performance (Worker, client, desktop).
* [DevOps](index.md) - Build, serve, Cloudflare®, VPS demo, CORS, and CI for the AXIS PWA and Worker.
* [Local development](local-dev.md) - Day-to-day AXIS loop: Vite, Flask, Worker wrangler, endpoints, and plugin examples.
* [OKF bundle](okf.md) - Compiled Open Knowledge Format cache of the AXIS repo, refreshed on every commit.
* [OpenCode](opencode.md) - Project configuration for OpenCode: formatter, LSP servers, permissions, slash commands, and the OKF instructions.
* [PYNE endpoint parity](pyne-endpoints.md) - Which PYNE Pro API routes AXIS consumes, which it deliberately does not, and how each surface is gated.
* [VPS demo topology](vps-demo.md) - Single-box demo: static AXIS dist + Flask Pro API (+ optional reverse proxy) without Cloudflare®.
