# AXIS — Type & Documentation Hardening

**Base revision:** `7cb3e7b9` (`main`) — note the base moved during the pass, see §0
**Audit:** [`AUDIT.md`](./AUDIT.md)
**Date:** 2026-11-06
**Branch state:** uncommitted working tree (see §0 — do **not** commit blindly)

---

## 0. Working-tree caveat (read first)

Another session was committing to `main` while this pass ran. Two commits landed
mid-flight (`fed92f4c` engine keepalive heartbeat, `7cb3e7b9` axb1-full default
encoding), and the branch created for this work (`audit/type-docs-hardening`)
was reset back to `main`. Consequences:

- **Everything below is uncommitted.** 535 modified files + 4 new files sit in
  the working tree on `main`.
- `src/engines/engine-ws.ts` is **co-edited**: the other session added the
  heartbeat; this pass only applied the `noPropertyAccessFromIndexSignature`
  rewrite (`rec.type` → `rec['type']`). Do not revert either half.
- Nothing was committed, staged, or stashed by this pass.
- Re-run the verification block (§6) before committing — the base can move again.

---

## 1. Scope decisions (approved)

| Decision | Choice |
|---|---|
| Docstrings | Product surface first (~545 symbols) — the sweep ultimately covered **all 4,633** |
| I/O validation | Zero new dependencies (internal validators) |
| Strictest tsconfig | All flags **except** `exactOptionalPropertyTypes` |
| Dependency vulns (P0-1) | **Deferred** to a separate PR |
| Behaviour | Must not change |

---

## 2. Phase 1 — Types

### 2.1 Strictest tsconfig

`tsconfig.json` gained:

```jsonc
"noUncheckedIndexedAccess": true,
"noImplicitOverride": true,
"noImplicitReturns": true,
"noFallthroughCasesInSwitch": true,
"noUnusedLocals": true,
"noUnusedParameters": true,
"noPropertyAccessFromIndexSignature": true,
"useUnknownInCatchVariables": true,
"isolatedModules": true,
"verbatimModuleSyntax": true
```

`exactOptionalPropertyTypes` was left off as agreed (407 latent errors, and it
changes whether `undefined` is assignable to optional properties, which persisted
JSON shapes depend on).

The 536 latent errors those flags exposed were all fixed:

| Flag | Errors fixed |
|---|---:|
| `noPropertyAccessFromIndexSignature` | 2,410 rewrites (compiler-span driven, then re-verified) |
| `noUncheckedIndexedAccess` | 129 |
| `noUnusedLocals` / `noUnusedParameters` | 59 |
| `noImplicitOverride` | 16 |

The 2,410 bracket rewrites were produced by a codemod that consumed TypeScript's
own TS4111 diagnostics (exact spans), so no unrelated expression was touched.

### 2.2 Explicit return types — 364 → 0

Applied by a codemod that asked the type checker for each function's inferred
return type under the new strict flags (`checker.getReturnTypeOfSignature` +
`typeToString`), then inserted it. Because inference ran *after* the flags were
enabled, the annotations include the `| undefined` the strict index checks
introduce — they are not optimistic.

`JSX.Element` annotations required one supporting change: with
`jsx: "preserve"` TypeScript resolves JSX at usage sites but not for a bare
annotation, so `src/vite-env.d.ts` now declares a global `JSX` namespace that
mirrors `solid-js.JSX` member-for-member (type-only, nothing emitted).

### 2.3 `any` — 46 → 0

- 29 × `ISeriesApi<any>` → `ISeriesApi<SeriesType>` across `src/chart`,
  `src/theme` (verified that `ISeriesApi<'Candlestick'>` and
  `ISeriesApi<'Line'>` are assignable to it).
- `ISeriesMarkersPluginApi<any>` → `ISeriesMarkersPluginApi<Time>` (the actual
  horizontal-scale type; `UTCTimestamp` was wrong and the compiler caught it).
- `Component<{ children?: any }>` → `Component<{ children?: JSX.Element }>`.
- `packages/datafeed`: 12 `any` replaced with a declared local ccxt surface
  (`CcxtModule`, `CcxtExchange`, `OhlcvRow`) plus an `unknown`-narrowing
  `isCcxtModule` predicate.

