# AXIS — Engineering Audit

**Revision audited:** `966e5579` (`main`, v2.28.0)
**Date:** 2026-11-06
**Mode:** read-only. No source file was modified while producing this document.
**Auditor:** automated pass (TypeScript AST metrics + tool runs + manual reading)

> **Post-hardening status (2026-11-06):** the P0–P3 items marked in-scope were
> implemented on top of this audit. See [`AUDIT-CHANGELOG.md`](./AUDIT-CHANGELOG.md)
> for the before/after metrics, the behaviour-preservation ledger, and the exact
> command transcript. This file remains the point-in-time read-only snapshot and
> is **not** rewritten to match the fixed tree.

---

## 1. Method

| Step | Command | Result |
|---|---|---|
| Typecheck (app) | `bun run typecheck` | `✓ No type errors in 597 files` |
| Lint | `bun run lint` (`biome check .`) | 1195 files, **0 errors**, 3440 warnings, 270 infos |
| Tests | `bun run test` | **5013 pass, 10 skip, 0 fail**, 5023 tests / 427 files, 20 841 asserts, 47.2 s |
| Build | `bun run build` | `✓ built in 19.64s`, largest chunk 803.44 kB (243.21 kB gzip) |
| Dependency audit | `bun audit` | **15 vulnerabilities (2 critical, 8 high, 4 moderate, 1 low)** |
| Coverage (last run, `coverage/lcov.info`) | parsed lcov | 67 675 / 83 145 lines = **81.4 %** |
| AST metrics | `ts.createSourceFile` walk over `src`, `worker/src`, `packages/*/src` | see §4 |
| Import graph | regex value-import graph + Tarjan SCC | see §5.4 |
| Duplication | brace-matched normalized block hashing | see §5.5 |
| Strictness probe | `tsc --noEmit -p tsconfig.check.json --<flag>` | see §5.2 |

Scope measured: **654 TS/TSX files, 194 957 LOC in `src/`, 8 913 in `worker/src/`, 5 020 in `packages/`**, 87 658 LOC of tests.

---

## 2. Scores

| Dimension | Score | One-line verdict |
|---|---:|---|
| **Architecture** | **6 / 10** | Genuinely modular and well-documented at module level, but three god-modules and a 26-file runtime import cycle hold it back. |
| **Types** | **6 / 10** | `strict: true`, zero `@ts-ignore`, worker is stricter than the app — but 46 `any`, 44 `as unknown as`, 364 untyped exports, 887 `!`, and no schema validation at the network boundary. |
| **Docs** | **7 / 10** | 71 MDX pages, excellent `@module` headers in `worker/`; 27 % of exported symbols have no docstring and README version is stale. |
| **Tests** | **8 / 10** | 5 023 tests green, security + e2e + coverage gate in CI; weak spots are the drawing-tool and durable-object layers. |
| **Dependencies** | **5 / 10** | 15 known vulns including 2 critical; no `bun audit` gate in CI; minors lag. |
| **Performance** | **6 / 10** | Thoughtful chunking/preload config, but an 803 kB main chunk and a 6 170-line module in the boot graph. |
| **Security** | **7 / 10** | Fail-closed key auth, origin allowlist, capped JSON, security test suites; static CSP nonce and in-memory-only rate limiting weaken it. |
| **Overall** | **6.4 / 10** | Solid, above-average codebase with a long tail of type/doc debt and an unpatched dependency surface. |

---

## 3. What is already good (so the findings below are read in context)

