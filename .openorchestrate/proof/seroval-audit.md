---
title: seroval 1.5.6 audit finding — reachability, proposed fix, test plan
date: 2026-11-13
repo_head: ad957103
status: investigation complete — fix NOT applied (shared working tree, other agents editing)
card: "seroval 1.5.6 critical audit finding: investigate reachability, propose override >=1.6.10, run tests"
---

# seroval audit finding — AXIS

## 1. Dependency chain (confirmed)

`bun pm why seroval` (run 2026-11-13, bun 1.4.4):

```
seroval@1.5.6
  ├─ peer seroval-plugins@1.5.6 (requires ^1.0)
  │  └─ solid-js@1.9.14 (requires ~1.5.4)
  │     └─ axis (requires ^1.9.5)
  └─ solid-js@1.9.14 (requires ~1.5.4)
```

- Root cause: `solid-js@1.9.14` declares `seroval: ~1.5.4` and `seroval-plugins: ~1.5.4`
  (verified in `node_modules/solid-js/package.json`). Installed `seroval` = **1.5.6**,
  `seroval-plugins` = **1.5.6**.
- AXIS has **no direct dependency** on seroval; no `overrides` / `resolutions` field exists
  in `package.json` (grep confirmed; `bun.lock` has no overrides either).
- Other audit findings in the same `bun audit` output (nanoid, source-map-js, storybook,
  vite) are out of scope for this card but are noted in §7.

## 2. Advisories (exact IDs, from `bun audit` output)

all six affect the installed 1.5.6 via the `solid-js > seroval-plugins > seroval` path:

| ID | Severity | Summary | Vulnerable range | Fixed in |
|----|----------|---------|------------------|----------|
| GHSA-p6vx-979v-rg4c | **critical** | `fromJSON()` Promise thenable assimilation invokes plugin-produced callables (bypass of GHSA-mv8w-475r-vwqw) | >=0.12.0 <=1.6.0 | ≥1.6.1 (binding: ≥1.6.10 via GHSA-9wx9) |
| GHSA-jp82-f5mq-hwhp | high | Memory exhaustion via unchecked TypedArray length in JSON deserialization | <=1.6.2 | ≥1.6.3 |
| GHSA-9wx9-5pv9-3349 | moderate | Script injection through RegExp sources in serialized output | >=1.5.5 <1.6.10 | **≥1.6.10** |
| GHSA-97r2-qh9m-474h | high | `fromJSON` trusts node-supplied array length / sequence doneAt (unauthenticated event-loop DoS) | <=1.6.7 | ≥1.6.8 |
| GHSA-wp97-x4hv-qvhp | high | `fromJSON`/`fromCrossJSON` DoS via unvalidated array node length | >=1.4.1 <=1.6.7 | ≥1.6.8 |
| GHSA-7rv5-mrxv-xcr9 | high | Deserialization invokes attacker-chosen callables: AsyncIteratorFactoryInstance calls `source.on(listener)` without type check | <=1.6.7 | ≥1.6.8 |

Binding constraint: **seroval ≥ 1.6.10** (GHSA-9wx9-5pv9-3349). `bun audit` reports
"15 vulnerabilities (2 critical, 8 high, 4 moderate, 1 low)" overall; 6 of those are seroval.

## 3. Reachability assessment — verdict: NOT REACHABLE via known AXIS paths (with caveats)

What seroval is used for in solid-js: **only the SSR renderer**. Verified by grep of the
installed package:

```
node_modules/solid-js/web/dist/server.js:   import { Serializer, Feature, getCrossReferenceHeader } from 'seroval';
node_modules/solid-js/web/dist/server.cjs:  var seroval = require('seroval');
node_modules/solid-js/web/dist/web.js:      0 occurrences of seroval   ← client build, clean
node_modules/solid-js/dist/solid.js:         0 occurrences
node_modules/solid-js/store/dist/store.js:   0 occurrences
```

Evidence that AXIS never exercises the SSR/seroval path:

1. **No SSR anywhere.** No `renderToString`, `renderToStream`, `renderToStreamAsync`,
   `isServer`, or `hydrate(` from `solid-js/web` anywhere in `src/`, `worker/`, `packages/`,
   `scripts/`, `tests/`, or `e2e/` (grep). The app entry `src/index.tsx:40` uses
   `render` from `solid-js/web` — the **client** build.
2. **No seroval imports** in `src/`, `worker/`, `packages/` — zero direct usage.
3. **Vite config** (`vite.config.ts`) uses `vite-plugin-solid` with no `ssr` option and no
   SSR build target; `d.includes('/solid-')` appears only in the client manualChunks config.
4. **AXIS persists state via `JSON.parse`/`JSON.stringify`** (e.g. `src/store/index.ts:939`
   `JSON.parse(raw)`; `JSON.stringify` at 3220/3221) — never via seroval `fromJSON`.
   The many `hydrate*` matches in `src/store/index.ts` are localStorage/session restore
   helpers, not seroval.
5. **No meta/teleport SSR streaming**: `<Meta…>` matches in `src/indicators/IndicatorCard.tsx`
   are a local badge component, not `@solidjs/meta` SSR serialization; no `<Teleport>` SSR
   streaming usage found.
6. **Worker** (`worker/`) has no solid-js/seroval usage (grep clean).

Caveats / honesty box:
- **UNVERIFIED**: whether the production client bundle contains any seroval bytes. Static
  analysis of the installed package says no (client `web.js` never imports seroval), but a
  bundle-level grep of `dist/` was not run as part of this pass (no build was executed;
  see test plan). If a future SSR target, server entry, or `solid-js/web` server import is
  added, this verdict flips.
- **UNVERIFIED**: Storybook (`storybook-solidjs-vite`) rendering path. Storybook for solid
  renders client-side by default, but no explicit check of its SSR behaviour was performed.
  Storybook is a dev-only tool, not shipped.
- Even if never serializing untrusted input today, fixing is cheap (see §4) and removes
  the finding class entirely — do not rely on "not currently reachable" as a permanent stance.

**Verdict: the vulnerable `fromJSON`/deserializer path is not exercised by any known AXIS
runtime path (client SPA, no SSR, no seroval call sites). Exploitability in AXIS as shipped:
not demonstrated, no evidence of reachability. This is NOT the same as "proven safe" — it is
"no reachable sink found". The finding should still be fixed by bumping versions.**

## 4. Proposed fix (NOT applied)

### Option A (recommended): bump solid-js within 1.x

`solid-js@1.9.16`+ moved to `seroval ~1.6.8`; `solid-js@1.9.18`/`1.9.19` use
`seroval ~1.6.11` and `seroval-plugins ~1.6.8`. Verified via `npm view`:

```
1.9.15: seroval ~1.5.4
1.9.16: seroval ~1.6.8
1.9.17: seroval ~1.6.8
1.9.18: seroval ~1.6.11
1.9.19: seroval ~1.6.11   (latest 1.x; solid-js 2.x is rc-only — do NOT jump majors)
```

`~1.6.11` satisfies the ≥1.6.10 binding constraint and fixes all six advisories.
This is a semver-minor bump inside the existing `^1.9.5` range — **no override needed**.

Proposed diff (`package.json`):

```diff
-    "solid-js": "^1.9.5"
+    "solid-js": "^1.9.19"
```

Commands (run when no other agent is mutating the install):

```bash
bun install                 # updates bun.lock: solid-js 1.9.14 -> 1.9.19, seroval -> ~1.6.11
bun audit                   # expect the 6 seroval advisories gone
```

### Option B (fallback / belt-and-braces): explicit override

If the solid-js bump is deferred for any reason, pin seroval via bun's `overrides`
(bun supports npm-style `overrides` in package.json; repo currently has none):

```diff
   "packageManager": "bun@1.4.3",
+  "overrides": {
+    "seroval": "^1.6.11",
+    "seroval-plugins": "^1.6.11"
+  },
```