### 2.4 `as unknown as` — 44 → 0

Each was replaced with real narrowing. Representative examples:

| Site | Before | After |
|---|---|---|
| `src/chart/manager-access.ts:797,814` | `mgr as unknown as {…}` | direct reads of two **public** `PaneManager` methods (the cast was noise) |
| `src/chart/pane-manager.ts:3181,3207` | `this as unknown as {…}` | direct `this.prepareCoPaintedForCandleTimes` |
| `src/chart/pine-tables.ts:178` | `raw as unknown as Record<…>` | existing local `isRecord` guard |
| `src/plugins/loader.ts` (5) | `p as unknown as XPlugin` | five per-kind type predicates |
| `src/version.ts` | `import.meta as unknown as {env}` | `import.meta as ImportMeta & { env?: ImportMetaEnv }` (single precise cast; template in `scripts/sync-versions.mjs` updated) |
| `src/data/dataset-store.ts:303` | `Promise.resolve(undefined as unknown as T)` | `enqueueWrite<T>` now returns `Promise<T \| undefined>` |
| `worker/src/keys.ts`, `tenant.ts` | `(env as unknown as {X}).X` | `env.X` (already declared on `Env`) |
| `src/chart/drawings/tools/{lines,gann,trading-extra}.ts` | `void 0 as unknown as ToolHitCtx` | deleted (dead import-keeper hacks, obsolete under `noUnusedLocals`) |

Remaining single-step `as` casts: **1,559** (down from 1,657). These are
narrowing casts on values the surrounding code already validates (e.g.
`parsePlotDisplay(plot.display)`), not double casts. They were not mass-removed:
each needs a semantic guard, and a blanket rewrite would risk behaviour.

### 2.5 Other type fixes

- `src/chart/series-factory.ts` — new `plotColorAt(index)` helper replaces four
  `PLOT_PALETTE[i % len]` sites that were `string | undefined`.
- `src/chart/pane-manager.ts` — new `clampLineWidth()` replaces three
  `as 1 | 2 | 3 | 4` casts and two raw `Math.max/min` calls.
- `src/chart/onchain-events.ts`, `onchain-overlay.ts` — unreachable guards make
  the first/last element types total.
- `src/ui/SideRays.tsx` — the WebGL uniform map is now built from an explicit
  `UNIFORM_NAMES` union instead of `Record<string, …>`, removing 21 `undefined`
  reads and the `parseColor` index casts.

---

## 3. Phase 2 — I/O validation (zero dependency)

New `src/utils/validate.ts`:

| Export | Contract |
|---|---|
| `isRecord(v)` | non-null, non-array object predicate |
| `readJsonRecord(res)` | parsed object, or `{}` for absent/non-object/parse-error bodies |
| `readJsonUnknown(res)` | raw JSON value, or `null` |
| `finiteNumber(v)` | permissive numeric coercion (the 7× duplicated `asFiniteNumber`) |
| `numberField` / `stringField` | typed field reads from a record |

Applied at 6 network boundaries that previously used `as`:

| File | Before | After |
|---|---|---|
| `src/engines/pro.ts:386` | `as Record<string, unknown>` | `readJsonRecord` + `isRecord(parsed['usage'])` |
| `src/engines/prewarm.ts:228` | `as Record<…> \| null` | `readJsonUnknown` + `isRecord` |
| `src/update/update-manager.ts:143` | `as VersionJson` | `readJsonRecord` + `body['version']` |
| `src/engine/live-ticket.ts:171` | `as { ticket?: unknown }` | `isRecord` + `typeof body['ticket'] === 'string'` |
| `src/mcp/dispatch.ts:356,382` | `as { error?: {…} }` | `readJsonRecord` + `isRecord(body['error'])` |

Still cast, but already field-validated inline (documented, not silently left):
`src/engine/rest-fallback.ts:77`, `src/editor/pyne-lsp-client.ts` (×3),
`src/engines/catalog.ts` (×2). Converting those needs per-endpoint schemas, which
is a design change rather than a hardening pass.

