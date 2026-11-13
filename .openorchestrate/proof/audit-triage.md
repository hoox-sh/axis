# bun audit triage — 2026-11-13

Scope: 9 findings after solid-js ^1.9.19 bump (seroval clean). No files modified; investigation + plan only.
All findings are dev/build-time tooling. Nothing below ships in the AXIS runtime bundle or the Worker.

## Findings

### 1. storybook@10.6.1 — CRITICAL GHSA-f2ph-cmg5-wxc8 (+ HIGH GHSA-px85-f4q5-jh77)
- Range: >=10.0.0 <10.6.2. Fix: 10.6.2+ (latest 10.7.x / 10.6.7).
- Chain: direct dev dep (`storybook`, `@storybook/addon-docs`, `storybook-solidjs-vite` → `@storybook/builder-vite`). Transitive of nothing else.
- In-range? `^10.6.1` allows 10.6.7 — semver-compatible bump, no major.
- Exposure: Storybook dev server / preview only. Not shipped, not in prod build. Risk is local dev + local network. Still fix immediately (critical).
- Verdict: FIX-NOW (bump storybook + @storybook/addon-docs + storybook-solidjs-vite together to latest 10.x).

### 2. vite@6.4.3 — LOW GHSA-9jrq-w75r-8gcw, MODERATE GHSA-rq7h-c2jc-7f22, MODERATE (launch-editor) GHSA-698v-4r3x-3vcv + GHSA-r825-w8mm-5pxw, HIGH (launch-editor) GHSA-587h-7wmj-h5pm
- Range: <=6.4.3. Fix: 6.4.4+ (latest 6.x = 6.4.6). Major bump to 7/8 NOT required.
- Chain: direct dev dep `vite ^6.3.0`; also peer of @tailwindcss/vite, vite-plugin-solid, @storybook/builder-vite (all accept ^6). launch-editor is a vite transitive (not in lockfile as top-level; bundled under vite's dep tree — `bun pm why launch-editor` reports no match, i.e. resolved inside vite's dependency closure).
- Exposure: dev server / build tooling only. Middleware + fs.allow + editor-launch paths; none in shipped bundle.
- Verdict: FIX-NOW (bump vite to ^6.4.6 within existing range — lockfile refresh only).

### 3. source-map-js@1.2.1 — HIGH GHSA-68fv-2mgg-jv7q
- Range: >=1.0.0 <1.2.2. Fix: 1.2.2 exists (exact).
- Chain: transitive — @tailwindcss/node@4.3.3 (^1.2.1) and postcss@8.5.23 (^1.2.1). Both ranges allow 1.2.2.
- Exposure: build-time source-map parsing. DoS via crafted map; AXIS builds its own maps — low practical risk, still free to fix.
- Verdict: FIX-NOW via lockfile refresh (or override `source-map-js@1.2.2` if the refresh doesn't pick it up).

### 4. nanoid@3.3.16 — HIGH GHSA-2v37-7h3g-55p8
- Range: <3.3.18. Fix: 3.3.18+ (latest 3.x = 3.3.20).
- Chain: transitive via postcss@8.5.23 (^3.3.16) ← vite. Range allows 3.3.18+.
- Exposure: build-time ID generation; requires caller to pass size=0 with custom generator — postcss does not. Low practical risk.
- Verdict: FIX-NOW via lockfile refresh (same `bun install` as #2/#3) or override `nanoid@^3.3.20`.

## Ordered plan (ascending risk)
1. `bun install` after bumping `vite` to `^6.4.6` and `storybook`/`@storybook/addon-docs` to `^10.6.7` (or latest 10.6.x/10.7.x consistently — keep addon-docs and storybook on the same version). Lockfile refresh pulls nanoid 3.3.20, source-map-js 1.2.2, launch-editor fixed inside vite 6.4.6.
   - Verify: `bun audit` → expect 0; `bun run build` + `bun run test` green; `bun run storybook build` smoke if available.
2. If audit still flags nanoid/source-map-js (stale transitive pins), add `overrides` in package.json: `"nanoid": "^3.3.20"`, `"source-map-js": "^1.2.2"`. Re-audit.
3. Do NOT bump vite to 7/8 or storybook to 11 — not required by any advisory here; major bumps are out of scope.
4. Accept-risk fallback: none needed if steps 1–2 land. If storybook 10.6.7 is somehow uninstallable, accept-risk on the two storybook dev-server advisories only (dev-only, local network), never on the critical — hold the bump instead.

## Could not determine
- Exact launch-editor version resolved inside vite's closure (not addressable by `bun pm why`; it ships as vite's dep). Assumed fixed by vite ≥6.4.4 per advisory range <=6.4.3; verify post-bump with `bun audit`.
- Whether `bun audit fix` alone resolves all four without manual edits — not run (no installs allowed). Plan assumes a normal `bun install` after the manifest bump.

## Checklist
[1] artifact exists — yes (this file)
[2] verified with command — audit output captured above; no code changed (none allowed)
[3] claims sourced — bun audit, bun pm why, npm view, lockfile grep
[4] nothing outside engineering touched — yes; no files modified except this report

## Applied — 2026-11-13

Steps 1–2 of the plan executed. No commit / push / deploy.

### Changes
- `package.json`: `vite` ^6.3.0 → ^6.4.6; `storybook` ^10.6.1 → ^10.6.7; `@storybook/addon-docs` ^10.6.1 → ^10.6.7; added `"overrides": { "nanoid": "^3.3.20", "source-map-js": "^1.2.2" }` (step 2 was needed — lockfile refresh alone left nanoid@3.3.16 and source-map-js@1.2.1 pinned transitive).
- `bun.lock` regenerated via `bun install` (twice).
- vite/storybook NOT bumped across majors.

### Audit before → after
- Before: 9 findings (after seroval bump) → after step 1: 2 high (nanoid <3.3.18 via vite>postcss; source-map-js 1.2.1 via @tailwindcss/node and vite>postcss) → after step 2 overrides: **No vulnerabilities found (checked 328 packages)**.

### Verification
- `bunx tsc --noEmit` — clean (no output).
- `bun run build` — success in ~21s (only the usual >450 kB chunk-size warning).
- `bun test` — 5274 pass / 10 skip / 16 fail (21835 expects, 444 files). Failing set diffed against the known 16 pre-existing failures from seroval-audit.md: identical (appendBar scale invariants; engine-owned live paint ×8; loadSymbolData; mergeEngineSnapshot; multiplex ×4; pynescript_runtime interpret). Subset confirmed — zero new failures.
- `bun audit` — clean.

### Notes / deviations
- Pre-existing uncommitted changes in the tree (src/ui/ResultsModal.tsx, Watchlist.tsx, EventsTab.tsx, etc., .openorchestrate/*) were NOT touched.
- No files outside package.json / bun.lock / this report modified.