- **Real CI**: typecheck → version sync → OKF bundle check → coverage gate → security suites → Playwright smoke (`.github/workflows/ci.yml:47-70`).
- **Zero `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`** anywhere in app, worker, or CLI.
- **Worker is the strict one**: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `isolatedModules` are all on (`worker/tsconfig.json:11-19`).
- **Solid idioms are respected**: 216 `<For>` vs 2 incidental `.map()` in JSX; `batch()` used 30×, `untrack()` 27×.
- **Fail-closed auth**: with D1 bound and no KV, the worker returns `API_KEYS_REQUIRED` rather than accepting open keys (`worker/src/auth.ts:28-33`).
- **Module-level docs in the worker are excellent** — `market.ts`, `rate-limit.ts`, `auth.ts` each explain *why*, not just *what* (`worker/src/market.ts:22-43`, `worker/src/rate-limit.ts:20-32`).
- **The on-chain and market proxies are allowlisted routers**, not open reverse proxies (`worker/src/market.ts:36-41`, `worker/src/proxy-router.ts`).
- **Coverage gate has an honest ratchet with documented history** (`scripts/check-coverage.mjs:12-27`).

---

## 4. Baseline metrics (the "before" half of the before/after)

### 4.1 Type surface

| Metric | Count | Note |
|---|---:|---|
| Exported symbols | **4 621** | across 654 files |
| Exports **without explicit return type** | **364** | 92.1 % typed |
| Exports **without JSDoc** | **1 258** | 72.8 % documented |
| `any` keywords (AST) | **46** | 29 of them are `ISeriesApi<any>` |
| `as` casts | **1 657** | |
| `as unknown as` double casts | **44** | |
| Non-null assertions `!` | **887** | |
| `@ts-ignore` family | **0** | |

### 4.2 Missing docstrings by area

| Area | Exports | No return type | No docstring | `any` | Casts |
|---|---:|---:|---:|---:|---:|
| `src/ui` | 658 | 145 | **233** | 1 | 256 |
| `src/chart` | 686 | 38 | **138** | 29 | 350 |
| `src/data` | 333 | 0 | **102** | 0 | 74 |
| `worker/src` | 240 | 5 | **100** | 0 | 102 |
| `src/engine` | 153 | 0 | 88 | 0 | 60 |
| `packages/cli` | 130 | 0 | 78 | 0 | 46 |
| `src/editor` | 361 | 18 | 76 | 0 | 72 |
| `src/stories` | 66 | 0 | 58 | 0 | 3 |
| `src/store` | 299 | **140** | 18 | 0 | 156 |
| remainder (18 areas) | — | 18 | 367 | 16 | 538 |

### 4.3 Strictness gap (errors if a flag is turned on today)

| Flag | New errors |
|---|---:|
| `exactOptionalPropertyTypes` | **407** |
| `noUncheckedIndexedAccess` | **129** |
| `noUnusedLocals` | **56** |
| `noImplicitOverride` | **16** |
| `noImplicitReturns` | 0 |
| `noFallthroughCasesInSwitch` | 0 |

### 4.4 I/O trust boundary

| Metric | Count |
|---|---:|
| `JSON.parse(` call sites | **81** |
| `fetch(...).json()` call sites | 53 |
| … of which cast with `as <Type>` (unvalidated) | **17** |
| Hand-rolled `is*(v: unknown)` guards | 26 |
| Schema-validation libraries (`zod`/`valibot`/`arktype`) | **0** |

---

## 5. Dimension detail with evidence

### 5.1 Architecture — 6/10

**Strengths.** Clean plane separation (sources / streams / engines / storage / on-chain), documented in `docs/architecture/overview.mdx` and `docs/architecture/state-namespaces.mdx`. The new bar plane (`src/stores/bars.ts:19-30`) is a deliberate, documented step away from the monolith. Vite chunking is hand-tuned (`vite.config.ts:41-70`).

**Findings.**