`worker/src` already validates its request plane (`readCappedJson`, `parseJsonRpc`)
and was left as-is.

---

## 4. Phase 3 — Docstrings

**1,258 → 0 undocumented exports (4,633 / 4,633).**

Total `/** */` blocks in the four measured trees: 7,082 → 8,558.

Coverage by area (all now 100 %):

| Area | Documented this pass |
|---|---:|
| `src/ui` | 239 |
| `src/chart` + `src/stories` | 200 |
| `worker/src` | 94 |
| `packages/cli` | 84 |
| `src/editor` + `src/theme` + misc | 131 |
| `src/engine` + `src/engines` + `src/mcp` | 169 |
| `src/data` | 102 |
| `src/indicators` + `src/results` | 76 |
| `src/alerts` + `src/plugins` + `src/onchain` + `src/hp` + `src/streams` + `src/update` + `src/sw` | 148 |
| `src/store` + `src/storage` | 40 |
| final leftovers | 27 |

Every block states the contract (why the symbol exists), `@param` per parameter,
`@returns` when non-void, `@throws` when the body throws, and `@example` only
where the call sequence is non-obvious.

Accuracy corrections made during the sweep (not just additions):

- `src/alerts/tick.ts` — `evaluateLiveAlerts` claimed `@returns fired alerts`;
  it returns `Promise<void>`. Corrected.
- `worker/src/mcp/bridge.ts` — a doc block was attached to `interface TabInfo`
  but described `McpBridgeDO`. Moved.
- `src/ui/shortcuts/runtime.ts` — `registerShortcut`'s block sat above
  `fireShortcutById`. Moved.
- `src/ui/shortcuts/pine-snippets.ts` — `getPineSnippet` claimed a fallback the
  code does not implement. Corrected.
- `src/plugins/types.ts` — two orphaned blocks that documented nothing were
  removed; their accurate replacements now sit on `RunResult` / `EnginePlugin`.
- `src/engines/engine-ws.ts` — claims about `disconnect()` being terminal and
  the API key never reaching the URL were both false; corrected.

---

## 5. Phase 4 — Conservative structure fixes

### 5.1 Duplication removed

| Pattern | Copies before | After | Destination |
|---|---:|---:|---|
| `asFiniteNumber` (identical body) | 9 | 2 | `src/utils/validate.ts#finiteNumber` |
| `asTwo` (identical body) | 8 | 0 | `src/chart/drawings/tools/safe.ts#asTwoPoint` |
| `/`-focus keydown handler | 7 | 1 | `src/ui/focus-search.ts#bindSlashToSearch` |
| SHA-256 hex implementation | 3 | 1 | `worker/src/hash.ts#sha256Hex` |

The 2 remaining `asFiniteNumber` copies are **deliberately different**
(`src/results/pyne-logs.ts` accepts `''`; `src/results/plot-visuals.ts` rejects
`"na"`/booleans and is documented as kept in sync with `run-engine` coercion) —
merging them would change parsing behaviour.

The 1 remaining `/` handler is `src/ui/ScriptSettingsModal.tsx`, which has
different semantics (only while the modal is open, different field detection).

`worker/src/hash.ts` also exports `partitionIdFromKey`, now shared by
`worker/src/auth.ts` and `worker/src/mcp/protocol.ts`.

### 5.2 Dead code removed

- `void 0 as unknown as ToolHitCtx/ToolViewCtx` import-keepers (6 lines, 3 files).
- 23 unused imports / locals that `noUnusedLocals` exposed, including
  `src/indicators/runner.ts`'s entire dead `pyne-drawings` import.
- `src/chart/pane-manager.ts`: four write-only private fields (`suppressSync`,
  `shapeMarkerList`, `pendingTimeRange`) and a dead `toLineData` helper.

> Note: `suppressSync` was set in four places and **never read**. Removing it is
> correct dead-code removal, but it also means the guard it was named for was
> never implemented — worth a follow-up look at time-range sync.

### 5.3 Docs / config