Caveat: this forces `seroval@1.6.11` under solid-js 1.9.14's `~1.5.4` range — a cross-minor
forced resolution. solid-js 1.9.14's SSR serializer was built against seroval 1.5.x APIs;
it very likely works (1.6.x kept the Serializer API) but is **not** the tested combination.
Prefer Option A. If Option B is used, the test plan in §5 is mandatory, including an SSR
smoke test.

Note: `seroval-plugins@1.6.12` is the newest 1.6.x; `~1.6.8` from solid-js 1.9.19 resolves
to 1.6.12, which depends on seroval ^1.6.x — consistent.

## 5. Test plan (after applying either option)

1. `bun audit` — seroval advisories gone; record before/after counts (before: 15 total /
   6 seroval; target: 0 seroval).
2. `bun pm why seroval` — shows 1.6.11+ everywhere; `grep -E '"seroval' bun.lock`.
3. `bun run test` (unit + worker) — must stay green.
4. `bun run build` — must succeed; then `grep -ri seroval dist/ | head` — expect no matches
   (client bundle should not contain seroval). Attach output as proof.
5. `bun run test:e2e:smoke` — app boots, chart renders (exercises solid-js runtime).
6. SSR smoke (guards Option B and future-proofs): a one-off script rendering a component with
   `renderToString` from `solid-js/web` and asserting it returns markup — verifies the
   seroval-backed path executes on the new version. (Not part of the normal suite; run once
   manually.)
7. Manual smoke of hydration paths that touch `src/store/index.ts` hydrate* functions
   (localStorage restore) — covered by existing `bun run test` store tests.
8. If Option A: also verify `bun.lock` diff only touches solid-js/seroval/seroval-plugins
   (+ transitive hashes). If anything else moved, stop and report.

## 6. Rollback

- Option A: `git checkout package.json bun.lock && bun install` (restores solid-js 1.9.14 /
  seroval 1.5.6). No data migration, no persisted-state format change (seroval is not used
  for persisted state — persistence is JSON).
- Option B: remove the `overrides` block, `git checkout bun.lock && bun install`.
- Either way: no runtime/config/secrets changes to revert; redeploy only if already shipped.

## 7. Out of scope / noted in passing (not fixed here)

`bun audit` also reports: nanoid <3.3.18 (high, via vite>postcss), source-map-js <1.2.2
(high, via tailwind/vite), storybook 10.6.1 (1 critical + 1 high — fixed in 10.6.2),
vite 6.4.3 (1 low, 2 moderate, 1 high — dev server issues). Worth a separate card;
majority are dev-only. Not touched in this task.

## 8. What was NOT done (per instructions)

- No `bun install`, no lockfile changes, no `package.json` edits — shared working tree with
  uncommitted changes from other agents (`src/chart/live-append.ts`, `src/store/index.ts`,
  etc. modified). Applying the bump now could race other agents' installs.
- No commits, no push, no board move. Card remains with the requester/spawner to move to
  Done/Ready after the fix lands and §5 passes.

## 9. Evidence index

- `bun pm why seroval` output — 2026-11-13 (chain, §1)
- `bun audit` output — 2026-11-13 (advisories, counts, §2)
- `node_modules/solid-js/package.json` — `seroval: ~1.5.4`, version 1.9.14 (§1)
- grep: seroval imports only in `solid-js/web/dist/server.{js,cjs}`; 0 hits in client builds (§3)
- grep: no SSR/seroval/fromJSON call sites in src/, worker/, packages/, scripts/, e2e/ (§3)
- `src/store/index.ts:939` — JSON.parse persistence path (§3)
- `npm view solid-js@1.9.{15..19} dependencies.seroval` (§4)
- `npm view seroval version` → 1.8.1; `seroval-plugins` 1.6.x line exists, 1.6.12 latest 1.6.x (§4)
- `git rev-parse --short HEAD` → ad957103; working tree dirty (other agents) — fix deferred (§8)

---

## 10. Applied — 2026-11-13 (Option A, solid-js bump)

Applied by oo-spec-2 (subagent) on user approval. Working tree was dirty with
other agents' uncommitted work; only `package.json` + `bun.lock` were touched
for the fix. No commit, no push, no deploy.