- **God modules.** `src/store/index.ts` is 6 170 lines with **263 `export` statements** and is imported by the chart, data, and UI planes (`src/store/index.ts:1-6170`). `src/chart/pane-manager.ts` is 4 299 lines; `src/chart/drawing-layer.ts` 3 274.
- **Runtime import cycles.** Value-import SCC analysis finds **3 cyclic components covering 34 files**:
  - 26 files: `src/data/*` ↔ `src/storage/*` ↔ `src/engines/catalog.ts` ↔ `src/store/index.ts` ↔ `src/onchain/catalog.ts` ↔ `src/streams/catalog.ts` ↔ `src/plugins/*`.
  - 6 files: `src/indicators/apply-*.ts` ↔ `runner.ts`.
  - 2 files: `src/results/debug-pins.ts` ↔ `inline-debug.ts`.
  These are *value* cycles (type-only imports were excluded), so they can produce partially-initialised modules at import time. The `src/store/index.ts:1930` comment ("Hydrated once at module load") makes this a live risk.
- **Naming collisions.** `src/store/` (app store) vs `src/stores/` (bar plane); `src/engine/` (live wire, transport) vs `src/engines/` (engine catalog, Pro/worker/pyodide adapters). Both pairs are load-bearing and one character apart.
- **Two store implementations** are documented as coexisting mid-migration (`src/stores/bars.ts:24-27`), which is fine as a transition but has no removal criterion written down.

### 5.2 Types — 6/10

**Strengths.** `strict: true` (`tsconfig.json:11`), no suppression comments, `useUnknownInCatchVariables` on in the worker, discriminated unions used for engine results.

**Findings.**

- **`any` is concentrated and fixable**: 29 of 46 are `ISeriesApi<any>` / `ISeriesMarkersPluginApi<any>` in `src/chart/` (e.g. `src/theme/manager.ts:64,154,164`, `src/chart/pane-manager.ts:351,375,410,483,553,568,570,600,619,661`). lightweight-charts is generic over series type, so this is a *real* type hole on the hottest path.
- **Unsound generic**: `src/data/dataset-store.ts:303` returns `Promise.resolve(undefined as unknown as T)` — a stale write resolves with a value the type says exists.
- **Persisted-state casts**: `src/storage/workspace-snapshot.ts:492` (`raw.drawingPrefs as unknown as DrawingPrefs`), `src/storage/workspace-snapshot.ts:485` (`raw.panes as Pane[]`), `src/store/index.ts:2099` (`s as unknown as Record<string, unknown>`). Snapshots come from disk and from other windows; these are unchecked.
- **Network responses cast, not parsed**: `src/engines/pro.ts:386`, `src/engines/prewarm.ts:228`, `src/engines/catalog.ts:344,1302`, `src/update/update-manager.ts:135`, `src/engine/live-ticket.ts:171`, `src/engine/rest-fallback.ts:77`, `src/editor/pyne-lsp-client.ts:178,222,285`, `src/mcp/dispatch.ts:356,382`. 17 such sites total.
- **`tsconfig.json` is the weakest of the three configs** — the worker and CLI are stricter than the app they ship next to (`tsconfig.json:1-24` vs `worker/tsconfig.json:11-19`).
- **536 latent errors** would appear if `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` were enabled (§4.3).
- **Dead "keep imports alive" casts**: `src/chart/drawings/tools/lines.ts:248-249`, `gann.ts:415-416`, `trading-extra.ts:226-227` — `void 0 as unknown as ToolHitCtx` exists only to defeat unused-import checking.

### 5.3 Docs — 7/10

**Strengths.** 71 MDX pages under `docs/`, ADRs in `docs/architecture/adrs.mdx`, a real perf audit (`docs/devops/harden-perf-audit-2026-08-11.md`), an OKF knowledge bundle, and a 3 500-line recursive changelog.

**Findings.**

- **1 258 of 4 621 exports (27.2 %) have no docstring**; the worst areas are `src/ui` (233), `src/chart` (138), `src/data` (102), `worker/src` (100).
- **README version drift**: `README.md:12` advertises **2.25.3** and CLI **0.3.5**; `VERSION`/`package.json` say **2.28.0** and `packages/cli/package.json` says **0.3.6**. Three releases behind.
- Module headers are excellent but function-level docs are uneven — the worker documents *why* (`worker/src/auth.ts:20-41`), while chart tooling often has none (`src/chart/drawings/tools/fib.ts`, `patterns.ts`).

