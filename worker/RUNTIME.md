# RUNTIME.md — In-Worker Python via Pyodide

**Status: scaffold, not production.** Boot path is wired
(`worker/src/pyodide_runtime.ts`); wheel install + `run_script` bridge are
still stubs. The old `RUNTIME_MODE` flag never shipped — the live flag is
`PYODIDE_IN_WORKER` (`enabled` / `disabled`, default `disabled` in
`worker/wrangler.toml`).

## Goal

Run the Python pynescript runtime **inside the Cloudflare Worker**, removing
the dependency on an external Flask service. This unlocks a fully-CF
deployment (Pages + Worker + KV + D1 + R2) with no other infrastructure.

## What works today

- `PYODIDE_IN_WORKER=enabled` loads Pyodide 0.26.2 (jsDelivr CDN) once per
  isolate (`pyReady` memo) and calls into it per `/api/run` request.
- Python tracebacks are trimmed head+tail (`TRACEBACK_KEEP_*`, kept in sync
  with `src/engines/catalog.ts`).

## What is still stubbed (do NOT enable in production yet)

- The pynescript wheel is **never installed** (micropip block is commented
  out), so the `run_script(...)` global does not exist: every run returns
  `{ status: 'error', ... }` as HTTP 200 — and because that result is
  truthy, the request does **not** fall through to `EXTERNAL_BACKEND`.
  Enabling the flag today breaks evaluation instead of fixing it.

## Completion checklist

1. **Ship the wheel to R2.** Build the pynescript wheel (+ antlr4 runtime,
   minus LSP-only parts), upload under
   `bundles/pynescript-0.x.y-py3-none-any.whl`, and uncomment the
   `[[r2_buckets]]` `BUNDLES` binding in `worker/wrangler.toml`.
2. **Install + bridge.** Uncomment the micropip install in
   `ensurePyodide` (load the wheel bytes from `env.BUNDLES`, not a URL),
   then define the `run_script(script, bars)` Python global that calls
   `Runtime().run()` and returns `json.dumps(...)`.
3. **Prefer workerd-native / vendored Pyodide** over the CDN boot for cold
   starts (or pin + cache the index in R2).
4. **Fail open correctly.** Decide: on Pyodide error, fall through to
   `EXTERNAL_BACKEND` (today the truthy error envelope short-circuits it).
5. **Tests.** Worker tests for boot-once, wheel-missing, error envelope,
   and the `EXTERNAL_BACKEND` interaction.

## Roll-out

Behind `PYODIDE_IN_WORKER` (not the old `RUNTIME_MODE` name): when enabled
*and completed*, the Worker runs the script itself; otherwise it proxies to
`EXTERNAL_BACKEND`, else 503 `NO_BACKEND`. Until then, production stays on
`EXTERNAL_BACKEND` (Flask `:5002` or pyne-worker).

## Historical plan (kept for reference)

The original sketch below predates the scaffold; constraints still apply.

1. **Bundle the pynescript wheel.** Build a single-file wheel for
   `pynescript` (and its antlr4 runtime, asdl, etc.) stripped of the
   LSP-only parts. Upload to R2 under `bundles/pynescript-0.x.y-py3-none-any.whl`.
2. **Load Pyodide in the Worker.** The
   [pyodide-port](https://github.com/hoodmane/pyodide-port) project ships a
   `worker.js` that runs Pyodide in a WebAssembly Worker. We can use
   `@cloudflare/workers-py` or vendor the loader. Pin the Pyodide version
   in `wrangler.toml` and upload the index to R2 for offline boot.
3. **Bridge `Runtime().run()`.** Expose a small TS wrapper that calls
   `pyodide.runPythonAsync("from pynescript.backend.runtime import Runtime; r = Runtime()")`
   and forwards `run(script, bars, ...)` requests to it. The result is
   serialised via `json.dumps(...)` and returned as the Worker's response.
4. **Cache the wheel in module memory.** Use `env.BUNDLES.get(key)` plus
   `caches.default` so subsequent runs in the same isolate avoid re-fetching.
5. **Cold start budget.** Pyodide boot is ~3 s on first run; cache the
   `globals` dict across invocations using module-level state.

## Constraints

- Worker CPU time limit: 30 s (paid plan). Pine evaluation of 500 bars
  should fit in well under 1 s of CPU.
- Worker memory: 128 MB. Pyodide itself is ~30 MB; the pynescript wheel
  is ~5 MB. Comfortable.
- Network: Worker → R2 calls are free; calls to external APIs are metered.