- `README.md:12` — version **2.25.3 → 2.28.0**, CLI **0.3.5 → 0.3.6**.
- `biome.json` — `complexity/useLiteralKeys` set to `off`. This rule recommends
  `obj.foo` over `obj['foo']`, which directly contradicts
  `noPropertyAccessFromIndexSignature`; leaving it on produced 2,640 infos that
  would push contributors to break the tsconfig.
- `scripts/sync-versions.mjs` — template now emits `?.['VITE_APP_VERSION']` and a
  single precise cast, so the generated `src/version.ts` passes the new config.

---

## 6. Behaviour-preservation ledger

Everything below is a case where the *type* forced a code change. Each is either
unreachable or strictly safer; valid-input behaviour is identical.

| File | Change | Reachability / effect |
|---|---|---|
| `src/data/dataset-store.ts` | dropped (reset-raced) write resolves `undefined` instead of `undefined as T` | the old cast already resolved `undefined`; the type now tells the truth. Callers coalesce to their "nothing written" value (`[]` / empty `PutResult`) |
| `src/indicators/apply-store.ts` | plot colour fallback `plotColorAt(colorIdx)` when neither a resolved nor a stored colour exists | previously produced an entry **without** `color` (invalid `PlotStyle`); unreachable from a normal run |
| `src/store/index.ts` | width/visible setters return `ind` unchanged when the plot key is absent | previously created `{width}` / `{visible}` without `color`; the UI only calls these for rendered plots |
| `src/indicators/IndicatorCard.tsx` | stale plot name → `effectivePlotDisplay(undefined)` | both paths return `PLOT_DISPLAY.all` |
| `src/chart/pane-manager.ts` | `clampLineWidth` maps non-finite width to `1` | callers pass 1–4 from a UI control; `NaN` previously reached the chart as an invalid `LineWidth` |
| `src/ui/SideRays.tsx` | missing uniform is `null` instead of absent | every `gl.uniform*` treats `null` and `undefined` as a no-op |
| `src/engines/prewarm.ts` | non-object body → `null` | previously the cast let a non-object through to `raw['status']` |
| `src/engine/live-ticket.ts` | non-object body → empty ticket → `LiveTicketError` | previously a `TypeError` escaped |
| `src/mcp/dispatch.ts` | non-object error envelope → default code/message | same defaults the old optional chain produced |
| `src/chart/pane-manager.ts` | `setTimeout` fallback returns sentinel `0` | the handle was never cancelled; the callback still fires |
| `packages/datafeed/src/index.ts` | `fetch` returns `undefined` instead of `undefined as unknown as Response` | Bun's `MaybePromise<Response \| void>` already allows it |

No public signature changed. No default changed. No error code changed.

---

## 7. Before / after metrics

Measured with the same AST walker on both sides
(`src`, `worker/src`, `packages/cli/src`, `packages/datafeed/src`; `.d.ts` excluded).

| Metric | Before | After |
|---|---:|---:|
| Files measured | 654 | 657 |
| Exported symbols | 4,621 | 4,633 |
| Exports **without explicit return type** | **364** (92.1 %) | **0** (100 %) |
| Exports **without JSDoc** | **1,258** (72.8 %) | **0** (100 %) |
| `any` keywords | **46** | **0** |
| `as unknown as` double casts | **44** | **0** |
| `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` | 0 | 0 |
| Single-step `as` casts | 1,657 | 1,559 |
| Non-null assertions (`!`) | 887 | 885 |
| Strict flags enabled | 1 (`strict`) | 10 |
| Latent errors under stricter flags | 536 | 0 |
| Network `(await res.json()) as T` | 17 | 14 (6 converted to validated reads) |

Tooling:

| Check | Before | After |
|---|---|---|
| `bun check` | ✓ 597 files | ✓ 599 files |
| Biome errors | 0 | **0** |
| Biome warnings | 3,440 | **3,360** |
| Biome infos | 270 | **68** |
| Tests | 5,013 pass / 10 skip / **0 fail** | 5,016 pass / 10 skip / **0 fail** |
| Build | ✓ 19.64 s | ✓ 20.55 s |
| Main chunk | 803.44 kB (243.21 kB gzip) | 803.56 kB (243.14 kB gzip) |
| Scoped coverage gate | 87.8 % (red) | 87.79 % (red, pre-existing) |