### 5.4 Tests — 8/10

**Strengths.** 427 test files, 5 023 tests, all green in 47 s. Dedicated `tests/security/` (`client-security.test.ts`, `worker-security.test.ts`), 24 Playwright specs, bench harness with a firehose budget (`reports/perf-audit.json`), and a coverage gate that refuses to regress.

**Findings.**

- **Overall line coverage 81.4 %**, below the aspirational 95 %; the gate enforces a scoped 89 % baseline and the script itself admits it "has been red on main since before 2026-10-13" (`scripts/check-coverage.mjs:16-19`).
- **Cold spots**: `src/ui/HooxLogo.tsx` 6.9 %, `src/chart/onchain-events.ts` 7.0 %, `src/chart/drawings/tools/measure-trading.ts` 10.7 %, `svg-primitives.ts` 10.7 %, `fib.ts` 10.8 %, `lines.ts` 17.3 %, `optimize/client.ts` 17.9 %, `patterns.ts` 19.4 %, `src/chart/screenshot.ts` 20.8 %, `worker/src/durable-objects/session.ts` 22.7 %.
- **No mutation testing** and no assertion on the AXB1 decoder beyond the golden vectors.

### 5.5 Dependencies — 5/10

`bun audit` at `966e5579`:

| Package | Severity | Advisory | Path |
|---|---|---|---|
| `seroval@1.5.6` | **critical** + 5 more | GHSA-p6vx-979v-rg4c (fromJSON thenable → callable invocation) | `solid-js > seroval-plugins > seroval` |
| `storybook@10.6.1` | **critical** | GHSA-f2ph-cmg5-wxc8 (missing origin validation → code injection) | direct dev dep |
| `storybook@10.6.1` | high | GHSA-px85-f4q5-jh77 (dev server code injection from LAN) | direct dev dep |
| `nanoid@3.3.16` | high | GHSA-2v37-7h3g-55p8 | `vite > postcss` |
| `source-map-js@1.2.1` | high | GHSA-68fv-2mgg-jv7q (event-loop DoS) | `vite`, `@tailwindcss/vite` |
| `vite@6.4.3` | high + 4 | GHSA-587h-7wmj-h5pm, GHSA-rq7h-c2jc-7f22, … | direct dev dep |

**15 vulnerabilities (2 critical, 8 high, 4 moderate, 1 low).** `seroval` is reachable at runtime through Solid; `storybook` and `vite` are dev-only but the Storybook ones allow code injection from a malicious website against a running dev server.

There is **no `bun audit` step in CI** (`.github/workflows/ci.yml:20-70`), so this will silently drift.

Also stale: `solid-js` 1.9.14 → 1.9.18, `lucide-solid` 1.27.0 → 1.69.0 (large gap), `@biomejs/biome` 2.5.12 → 2.6.5.

### 5.6 Performance — 6/10

**Strengths.** `manualChunks` splits `lwc`, `cm`, `icons`, `solid`, `pyne-builtins` (`vite.config.ts:44-70`); `modulePreload` deliberately excludes editor/builtins from first paint (`vite.config.ts:31-40`); persist is debounced with unload flush (`src/store/index.ts:28-31, 2147, 2228`); a firehose bench exists (`reports/perf-audit.json`: `appendBar` 26 149 ops/s).

**Findings.**

- **Main chunk is 803.44 kB / 243.21 kB gzip** and Vite warns it exceeds the 450 kB limit (build output). `index-DLJcjMvX.js` is a second 433 kB / 132 kB gzip chunk.
- **6 170-line store in the boot graph**: every screen imports `src/store/index.ts`, so its whole module body (defaults, hydrators, ~263 exports) is parsed before first paint.
- **`pyne-builtins` is 322 kB / 58 kB gzip** shipped as its own chunk but still preloaded on the editor path.
- **`appendBar` at ~26 k ops/s** is the documented hot path; the store's `reconcile` usage should be re-measured after any store split.
- No bundle-size budget in CI (only the firehose budget).