### Diff

```diff
-    "solid-js": "^1.9.5"
+    "solid-js": "^1.9.19"
```

`bun.lock`: solid-js 1.9.14 → **1.9.19**, seroval 1.5.6 → **1.6.12**,
seroval-plugins 1.5.6 → **1.6.12**. Lock diff touches only these three packages
(+ transitive hashes); nothing else moved. Verified via `git diff bun.lock`.

`bun pm why seroval` after: `seroval@1.6.12` ← `solid-js@1.9.19` (`~1.6.11`),
`seroval-plugins@1.6.12` ← `solid-js` (`~1.6.8`, resolves to 1.6.12).

### Worker check

`worker/package.json` has **no** solid-js / seroval dependency or peer chain
(deps: isomorphic-git, zod; dev: wrangler, @cloudflare/workers-types, typescript).
Nothing to change there; reported, not modified.

### Audit before / after

Before (2026-11-13, solid-js 1.9.14):
`15 vulnerabilities (2 critical, 8 high, 4 moderate, 1 low)` — 6 of them seroval
(1 critical + 4 high + 1 moderate via the `solid-js > seroval-plugins > seroval` path).

After (solid-js 1.9.19 / seroval 1.6.12):
`9 vulnerabilities (1 critical, 4 high, 3 moderate, 1 low)` — **0 seroval findings**.
Remaining 9 are pre-existing and out of scope: nanoid (vite>postcss), source-map-js
(@tailwindcss/vite, vite>postcss), storybook 10.6.1 (+@storybook/addon-docs,
storybook-solidjs-vite), vite 6.4.3 (+ launch-editor advisories).

### Checks (all run locally, 2026-11-13)

- `bun install` — clean; installed solid-js@1.9.19, seroval@1.6.12, seroval-plugins@1.6.12.
- `bunx tsc --noEmit` — exit 0, no errors.
- Gated 7 suites (`bun test --isolate`): store-append-immutable, live-append,
  store-live-frame, pane-manager, live-wire, heavy-data, chart-series-sanitize →
  **224 pass / 0 fail** (936 expect calls, 7 files, 1.52s).
- Full suite `bun test`: **5247 pass / 16 fail** (5273 tests, 443 files, ~60s).
  The 16 failures were verified **identical on the pre-bump baseline**: package.json/
  bun.lock were temporarily restored to solid-js 1.9.14, `bun install` + full
  suite re-run produced the same 16 failing test names (diff of name lists:
  identical set — appendBar scale invariants, mergeEngineSnapshot,
  pynescript_runtime interpret, multiplex×4, engine-owned live paint×8,
  loadSymbolData). My bump was then re-applied and re-installed. These 16 are
  pre-existing and unrelated to seroval/solid-js (they live in the dirty
  live-wire / multiplex / store / live-append optimization work).
- `bun run build` — **success** in 22.28s (Vite). Only the usual >450 kB chunk
  size warning.
- `grep -ri seroval dist/ | wc -l` → **0**. Seroval is absent from the client bundle
  (expected: seroval is only reachable via `solid-js/web` SSR, which AXIS does not use).

### Deviations / honesty box

- Full suite has 16 failing tests, all pre-existing (verified against baseline as
  above) — not introduced by, and not fixed by, this bump.
- e2e smoke (`bun run test:e2e:smoke`) and the SSR `renderToString` smoke from §5
  items 5–6 were **not run** — not requested for this pass; nothing in the change
  adds an SSR path.
- `bun audit fix` was NOT used; the bump was the targeted fix. Remaining 9 audit
  findings belong to other cards.
- No commit / push / deploy performed (per instruction). CHANGELOG not updated here
  (no release in flight; spawner owns release flow).

### Status

Fix applied and verified in the working tree, uncommitted. Checklist vs §5 test
plan: audit ✓, lock diff ✓, unit suites ✓ (targeted 7/7 green; full suite failures
pre-existing), build ✓, dist grep ✓. e2e smoke + SSR smoke not run (not requested).