Bundle size is flat (+0.12 kB, noise): types and comments erase. The 3 extra
passing tests come from the other session's heartbeat commit, not from this pass.

---

## 8. Command transcript (final, post-change)

```text
### bun check
✓ No type errors in 599 files [492.22ms]

### bun run typecheck:check
$ bunx tsc --noEmit -p tsconfig.check.json
(exit 0 — no diagnostics)

### cd worker && bun check
✓ No type errors in 30 files [31.75ms]

### cd packages/cli && bun check
✓ No type errors in 39 files [44.69ms]

### cd packages/datafeed && bun check
✓ No type errors in 3 files [67.05ms]

### bun run lint
Checked 1198 files in 1913ms. No fixes applied.
Found 3360 warnings.
Found 68 infos.
(0 errors)

### bun run test

 5016 pass
 10 skip
 0 fail
 20846 expect() calls
Ran 5026 tests across 427 files. [41.99s]

### bun run build
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 20.55s
```

### Coverage gate (separate script)

```text
$ bun run test:coverage:gate
 5016 pass
 10 skip
 0 fail
check-coverage: 21610/24615 core lines hit = 87.79% (min 89%)
check-coverage: FAIL below 89%
```

**This gate was already red before this pass.** `scripts/check-coverage.mjs:16-19`
says so explicitly ("the gate has been red on main since before 2026-10-13"), and
none of the new files (`src/utils/validate.ts`, `src/ui/focus-search.ts`,
`worker/src/hash.ts`) are inside the gate's `INCLUDE` list. Closing the 1.2 % gap
needs ~300 covered lines, mostly in `src/store/index.ts` and
`src/chart/manager-access.ts` — that is a test-writing task, not a type task.

---

## 9. Not done (deliberately)

| Audit item | Status | Why |
|---|---|---|
| **P0-1** 15 dependency vulns (2 critical) | **open** | Approved as a separate PR; bumps change the lockfile and can change runtime behaviour |
| **P2-1** god modules (`src/store/index.ts` 6,170 LOC) | open | Largest behaviour risk in the repo; needs a design decision |
| **P2-5** static CSP nonce (`public/_headers:15`) | open | Server/Pages change, not a source change |
| **P2-6** no `bun audit` / bundle-size budget in CI | open | CI policy change |
| **P3-5** stale CORS default (`pynescript.online`) | open | Changing the default *is* a behaviour change |
| **P2-3** coverage cold spots | open | New tests, not hardening |
| 885 non-null assertions | open | Each needs a semantic guard; a blanket rewrite would risk behaviour. They are warnings, not errors |
| 14 remaining network casts | open | Need per-endpoint schemas (design change) |
| Cycle `src/data ↔ src/storage ↔ src/engines ↔ src/store` | open | 26-file SCC; breaking it is a refactor, not a hardening pass |

---

## 10. How to reproduce

```bash
# metrics (same walker both sides)
bun /tmp/opencode/axis-metrics.ts .        # before numbers are in AUDIT.md §4

# verification
bun check && bun run typecheck:check
(cd worker && bun check) && (cd packages/cli && bun check)
bun run lint && bun run test && bun run build

# strictness regression (should print 0)
bunx tsc --noEmit -p tsconfig.check.json \
  --noUncheckedIndexedAccess --noImplicitOverride \
  --noUnusedLocals --noImplicitReturns 2>&1 | grep -c 'error TS'
```

---

## 11. Reviewer checklist

1. `git status` — confirm the base is still `7cb3e7b9` or later, and that
   `src/engines/engine-ws.ts` contains both the heartbeat (other session) and the
   bracket rewrites (this pass).
2. Spot-check five random docstrings for claims the code does not support.
3. Review the behaviour ledger (§6) — every entry should be either unreachable or
   strictly safer.
4. Confirm `biome.json` disabling `useLiteralKeys` is acceptable (it is required
   by `noPropertyAccessFromIndexSignature`).
5. Decide on P0-1 (dependency bumps) before publishing.