### 5.7 Security — 7/10

**Strengths.** Bearer auth with KV lookup, SHA-256 user partitioning so raw keys never reach SQL (`worker/src/auth.ts:44-52`), fail-closed behaviour when D1 is bound without KV (`worker/src/auth.ts:28-33`), origin allowlist that refuses to let a localhost origin bypass a configured production list (`worker/src/index.ts:168-196`), capped request bodies (`readCappedJson` in `worker/src/http.ts`), allowlisted market/on-chain routers, and two dedicated security test files.

**Findings.**

- **Static CSP nonce.** `public/_headers:15` ships `script-src 'self' 'nonce-VwY65J9HsSZUqkEll3A'`. A nonce must be unpredictable per response; this one is a constant published in the header, so any injected inline script can copy it. It provides no protection over `'self'` and creates a false sense of safety.
- **`connect-src 'self' https: wss:`** (`public/_headers:15`) allows exfiltration to *any* HTTPS host. For an app that holds exchange API secrets in browser memory (`src/data/credentials.ts`), an explicit exchange allowlist would be tighter.
- **Rate limiting is per-isolate, in-memory** and documented as best-effort (`worker/src/rate-limit.ts:20-28`). Acceptable for `/api/run`, not a defence against distributed abuse.
- **`innerHTML`** used at `src/chart/pane-badge.ts:77` and `src/chart/drawing-layer.ts:983` — both are internal SVG/clear operations, low risk, but they are the only two and should stay that way.
- **Dependency vulns** (§5.5) are the largest actual security exposure.
- **CORS default origin is stale**: `worker/src/index.ts:185` falls back to `https://pynescript.online`, not the current product host `https://axis.hoox.sh`.

---

## 6. Findings table (P0–P3)

| ID | Sev | Area | Finding | Evidence | Impact | Effort |
|---|---|---|---|---|---|---|
| **P0-1** | P0 | Deps | 15 known vulns incl. 2 critical (`seroval`, `storybook`) | `bun audit` output §5.5 | RCE/dev-server code injection, DoS | S |
| **P0-2** | P0 | Types | 17 network responses cast with `as <Type>`, never validated | `src/engines/pro.ts:386`, `catalog.ts:344,1302`, `update/update-manager.ts:135`, `engine/rest-fallback.ts:77`, `editor/pyne-lsp-client.ts:178,222,285`, `mcp/dispatch.ts:356,382` | Malformed/hostile upstream crashes or corrupts state | M |
| **P1-1** | P1 | Types | 364 exports lack explicit return types; 46 `any` (29 `ISeriesApi<any>`) | §4.1, §5.2 | Inference drift, untyped chart hot path | M |
| **P1-2** | P1 | Types | App `tsconfig` missing `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noUnusedLocals` | `tsconfig.json:1-24`; 536 latent errors §4.3 | Whole class of `undefined` bugs unchecked | L |
| **P1-3** | P1 | Types | Persisted state cast, not validated | `src/storage/workspace-snapshot.ts:485,492`; `src/store/index.ts:2099` | Corrupt localStorage/snapshot → bad render | M |
| **P1-4** | P1 | Arch | 3 runtime import cycles, 34 files; largest spans store/storage/engines | §5.1 SCC output | Partial module init, untestable order | L |
| **P1-5** | P1 | Docs | 1 258 / 4 621 exports undocumented (27.2 %) | §4.2 | Onboarding + API misuse | L |
| **P1-6** | P1 | Docs | README advertises 2.25.3 / CLI 0.3.5; actual 2.28.0 / 0.3.6 | `README.md:12` vs `VERSION`, `packages/cli/package.json` | Wrong install instructions | XS |
| **P2-1** | P2 | Arch | God modules: store 6 170 LOC / 263 exports, pane-manager 4 299, drawing-layer 3 274 | `src/store/index.ts`, `src/chart/pane-manager.ts`, `src/chart/drawing-layer.ts` | Review cost, merge conflicts, boot parse | XL |
| **P2-2** | P2 | Arch | Duplication ≥3×: `asFiniteNumber` 9×, `asTwo` 8×, `/`-focus handler 7×, SHA-256 2× | `src/results/debug-pins.ts:109` +8; `src/chart/drawings/tools/patterns.ts:45` +7; `src/indicators/IndicatorPanel.tsx:194` +6; `worker/src/auth.ts:52` vs `worker/src/tenant.ts:136` | Divergent fixes, inflated surface | M |
| **P2-3** | P2 | Tests | Core files under 25 % coverage (drawing tools, durable object, screenshot) | `coverage/lcov.info` §5.4 | Regressions in drawing/DO logic | L |
| **P2-4** | P2 | Perf | 803 kB main chunk (243 kB gzip), Vite size warning | build output §5.6 | Slow first paint on mobile | M |
| **P2-5** | P2 | Security | Static CSP nonce + `connect-src https:` wildcard | `public/_headers:15` | Nonce gives no protection; wide exfil path | S |
| **P2-6** | P2 | CI | No dependency-audit step; no bundle-size budget | `.github/workflows/ci.yml:20-70` | Silent regression | S |
| **P3-1** | P3 | Arch | `src/store` vs `src/stores`, `src/engine` vs `src/engines` | directory tree | Wrong-import mistakes | S |
| **P3-2** | P3 | Types | Dead `void 0 as unknown as ToolHitCtx` import-keepers | `src/chart/drawings/tools/lines.ts:248-249`, `gann.ts:415-416`, `trading-extra.ts:226-227` | Dead code, hides real unused imports | XS |
| **P3-3** | P3 | Types | Unsound generic: stale write resolves `undefined as T` | `src/data/dataset-store.ts:303` | Caller believes a value exists | XS |
| **P3-4** | P3 | Lint | 3 440 Biome warnings, 270 infos, 0 errors | `bun run lint` | Noise hides real issues | M |
| **P3-5** | P3 | Security | CORS default origin stale (`pynescript.online`) | `worker/src/index.ts:185` | Wrong default header for axis.hoox.sh | XS |
| **P3-6** | P3 | Security | Rate limit is per-isolate only | `worker/src/rate-limit.ts:20-28` | No distributed protection (documented) | M |

**Severity key.** P0 = exploitable/correctness-critical now. P1 = systemic debt that will cause bugs. P2 = quality/scale drag. P3 = hygiene.

---

## 7. Proposed hardening plan (for approval)

The request is: 100 % types, docstrings on every export, conservative structure fixes, **no behaviour change**, with real command output. Two parts of that need an explicit scope decision, because a literal reading is not achievable at acceptable quality in one pass:

### Phase 1 — Types (mechanical, verifiable by `tsc`)

1. Add explicit return types to all 364 exported functions/consts.
2. Replace the 29 `ISeriesApi<any>` with a real series-type union; remove the remaining 17 `any`.
3. Remove all 44 `as unknown as` (replace with typed guards or precise narrow types).
4. Eliminate `void 0 as unknown as` import-keepers (P3-2) and the unsound `undefined as T` (P3-3).
5. Turn on, in `tsconfig.json`: `noUncheckedIndexedAccess`, `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`, `noPropertyAccessFromIndexSignature`, `useUnknownInCatchVariables`.
   - `exactOptionalPropertyTypes` (407 errors) is the one flag with **behaviour risk**: it changes whether `undefined` is an assignable property value, and persisted JSON shapes depend on that. Recommend a separate, opt-in commit with review.
6. Add an ESLint-free CI guard (a small `scripts/check-types.mjs` or Biome rule) that fails on new `any` / `as unknown as` / `@ts-ignore`.

### Phase 2 — Schema-validate I/O (needs a decision)

Two options:

- **(a) Zero new dependency** — extend the existing `is*(v: unknown)` guard family into `src/utils/validate.ts` (and `worker/src/validate.ts`), and wrap every `res.json() as X`, every `JSON.parse` at a trust boundary, and every worker body parse. Keeps bundle size and lockfile unchanged. More code to hand-write (~17 network sites + ~10 persisted-state sites + worker request bodies).
- **(b) Add `zod`** — far less code, better error messages, but a new runtime dependency (~14 kB gzip) in the main chunk, and it changes the dependency surface.

Recommendation: **(a)** for the app's persisted state and the worker (already has hand guards), **(b)** only if you accept the dependency for the engine/LSP/update clients.

### Phase 3 — Docstrings (needs a scope decision)

1 258 undocumented exports. Options:

- **(a) Full sweep** — every export in `src`, `worker/src`, `packages/`, including Storybook stories. Highest completeness, but at ~1 250 symbols the per-symbol accuracy inevitably drops; some will describe the signature rather than the intent.
- **(b) Product surface only** — all exports except `src/stories/**` (58) and trivial re-export barrels: ~1 200 symbols. Barely cheaper.
- **(c) Public API + hot paths** — `worker/src` (100), `src/store` (18), `src/data` (102), `src/engine` (88), `src/engines` (40), `src/mcp` (27), `src/onchain` (25), `src/alerts` (22), `src/plugins` (28), `src/storage` (17), `packages/cli` (78) ≈ **545 symbols**. Every one can be written with the function read end-to-end.

Recommendation: **(c) first**, then **(a)** as a follow-up PR, because "accurate docstring" and "1 250 symbols in one session" are in tension. I would rather ship 545 accurate ones and be honest than 1 258 plausible ones.

### Phase 4 — Structure (conservative, behaviour-preserving)

1. Extract the duplicated helpers: `asFiniteNumber` (9×), `asTwo` (8×), `focusSearchOnSlash` (7×), `sha256Hex` (2×). Pure moves, covered by existing tests.
2. Delete dead import-keepers and the unsound generic.
3. Break the 2-file and 6-file cycles (low risk). Leave the 26-file cluster alone in this pass — it needs a design decision, not a refactor, and touching it violates "behaviour must not change".
4. Fix README version drift and the stale CORS default.

### Phase 5 — Verification

`bun run typecheck`, `bun run typecheck:all`, `bun run lint`, `bun run test`, `bun run build`, plus the before/after metric script, with raw output pasted into `AUDIT-CHANGELOG.md`.

### Explicitly out of scope unless you say otherwise

- Dependency upgrades (P0-1) — they change the lockfile and can change runtime behaviour. Recommend a separate PR immediately after.
- Splitting `src/store/index.ts` (P2-1) — largest behaviour risk in the repo.
- CSP nonce rework (P2-5) — needs a server/Pages change, not a source change.
- Coverage uplift (P2-3) — new tests, not hardening.

---

## 8. Before/after metric harness

`/tmp/opencode/axis-metrics.ts` is the read-only collector used for §4. It walks `src`, `worker/src`, `packages/cli/src`, `packages/datafeed/src` with the TypeScript AST and reports exports, missing return types, missing JSDoc, `any`, casts, `as unknown as`, and non-null assertions. It will be committed as `scripts/audit-metrics.mjs` in Phase 1 so the after-numbers are reproducible, and its output will be pasted into `AUDIT-CHANGELOG.md`.

Baseline (this document):

```
files=654
exported symbols       = 4621
  missing return type  = 364  (92.1% typed)
  missing JSDoc        = 1258  (72.8% documented)
any keywords           = 46
as-casts               = 1657
  as unknown as        = 44
non-null assertions    = 887
```
