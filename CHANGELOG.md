# Changelog

All notable changes to **AXIS** (`hoox-sh/axis`) are documented in this file.

This changelog is **recursive**: it lists the full git history of the
repository, grouped by month and conventional-commit type. Agents and
humans **must keep it updated** on every release (see `AGENTS.md` § Changelog & releases).

Format roughly follows [Keep a Changelog](https://keepachangelog.com/) with
commit SHAs for traceability.

_Generated/updated: 2026-09-05 · 321 commits · describe-tag: `v2.2.0`_

---

## [Unreleased]

_Upcoming changes._

---

## [2.3.0] — 2026-09-05

### Fixed

- **CI unit tests**: plugin bootstrap now re-registers after `registry.clear()` (catalog flags reset together). Store/runner tests reset `resultsFocusId` so `setLastRun` is not skipped. Data-manager selection is cleared in stream catalog tests. CI pins Bun `1.3.14` (`latest` was racing global store/registry). `bun test --max-concurrency=1` for deterministic unit runs. Worker origin URL helpers live in `src/data/worker-origin.ts` so `store` → HTTP client → market-worker → on-chain proxy no longer hits a TDZ on import.

### Changed

- **Repo description & tags**: GitHub / package / PWA / desktop copy no longer frames AXIS as “for Pine Script”. Tagline covers CEX OHLCV, drawings, on-chain overlays, and Pine Script™ via PYNE; extra GitHub topics and package keywords.

### Added

- **Per-tool drawing settings**: style bar grows context chips (extend L/R, show price, lock, custom color) plus a gear popover for fib levels, text/font size, risk/reward, arrow caps, and stats toggles. Last-used extras persist per kind in `drawingPrefs.byKind`. Paint honors extend flags, custom fib ratios (including reverse), highlighter width, long/short RR, and double-click text re-edit.

### Tests

- **Tool settings catalog** — `tests/tool-settings.test.ts`: every drawing kind has controls; ray/highlighter/long defaults; fib + RR helpers; normalize keeps `meta.fibLevels`.
- **Store `byKind` merge** — `setDrawingPrefs` deep-merges per tool without wiping siblings.

---

## [2.2.0] — 2026-09-04

### Added

- **Results → Raw JSON tree**: collapsible VOID-colored viewer (keys / strings / numbers / bools) with key filter, Expand / Collapse, and Tree | Source. Large `plots` / `series` arrays page in (32 at a time) so a full run does not mount thousands of nodes. Click a primitive to copy it. Footer Copy / JSON still export the full payload.

### Changed

- **Studio fullscreen canvas**: Runtime, Wire, Settings, Workers, and Plugins (plus nested tabs) now use the full overlay width instead of a reading-column cap. Wide layouts are two columns — Runtime (engine | endpoint), Settings General / Data / Topbar / Editor / Theme token grids, Workers inventory | inspector, Plugins catalog cards, Results strategy table. Legacy `sc-settings-*` chrome on Editor intelligence, exchange keys, and stacked plugin fields is replaced with studio `ax-*` primitives.
- **Theme color field**: Settings → Theme uses one `StudioColorInput` per token (swatch picker + text). Accepts hex, `rgb()` / `rgba()`, CSS names, and Pine `color.*` enums; the picker rewrites in the same form.
- **Editor color chips**: clicking an inline script color chip opens a native picker and replaces the source in the original form (`#hex`, `color.red`, `color.rgb`, `color.new`), keeping transparency.
- **Studio scroll**: nested panes, tables, code blocks, and library lists no longer scroll on their own. Only the modal canvas (`.ax-page-canvas`) scrolls.
- **Studio primitives**: status pills stay compact (no longer stretch full-width inside cards); Idle/Skipped/Degraded get the same pill chrome as Healthy/Down; cards, stats, inline buttons, and feature rows tightened. Same language applied across Runtime, Wire, Settings (all tabs), Plugins (catalog / install / library), Workers, and Results: capability badges are `ax-cap`, catalog rows are entity lists, chips-as-tags stay small, and compact `sc-*` chrome hosted in the overlay is scaled up to studio density.
- **Results overlay**: true fullscreen studio shell (`.ax-page-backdrop` + `.ax-page`, no dialog padding/blur). Header holds auto-open / script picker / saved-runs chip; Copy / JSON / CSV sit in the sticky footer. Canvas is the only scroller. Stacks above other studio pages (`z-index: 1050`) so a finished strategy is not trapped under Wire or Workers. Events, Strategy, Optimise, Plots, Metrics, Raw, and Saved use the same `ax-*` primitives as the rest of studio.

### Fixed

- **Strategy Saved-runs loop**: live silent re-runs (every-tick / bar-close) were calling `setLastRun` without `persistence: 'skip'`, so local `saveResult` wrote a new IndexedDB row about once a second. Durable save is now user-initiated Run only; deferred / skipped / superseded payloads never persist. Fire-and-forget saves are serialized so FIFO trim cannot race.
- **E2E smoke vs Studio overlay**: topbar Architecture / Runtime / Settings / Plugins hooks are `hidden` (Playwright no longer treats `sr-only` 1×1 clips as clickable, which hung behind the fullscreen button). Smoke, critical, and library journeys open those pages through the visible Studio button + rail (`axis-studio-rail-*`).
- **Editor false typo on `syminfo.mintick`**: pre-eval “unknown built-in member” only knew `syminfo.prefix` / `syminfo.ticker` from `pyne-builtins.json` (the two callables). Host variables (`mintick`, `tickerid`, `timezone`, `currency`, …) are now allowlisted with the other Pine constants, matching pyne’s implemented `syminfo.*` surface.
- **Market proxy (Worker)**: MEXC public REST is served through `/api/market/mexc/{klines,ticker/24hr,exchangeInfo}` because `api.mexc.com` does not send `Access-Control-Allow-Origin`. `fetchMexcJson` tries the Worker first and the direct host only as last-ditch fallback (offline lab, `skipWorkerProxy` tests, or Worker 5xx / network). Worker 4xx (allowlist / not found) is thrown immediately so the browser does not pay a CORS-blocked extra hop. Shared `resolveMarketWorkerBase` lives in `src/data/market-worker.ts` (re-exported from `binance-http.ts` / `mexc-http.ts`). Call sites: `watchlist-tickers.ts`, `sources/catalog.ts` (`mexcRest.fetchHistorical`), `symbol-catalog.ts` (exchangeInfo). Interval allowlist is AXIS TFs plus venue `1M` (`1h`→`60m`, `1w`→`1W`; no `1s`/`3m`/`2h`/`6h`/`8h`/`12h`/`3d`). `ticker/24hr` allowlists optional `symbol=` (single object, cached per symbol); there is no `symbols=` batch — omit the query for the full book. Watchlist uses per-symbol requests when the list is small (≤8), else the full book. No signed MEXC path yet.

### Tests

- **Run-result persist** — `tests/run-results-persist.test.ts`: `persistence: 'skip'` and ephemeral meta do not write Saved runs; interactive Run writes once; three silent `liveTick` re-runs do not append.
- **Studio / Results e2e** — `e2e/studio.ts` opens rail pages without clicking hidden topbar hooks; critical Results close uses `axis-results-close` because the fullscreen overlay covers the topbar toggle.
- **Pre-eval `syminfo.*` host vars** — `tests/preevaluate.test.ts`: `syminfo.mintick` / `tickerid` / `timezone` / `currency` are known; `syminfo.minitck` still suggests `mintick`.
- **MEXC client fetch order** — `tests/mexc-http.test.ts`: Worker first, `skipWorkerProxy` goes direct, abort does not try the next host, Worker 400 does not call `api.mexc.com`, Worker 5xx still falls through. Watchlist small-list `symbol=` vs full-book path.
- **MEXC Worker ticker `symbol=` + `1M`** — `worker/tests/market-proxy.test.ts`: optional `symbol=` forwarded and cached separately from the full book; `symbols=` rejected; native `1M` klines accepted.
- **Color rewrite helpers** — `tests/pine-colors.test.ts`: `formatPickedChipColor` keeps kind/transparency; `rewriteColorKeepingFormat` preserves hex / rgb / rgba / named.
- **JSON tree helpers** — `tests/studio-json.test.ts`: kind / preview / stats, expand-all skips huge arrays, filter does not walk 200-point plot series.

---

## [2.1.1] — 2026-08-29

### Fixed

- **CORS product-host list**: retired the legacy `*.pynescript.ai` branch from `PRODUCT_ORIGIN_RE` (worker `pickOrigin`) — production URL is `pynescript.online`, not `.ai`. The fallback default in `env.ALLOWED_ORIGIN` (and the inline fallback when none is configured) now also points at `https://pynescript.online`. Legacy `.ai` requests fall through to the allowlist fallback instead of being echoed. `isOAuthProxyBase` (git-oauth client proxy allowlist) drops the `.ai` check for symmetry. Docs (README, `docs/devops/cors-and-origins.mdx`, `docs/worker/bindings.mdx`, `docs/architecture/evaluation.mdx`, `docs/llm.txt`) updated.

### Tests

- **CORS regression**: `worker/tests/cors-origin.test.ts` adds a `does NOT echo the retired pynescript.ai product host` case that confirms `https://pynescript.ai` and `https://app.pynescript.ai` requests fall back to the configured `ALLOWED_ORIGIN` first entry (i.e. they're no longer auto-allowed as product hosts).

---

## [2.1.0] — 2026-08-29

### Added

- **Local storage: persisted run results**: `localStoragePlugin` now implements the optional `saveResult` / `loadResult` / `listResults` / `removeResult` methods so completed strategy/indicator runs can survive reloads. IndexedDB schema bumped from v1 → v2 — additive migration only, with a new `results` object store keyed by compound `[scriptId, runId]` and a `byScript` index on `meta.scriptId` for cheap per-script listing. FIFO trim keeps at most `MAX_RESULTS_PER_SCRIPT = 50` runs per script (oldest by `meta.startedAt` evicted; the just-saved run is always preserved). A `LOCAL_STORAGE_VERSION = 2` constant is exported for downstream schema detection, and the plugin now advertises `capabilities.results = true` so UI can render saved-runs affordances. localStorage JSON + in-memory `Map` fallbacks mirror the same semantics for SSR/tests (`pynescript.axis.results.v1` key + `_getMemResultsForTests` helper). Plugin contract extended in `src/plugins/types.ts` with a `results?: boolean` capability flag.
- **Storage change confirmation dialog**: new `StorageChangePrompt` (`src/ui/StorageChangePrompt.tsx`) is mounted once at the app root and hosts the existing `StorageChangeDialog` whenever the user switches storage engines. A new `promptStorageChange(oldId, newId)` helper in `src/storage/service.ts` is the single entry point — short-circuits silently when the engine is unchanged or unset (first-time set), and otherwise opens the dialog so the user can pick *Migrate scripts* or *Start fresh* before the active plugin flips. The migration itself still runs through the existing dialog (it calls `getStorage(fromId)` / `getStorage(toId)` directly so the active plugin stays pinned to the source until commit). All four storage-change call sites now route through it — `ScriptLibraryPanel` dropdown, `SettingsDialog` general tab Save, `PluginsPage` catalog activate, `PluginManager` modal activate — so there is exactly one shared dialog state, not four duplicated ones.
- **Per-panel icon in FloatableShell header**: `FloatableShell` now renders the panel-specific glyph next to the hamburger menu (testid `axis-panel-header-icon-{panelId}`), matching the Topbar panel toggle. Single source of truth is `PANEL_ICON: Record<PanelId, IconName>` in `src/ui/icon-map.ts`; TypeScript exhaustiveness guarantees every `PanelId` has an entry. Missing mappings fall back to the hamburger-only chrome without breaking the panel.

### Fixed

- **Status bar chip 1px hover wobble**: `ConnectionHud` chips (`ChipShell`, `TickPulse`, `LiveBadge`) no longer shift pixels on hover/active. Locked border-width to `border-[1px]` (Tailwind v4 `border` no longer relies on theme indirection), added `transition-none` to prevent any color flicker, and pre-applied the `ring-1` outline on `LiveBadge` so only the ring color animates between `ring-transparent` and `ring-accent` (no box-shadow structure delta). `.sc-btn-ghost` gained an explicit `box-sizing: border-box` (defensive — Tailwind v4 preflight already sets it on `*`).
- **Duplicate "Open in new tab" in editor dock menu**: the editor panel's dock menu showed both the generic DOCK_MENU "New tab" entry and an editor-specific "Open in new tab" entry passed via `menuExtra`. The `menuExtra` is now `undefined` (per the `FloatableShell` JSX usage in `EditorPane`), so the dock menu shows the generic "New tab" entry exactly once. The editor's own "Open in new tab" affordance lives only in the right-side `EditorOverflowMenu` (testid `axis-editor-btn-new-tab-overflow`), where it pops the editor out into a full browser tab instead of a docked window.

### Tests

- **Storage result round-trip + FIFO + fallback** — `tests/storage-local-results.test.ts` covers the new IndexedDB v2 `results` object store: add / load / list / remove, FIFO trim at `MAX_RESULTS_PER_SCRIPT = 50`, the `byScript` index, SSR fallback (`pynescript.axis.results.v1` + `_getMemResultsForTests`), and additive schema migration from v1.
- **Service façade + plugin opt-in** — `tests/storage-service-results.test.ts` exercises `saveRunResult` / `loadRunResult` / `listRunResults` / `removeRunResult` / `supportsRunResults` through the active plugin, including the local-only fallback when the active engine (git / cloud) doesn't implement the optional result methods.
- **Storage change prompt** — `tests/storage-change-prompt.test.ts` asserts the dialog is mounted exactly once at the app root, opens on engine change, and short-circuits silently when the engine is unchanged.
- **Editor menu dedupe** — `tests/editor-menu.test.ts` locks the regression: `EditorPane` no longer passes a `menuExtra` with a "New tab" entry, the dock menu still contains exactly one "New tab", and `EditorOverflowMenu` still owns the overflow "Open in new tab".
- **Panel header icon routing** — `tests/panel-icon.test.ts` verifies `PANEL_ICON` covers every `PanelId`, each value is a valid `IconName`, and `FloatableShell` reads `PANEL_ICON[props.id]` and emits the `axis-panel-header-icon-{panelId}` testid.

---

## [2.0.31] — 2026-08-28

### Changed

- **About modal**: removed ethos manifesto list and author section; added AXIS + PYNE version badges and brief no-walled-garden philosophy.
- **Studio consistency**: `ThemePanel` (Settings → Theme) now uses the studio `ax-*` primitives (`StudioSection`, `StudioField`, `StudioInput`, `StudioToggle`, `StudioChip`, `StudioButton`, `StudioHint`) instead of legacy `sc-settings-*` classes, matching Runtime / Wire / Workers / Plugins. Studio `--ax-*` tokens promoted to `:root` so shared panels render correctly outside the modal.
- **Theme color input**: each token uses a single color input (mono text field + non-interactive preview swatch) instead of a paired swatch picker and text box; number tokens use one number input.
- **Studio modal radius**: added a scoped `--radius-surface` token (8px inside `.ax-page`, defaulting to 3px elsewhere). Studio modal surfaces — `.ax-card`, `.ax-btn`, rail nav items, color preview, equity tooltip, HPO chart wrap, results auto-open toggle, and the Results error box — now use the higher radius. Chart/panel `<input>`/`<select>` and small chips/badges keep their existing 2–3px radius for hierarchy.

### Added

- **Results fullscreen studio modal**: replaced the docked Results panel (`FloatableShell`) with a focused fullscreen studio overlay (`ResultsModal`) opened via `store.resultsPanel.open`. Six restyled subpages — Events, Strategy, Optimise, Plots, Metrics, Raw — share one studio canvas (`ax-page` / `ax-*`) with `StudioStat`, `StudioTabs`, and `ax-list`/`ax-card` primitives. `StrategyReport` and `HpoPanel` rebuilt on studio classes (stat cards, equity card, ax-field controls, ax-list search space). Results auto-open only for `strategy()` scripts (indicators no longer auto-open).
- **Results auto-open setting**: new persisted `resultsAutoOpen` flag (default `true`) gates the strategy-only auto-open in the runner. A visible toggle sits at the top of the Results modal header ("Auto-open on strategies"); the same control is exposed in Settings → General ("Auto-open results on strategies"). Persisted via localStorage and hydrated on boot.
- **Strategy equity graph**: replaced the flat SVG line with a rich `EquityChart` — gradient area fill, zero baseline, gridlines with money-axis labels, underwater drawdown shading, and a hover crosshair + tooltip showing time, equity, and drawdown.
- **Results subpage polish**: Events list now shows colored type badges and long/short direction pills; Plots shows a sparkline card per series (positive/negative color); Optimise shows an in-sample / out-of-sample trial score chart with legend; Metrics shows a status pill plus derived stats (profit factor, max DD, plot points, script type).
- **Results full-width + 2-column subpages**: the Results modal canvas now uses the full studio width (`ax-page-canvas--wide`, no reading-column cap). Optimise uses a two-column split — search configuration + search space on the left, live study chart + trials table on the right. Strategy uses a two-column split — stats + equity curve on the left, closed-trades table on the right (stacks to one column under 64rem).
- **Topbar settings**: new 'Topbar' tab in Settings with toggles for each topbar group (brand, market, data, compute, layout, panels, system) and individual panel buttons (watchlist, editor, library, scripts, inputs, layers, DSM, on-chain, alerts, values, results, script logs, system logs, status). Settings are persisted via localStorage.
- **HPO (Optimise) polish**: the search config (trials, sampler, objective, validation, holdout/walk-forward sizes, min trades, and per-param bounds) now persists across reloads; the trial chart pins its x-axis to the trial index (IS/OOS lines no longer desync when trials error), marks the best trial, and shows the score scale; the results header gained a status chip, best IS/OOS scores, and a Clear button; categorical params show their choices and the search-space list has an empty state.
- **HPO tier gating**: added a persisted `tier` (`free` / `pro` / `self-hosted`) — the free tier disables walk-forward validation (shown as "(Pro)") with an upgrade hint, while Pro / Self-hosted show a tier badge and unlock it. The engine-runs cap was raised from 400 → 1000 so walk-forward fits within the trial ceiling.

### Fixed

- **Workers probe non-blocking**: initial backend probe deferred past first paint (double `requestAnimationFrame`) and a non-blocking "Probing backends…" hint shows while the first snapshot loads — the Workers panel is ready and interactive immediately, regardless of slow/failed probes.
- **Indicator engine correctness**: styled Pine plots (`histogram` / `area` / `columns` / `stepline` / `baseline` / `line` / `cross` / `circles`) were silently dropped because `splitSeriesByKind` only accepted `plot`/`hline` kinds — they now route to line plots (missing-kind and unknown-kind both default to line). Engine `status: 'success'` is no longer downgraded to error by a stray non-fatal `error`/`message` string. Series↔time-axis alignment is now derived from the exact bars the engine evaluated (passed through `getOhlcvTimesForApply`), fixing misaligned/blank newest bars on live ticks and HPO holdout slices. Explicit `overlay=true` is no longer auto-demoted to a sub-pane by the oscillator-scale heuristic. The `getOhlcvTimesForApply` cache is reused for the common `store.bars` case (the bypass path only applies to a genuinely different axis) and invalidates on a `store.bars` reference change.
- **Results panel dock cleanup**: removed the dead `results` panel from the dock registry (`PanelId`, `PANEL_META`, `PANEL_IDS`, `DOCK_STACK_ORDER`) so the bottom dock no longer reserves ~220px of empty space — Results is now a fullscreen modal driven solely by `resultsPanel.open`.
- **Input override no-op on chart**: changing a script input (e.g. RSI length 14→56) now repaints the whole series. `PaneManager.syncOverlayLines`/`syncOverlayOhlc`/`syncBgcolorBands` gained a `forceFull` owner option; `runAndApplyInner` passes `forceFull: opts.liveTick !== true` so interactive runs / input recomputes bypass the tip-only smart-apply (which only patched the last bar when length + last time were unchanged). Live ticks keep the fast path via `liveTick: true` in the multiplex re-run loop.
- **Wire page**: removed separate scrolling sections; now uses single-scroll ax-page-canvas pattern matching Runtime, Settings, Workers, and Plugins.
- **Settings polish**: consolidated duplicate `sc-settings-*` CSS into single definitions, added `sc-settings-section--plain` and `sc-settings-content--compact` variants to replace `!important` overrides, added `color-mix` fallback, `focus-visible` on color swatches, and `prefers-reduced-motion` guard; replaced `!mt-0 !border-t-0 !pt-0` with semantic variant and fixed ThemePanel compact gap override.
- **Workers probe**: fixed `requestAnimationFrame` leak — now cancels on unmount and removes dead `hasLoaded` signal; probe defers to next frame without blocking studio paint.
- **Vendor**: removed obsolete `pynescript-0.4.0/0.4.1` wheels (replaced by `hoox_pyne-0.4.2`).

## [2.0.30] — 2026-08-26

### Fixed

- **plot display= in compile mode**: `plot(..., display=display.data_window)` was not carried in `plot_meta` because the compiler didn't fold Pine `display.*` constants. Both axes now resolve `display.data_window`/`display.pane`/etc. to bitfield integers and pass them through to `plot_meta`.
- **Pyne wheel** — vendor `pynescript-0.4.2` (was 0.4.1). Compiler display folding + server compile-path backfill.

## [2.0.29] — 2026-08-26

### Changed

- **Engine default mode** — both Pro and Pyodide engines now default to `auto` (try compile, fall back to interpret) instead of `interpret`.

### Fixed

- **hline linestyle in compile mode**: server-side compile path did not include `linestyle`/`color`/`price` in `plot_meta` because `plot_attrs` is empty for hline/fill. Backfill from `__drawings` now fills missing visual attrs.
- **Pyne wheel** — vendor `pynescript-0.4.1` (was 0.4.0). Server compile-path backfill fix.

## [2.0.28] — 2026-08-26

### Fixed

- **hline linestyle in interpret mode**: the interpret path (Pyodide default) did not synthesize `plot_meta` from `__drawings`, so LWC price lines for `hline()` always rendered solid regardless of `linestyle=`. Both interpret and compile paths now synthesize `plot_meta` with kind/linestyle/color/price for hline, fill, and plotshape drawing types.

## [2.0.27] — 2026-08-26

### Changed

- **Pyodide PYNE wheel** — vendor `pynescript-0.4.0` (was 0.3.7). Engine catalog, legacy JS engine, SW cache test, and editor builtins synced from pyne 0.4.0.

### Fixed

- **hline linestyle**: `hline(linestyle=hline.style_dashed)` rendered solid — the drawing path only checked `r.style` (never `r.linestyle`), and the compile-mode overlay path lacked `plot_meta` entirely so the LWC price-line never received the style. Both paths now covered: `pyne-drawings.ts` falls back to `r.linestyle`, and both Pyodide runtimes synthesize `plot_meta` from `__drawings` (hline/fill/plotshape kinds with linestyle, color, price).
- **multi-chart**: same indicator on every grid cell showed identical values — the runner evaluates Pine against `store.bars` (active plane), but focusing another slot never swapped in that slot's cached history, so every Run/add computed from whichever chart was loaded last. `setActiveChartSlot` now restores the focused slot's own bars (+ gen bump), stops stale bar replay, restarts live for the slot's market, and silently re-runs applied scripts so each chart shows its own values.
- **multi-chart**: switching to a 2×2 grid could overwrite the active chart with a sibling's symbol — ChartHost "prefetched" inactive slots via `loadSymbolData`, which always writes the active plane (last-mounted sibling won). Removed; empty cells load on focus instead.
- **tables**: render Pine `table.cell` `text_valign` (top/middle/bottom) and `text_size` tokens/numeric points in the table HUD — parsed previously but rendered fixed 10px/middle; defaults unchanged when absent.
- **bgcolor**: carry band titles into `syncBgcolorBands` and apply them as series titles on create/update, matching the offline `buildPlotVisuals` path.

## [2.0.26] — 2026-08-24

### Added

- **Pages security headers** — `public/_headers` ships the nginx/server.ts hardening baseline to Cloudflare Pages deploys (CSP with self scripts + `wasm-unsafe-eval` for Pyodide, https/wss connect, plus nosniff / referrer / frame-deny), so axis.hoox.sh gets enforced headers instead of only Page Shield's Report-Only placeholder.
- **Native MEXC CEX** — `mexc-rest` / `mexc-ws` as a built-in venue (public spot klines, no CCXT). Venue picker lists MEXC with Binance/OKX/Bybit; signed REST uses `X-MEXC-APIKEY`. MEXC was removed from the pinned CCXT shortlist.

### Fixed

- **`hline()` levels vanished once `bgcolor()` rendered** — `priceLineHost` picked the first non-overlay series, which after the bgcolor fix could be a `bgcolor_*` histogram living on its own hidden 0–1 price scale; hlines attached there mapped far off-viewport. Host selection now skips bgcolor underlays (TradingView paints backgrounds *behind* panes — they never host price lines).
- **`bgcolor()` / `barcolor()` drew nothing** — response normalization coerced every series sample through `Number()`, turning engine color arrays (`rgba(8, 153, 129, 0.298)` per bar) into all-`null`, so the histogram bands were filtered out before reaching the chart. CSS color samples now pass through normalization untouched (`coerceSeriesSample`); value plots still coerce as before.
- **Workers status chips stayed “Unknown”** — `StudioStatus` closed over the first `props.status` (`unknown` while probes ran). The CSS class updated (green/red dot) but the word did not. Label is now read from props on each render.

### Changed

- **Topbar Studio** — one **Studio** button replaces Wire, Runtime, and Settings. Those pages stay in the studio rail (and ⌘K). The button reopens the last studio page.

- **Wire recipe grid** — the hatch is a behind-layer at lower opacity. The right-edge fade no longer masks preset names.

- **PYNE Pro API origin is `https://pynescript.online`** — Hetzner VPS (nginx → gunicorn `:5002`). `axis.hoox.sh` is the Cloudflare Pages PWA, not same-origin with the API. Default Backend URL, Workers Manager probe, datafeed gateway, and Settings/Runtime presets follow the new origin; saved `axis.hoox.sh` / old VPS IP endpoints remap on load.

## [2.0.25] — 2026-08-23

### Fixed

- **Script Settings inputs no longer lose to editor defaults** — re-running an applied script from the editor keeps per-instance `inputValues` / strategy properties. Empty `{}` bags no longer wipe saved settings. Overrides persist only when they differ from the script default and are keyed by title, id, and LHS var name so the engine actually applies them.

### Changed

- **npm publish uses org secret `NPM_TOKEN_HOOXSH`** — `release.yml` no longer looks for a repo `NPM_TOKEN`. Root Bun tests ignore `packages/**` so `axis-cli` suites run only after `packages/cli` deps are installed. Authenticated skip detection treats an already-published version as success.

## [2.0.24] — 2026-08-23

### Added

- **Production-grade `@hoox-sh/axis-cli` 0.2.0** — first npm publish of the AXIS CLI. Node-compatible `dist/` + `npm i -g @hoox-sh/axis-cli`, AGPL `LICENSE` in the tarball, provenance on tag publish, CI coverage for `packages/cli`.

### Fixed

- **`plot(..., display=)` was ignored at apply time** — editor already knew `display.data_window` / `none` / `pane` / `price_scale` / `status_line` / `all`, but every series still painted on the pane and in the Data Window. AXIS now reads `plot_meta.display` (token or Pine bitfield): `none` hides everywhere, `data_window` keeps Data Window and skips the chart, `price_scale` / `status_line` gate last-value labels. PYNE packs `display=` on plot/hline/shape/fill/bgcolor.

- **E2E smoke vs studio pages** — Plugins is opened from the Runtime rail (topbar hook is sr-only). Wire Apply waits for an exact `Wire · Offline Lab` title so a drifted `Offline Lab +N` plan is not applied as Live Crypto.

- **`axis setup --remote-d1` skipped local D1** — `setup d1` treated `--remote` as exclusive of local even when `local: true` was passed, so bootstrap never applied the schema locally. `--remote` alone stays remote-only; `--local --remote` and `--remote-d1` apply both.

- **Worker `/health` probe accepted any HTTP 2xx** — `probeHealth` OR'd the JSON `status === "healthy"` check with `res.ok`, so a 200 HTML page counted as healthy. Requires a JSON `status` of `healthy` or `ok`.

- **Failed `axis deploy worker` ran wrangler deploy twice** — on inherit/quiet failure the CLI re-invoked deploy to capture stderr. Capture once, parse the workers.dev URL, never redeploy on error.

- **`--json` mixed human banners into stdout** — `--json` now implies `--quiet` so doctor/health/deploy emit parseable JSON only.

- **Docker GHCR version tags could skip on `v*`** — `docker.yml` path-filtered `push`, and GitHub applies that filter to tag pushes. Tag/main image builds no longer use a path filter (PRs still do).

- **Unknown `axis` commands dumped a generic wrapper error** — Commander help/version/unknown-command now exit with Commander's own code instead of `handleError`.

### Changed

- **npm release workflow** — pin Bun 1.3.14, `id-token: write` + `npm publish --provenance`, pack dry-run (LICENSE/dist/bin required), org secret `NPM_TOKEN_HOOXSH`. CI unit job now typechecks and tests `packages/cli`. Dead `@clack/prompts` dependency removed.

## [2.0.23] — 2026-08-23

### Changed

- **Drawings / plot parity plan** — `docs/architecture/drawings-parity.mdx` lists P0–P3 work: user-tool move/handles, Pine pane routing, PYNE export gaps (tables, fill meta, plotshape Y, OHLC).

### Fixed

- **Pre-eval treated `chart.fg_color` as a typo** — `pyne-builtins.json` only lists `chart.point.*` callables, so `chart.bg_color` / `chart.fg_color` (and the `color_background` / `color_foreground` aliases, plus viewport `left_visible_bar_time` / `right_visible_bar_time` / `is_standard`) were flagged “not a built-in member”. Allowlisted with the other Pine host constants.

- **1-point drawings did not body-move** — `shiftDrawing` only special-cased `text` / `priceLabel`. Note, flag, crossline, anchored text, and arrow marks now shift `p1` (and `points[]` when present). Third-anchor `p3` handles hit-test and resize.

- **Linefill GC was a no-op** — `garbageCollectScriptDrawings` ignored `skip.linefill` on the early-return. Overflowing linefill-only batches now trim oldest. Polyline/linefill copy `force_overlay`; polyline `fill_color` maps to fill.

- **`overlay=false` bgcolor/fill always hit the price pane** — bgcolor bands take `paneId`; fills use the script-pane drawing layer when the indicator is not overlay. Empty `drawings: []` clears script SVG even on silent live re-runs.

- **plotshape on oscillator panes** — `setShapeMarkers` takes a pane id; overlay=false scripts attach LWC markers to the first overlay series on `ind_*` instead of price candles. Trade markers stay on price.

- **Drawing tool settings** — Fill slider covers channel, triangle, gann boxes, ranges, highlighter; highlighter stroke no longer multiplies width ×6; horizontal ray places on one click; XABCD / head-and-shoulders commit on the 5th point.

- **Hide drawings hid only user tools** — the eye toggle now also clears Pine script SVG and `fill()` bands (every pane layer). `label.style_text_outline` paints outlined text; `yloc.abovebar` / `belowbar` sit 8px off the wick. First Add Indicator re-owns plotshape / fills / script drawings from `__editor__` to the script id. Histogram overlays honor `plot_meta.histbase` when the engine sends it.

## [2.0.22] — 2026-08-23

### Added

- **Topbar Venue picker** — Data group is now Venue (native CEX / pinned CCXT / CCXT… / local) instead of a raw source-plugin list. Picking Bitget (CCXT) writes `ccxt-rest`+`ccxt-ws` and both `exchange` bags together; `store.provider.id` is `ccxt:bitget`. Exchange ID stays on the topbar only for **CCXT…**. Stream remains hidden while paired.

- **CCXT symbol browse uses that exchange's markets** — with Source = CCXT (Gateway), the symbol modal loads `GET /markets?exchange=` and keeps unified `BTC/USDT` tickers (slash is no longer stripped). Stream is hidden on the topbar while it still matches the source pairing (Wire / HUD Fix if it drifts).

- **CCXT session API keys** — Settings → Data can store a key + secret (+ passphrase / uid) per CCXT exchange id (`ccxt:bybit`, …) in the RAM vault (never `pluginsConfig` / localStorage). Save POSTs `POST /datafeed/session`; Load/Live then pass only `cred=` on OHLCV/watch. Public candles still work without a key. Topbar shows an **API key** chip next to the CCXT exchange picker. Gateway `auto|pyne|sidecar` moved to Settings (advanced). Sidecar accepts `/ohlcv` and `/datafeed/ohlcv`. PYNE `POST /datafeed/session` accepts `apiKey`/`secret`/`password` in the JSON body.

- **npm release pipeline for the AXIS CLI** — `@hoox-sh/axis-cli` (`packages/cli`) is now publishable: dropped `"private"`, and a new `.github/workflows/release.yml` typechecks, tests, builds and publishes the package to npm on `v*` tags using an `NPM_TOKEN` repository secret. A registry-version guard skips cleanly when the version is already published (safe tag re-runs); run summary reports local vs registry versions.

- **"What's in this repo" section in README** — table mapping every part of the repo to its role and paths: app/PWA, datafeed pipeline, calc engines + Workers Manager, vendored Pyodide runtime, on-chain plane, Cloudflare Worker (API/WS/D1/KV/R2), allowlisted `/api/onchain` proxy, Tauri desktop shell, npm-published CLI, tests/ops.

- **Plugin config `advanced` fields + Settings section** — schema fields can now be marked `advanced` (API base URL, Bars, Synthesize on failure, …). They are hidden from the Topbar config row and rendered in Settings → "Source & stream plugins" with full descriptions, using the shared form classes.

- **Full unified ccxt exchange dropdown** — the Exchange ID select is fed by the gateway's complete ccxt exchange list (`/health` → new `ccxt_exchanges`, mirrors `ccxt.exchanges`; ~103 venues) instead of only the native adapters. PYNE side: `backend/api/datafeed.py` health payload extended accordingly.

### Changed

- **Studio full-page overlay** — Runtime, Wire, and Settings are no longer right-edge drawers. They share one full-viewport page (`src/ui/studio/`, `ax-*` classes) with a left rail, 16px type root, and large fields. Compact `sc-dialog` stays for Symbol / Script Settings / About / ⌘K.

- **Runtime uncoupled from Workers and Plugins** — Topbar **Runtime** is the active engine / endpoint / exec mode / health. Workers (backend inventory) and Plugins (contract catalog) are sibling pages from the rail, ⌘K, or Runtime cards — not tabs inside Runtime. Engine/endpoint/mode moved out of Settings → General; storage stays a Wire slot.

- **Workers studio restyle** — Backend inventory is a full `ax-*` studio page (`WorkersPage`): large health cards + inspector (probe features, numbered install steps, Use as calculation backend). No inner Overview/Detail/Install/Configure tabs and no `sc-btn` chrome. Engine writes go through `saveEngineConfig`. Open Plugins is a sibling cross-link, not a nested catalog.

- **Plugins studio restyle** — Contract catalog is a full `ax-*` studio page (`PluginsPage`), sibling of Runtime. Catalog / Install / Script Library stay as `StudioTabs` (e2e tab name **Catalog**). Kind chips, large rows with Use + capability badges, URL install + example cards, Script Library embed, active src/eng/stm/stor footer + Done. Open Workers and Open Wire are sibling cross-links. Close stays on the AppPage shell (`axis-plugins-close`); `axis-manager` stays on the dialog only.

- **Data tab no longer duplicates bar count or Binance API host** — how many bars to load lives only under General → Historical bars. Native CEX host URLs stay as fetch defaults (Binance already has host + Worker fallback). Gecko proxy/network, CCXT gateway, and synthesize-on-failure remain.

- **Docker release images tagged by version, not sha** — `docker-bake.hcl` release targets now push `pwa-v<VERSION>` / `pwa-nginx-v<VERSION>` (e.g. `ghcr.io/hoox-sh/axis:pwa-v2.0.21`) instead of `pwa-sha-<sha>`. The git SHA remains on the image as the `org.opencontainers.image.revision` label and build arg; workflow docs updated to match.

### Fixed

- **Plugin config row — first-save, apply, and exchange dropdown** — shared source/stream fields now (1) resolve a stored value from *any* target bag before falling back to a schema default (stream `exchange` is no longer hidden by a source default of `''`), (2) persist text/number keystrokes but only reload history on blur/Enter (selects/checkboxes still apply immediately), (3) treat the exchange control as a `<select>` only when the gateway list is actually populated, with a placeholder `Select exchange…` option and a free-text fallback when the fetch fails or returns empty, (4) cache the ccxt list per gateway mode, and (5) wire stacked-form `label for` to the control `id`. Gecko `baseUrl`/`network`, Coinbase granularity, and Mock Walk start price are Settings-only (`advanced`). Topbar Load no longer bails out while a previous fetch is in flight.

- **Pre-eval scanners close paired typographic quotes** — `“…”` / `‘…’` now close on the matching right quote (not only the same code point), so a pasted title string no longer marks the rest of the file as an unclosed string and block Run. Shared `isQuoteClose` in `pine-scan-util.ts`.

- **`array<string>` survived as `array` after Add types** — the declaration rewriter captured the collection token but dropped `<string>` when inserting a missing type1 qualifier. Generic args are preserved (`simple array<string> vals = …`).

- **Type methods and `export enum` missed as user bindings** — indented `method profit(this) =>` inside a `type` body and `export enum Name` now register as declared names (same as `export type`).

- **`const` (and line-leading keywords) colored inconsistently — green vs violet** — a float ending in a trailing dot (`2.`, `0.`) was split into number + lone `.`, leaving the tokenizer's `afterDot` state set at end-of-line. The state leaked across comments/blank lines, so the *next* code line's first word (`const`, `series`, …) rendered as a member property (green) instead of a keyword (violet accent). Number scanning now consumes trailing-dot floats and `afterDot` resets at every line start.

- **Pre-eval typo checker round 3 — validated against the real 2222-line grid strategy** — found via local reproduction on `grid.pine`: generic typed declarations (`var series array<string> TP1 = …`) were not parsed by the assignment regex, so TP1/SL1/TRL1-class vars were never registered as declared; library import coordinates (`import cryptolinx/String/1 as strx`) leaked into both the declaration collector and ident scanner (`String`/`Hoox` flags); and dotted method calls (`.init()`, `.show()`, `.abs()`) were treated as bare-call typos. All three fixed; checker now reports **0** typos on grid.pine, grid.2.pine.

- **Pre-eval typo checker round 2 — declaration coverage + copy-paste resilience** — remaining false positives addressed: `strategy(linktoseries=…)` whitelisted (pyne accepts arbitrary declaration kwargs); typographic/curly quotes (`“”‘’`) now treated as string delimiters in every scanner so pasted text no longer leaks as identifiers; `enum` members + enum/type names, `type` fields, and `for [i, v] in …` loop vars are collected as declared bindings; dotted-path roots (`Mode.SINGLE`) skipped by the ident scanner.

- **Pre-eval typo checker flooded false positives (~260 per script)** — pyne's LSP metadata only lists functions/namespaces, so the pre-eval linter treated core built-in series variables (`close`, `high`, `low`, `open`, `volume`, `ohlc4`, `hl2`…), type qualifiers (`simple`/`series`/`const`) and `text.align_*` / `text.wrap_*` constants as unknown identifiers and suggested nonsense ("Unknown `close` — did you mean `CROSS`?"). Added a curated `PINE_BUILTIN_VARS` supplement (OHLCV + derived, time/bar state, calendar parts) plus the missing `text.*` members to the known-path index; qualifiers also join the bare-call skip set. Regression tests cover the reported failure pattern (now zero typos).

- **Config row crash on first save** — `setField` wrote `pluginsConfig` through a deep Solid store path whose parent bag did not exist yet; solid-js/store does not auto-create intermediate nodes, so the first-ever config change threw `TypeError: can't access property "exchange"` and never persisted. Bag creation is now guarded (`writePluginField`), covered by regression tests and a browser e2e run.

- **Gateway select had no choices** — the ccxt `gateway` schema fields lacked `options`, so the dropdown rendered only its current value. `auto | pyne | sidecar` are now declared on both `ccxt-rest` and `ccxt-ws`.

- **Config row deduplication** — the Topbar renders one shared row for the union of active source/stream config fields (was: duplicated per picker); changes write through to all declaring plugins so ccxt-rest and ccxt-ws stay in sync.

- **Gateway loopback on remote pages (hardened VPS)** — `gatewayBase` resolved `pyne`/`auto` to `http://127.0.0.1:5002/datafeed` even when the page was served from a remote host, so browsers on `axis.hoox.sh` fired doomed cross-origin requests at the *visitor's* machine (CORS NetworkError). Remote pages now resolve to same-origin `/datafeed` on product hosts (nginx) or the product API origin cross-origin (Pages previews); loopback behavior is unchanged for local dev. Explicit endpoint overrides still win.

- **ccxt-ws `require()` actually removed** — v2.0.21 added the static `gatewayWs` import but left the shadowing CommonJS `require('../data/gateway')` call in place, so the browser bundle still threw on stream start. The `require` is now gone.

### Changed

- **Plugin config moved to Settings → Data** — the "Source & stream plugins" section (with the advanced fields) now lives in the Data tab above Exchange API keys, with a note that CCXT Gateway venues serve public market data and need no keys. Native-source keys (Binance/OKX/Bybit/Coinbase/Kraken) remain session-only in the browser vault and sign requests client-side.

- **Config row styled like the Source picker** — inline plugin config fields now render through `TopbarField` (integrated uppercase label, shared `axis-tb-field` chrome, focus-within ring), matching Symbol/Source/Interval exactly; the Settings variant keeps the dialog's stacked form classes.

- **Stream config pass-through** — `multiplex.startLive` now passes `store.pluginsConfig[stream:<id>]` into `stream.start({ config })`, matching the source path, so ccxt-ws receives the configured exchange id.

- **ccxt plugins: clear error for unconfigured exchange** — `ccxt-rest` / `ccxt-ws` no longer fire requests with an empty `exchange=` param; they surface "exchange id not configured" instead.

## [2.0.21] — 2026-08-21

### Fixed

- **ccxt-ws stream: `require()` in browser ESM** — replaced CommonJS `require('../data/gateway')` with a static import. The `require` call threw `ReferenceError` in the Vite browser bundle when activating the `ccxt-ws` stream (Bun tests masked it since Bun honors `require` in ESM).

- **ccxt-rest backfill window inversion** — `endTime` was forwarded as CCXT `since`, which pages *forward* from that timestamp, breaking the Data Source Manager walk-back contract (bars must end at/before `endTime`). Now derives `since = endTime − limit·timeframe` so each page covers `[endTime − limit·tf, endTime]` and gap-fill converges.

## [2.0.20] — 2026-08-21

### Added

- **Datafeed gateway transport** (`src/data/gateway.ts`) — resolves gateway URL (auto/pyne/sidecar/direct), probes sidecar health with 30s TTL cache, and provides `gatewayFetch`/`gatewayWs` helpers for plugins that route through the PYNE datafeed gateway or local sidecar.

- **ccxt-rest source plugin** — long-tail exchange OHLCV via the PYNE datafeed gateway or sidecar. Routes `ccxt:<exchange>` venues through `GET /datafeed/ohlcv`. Credentials stay server-side; browser never holds API keys.

- **ccxt-ws stream plugin** — real-time klines via the datafeed gateway WebSocket. Routes through `WS /datafeed/watch` with exchange+symbol+timeframe params.

- **Gateway-aware active resolution** — when provider gateway is not `direct` and the venue is a `ccxt:<exchange>` long-tail id, active source resolves to `ccxt-rest` and stream to `ccxt-ws`. Native venues (binance, okx, etc.) are never swapped.

## [2.0.19] — 2026-08-20

### Fixed

- **Hex color lint false positive** — pre-eval `scanIdentRefs` no longer treats hex color tails (e.g. `d3ee` in `#22d3ee`) as unknown identifiers. Scans backward past hex digits to detect the `#` prefix and skips the entire literal.

- **Pre-existing TypeScript errors** — resolved 23 type errors across 7 files: null barIndex guard, CSS `TextAlign` narrowing, `PineTable` camelCase property reads via `Record<string, unknown>`, `linefill` missing from `DrawingLimits` / drawing caps/counts/skip, `cancelled` status narrowed type assertions, `ParamValue` import + explicit typing, legacy `panelWindows`/`dockLayout` access on `AppState`.

### Changed

- **CI typecheck gate** — added `bunx tsc --noEmit` as a first step in the CI workflow (runs before unit + security tests). Added `typecheck` script to `package.json`.

## [2.0.18] — 2026-08-20

### Added

- **Provider session** — chart aggregators inherit a locked venue identity (`store.provider`: source + stream + market + auth mode). Source changes re-pair the live stream; HUD shows venue and a **Fix** chip when stream mismatches. Data Source Manager follows the chart source unless "different source" is checked.
- **`kraken-rest`** — public Kraken OHLC source, paired with `kraken-ws`.
- **Exchange API keys** — Settings → **Data** stores key/secret/passphrase in a **session vault** (RAM only). Saving a key for the active venue sets `provider.authMode = authenticated`. Secrets never go to localStorage, `pluginsConfig`, or error-share dumps.
- **Signed Binance klines** — with a vault key, history uses HMAC REST then the Worker `GET /api/market/binance/signed/klines` (request-scoped `X-Exchange-Key` / `X-Exchange-Secret`, not a Worker vault). Public allowlisted proxy is unchanged.
- **Venue HMAC signers** — thin Binance / OKX / Bybit / Coinbase / Kraken signers in `src/data/venues/` (no CCXT).
- **Test key** — Settings → Data **Test key** button verifies saved credentials with a signed 1-bar kline fetch. Shows success, 401/403 rejection, or CORS/network warnings.
- **ADR-016** — provider-locked market data architecture decision record.
- **SessionDO multi-venue** — Worker Durable Object relay now supports all 5 venues (Binance, OKX, Bybit, Coinbase, Kraken) via `venue` query param. Each venue's WS URL and subscribe message handled correctly. Browser → DO control messages accept `venue` for resubscribe.
- **Shared venue WS builders** — `src/streams/ws-venues.ts` provides `buildVenueWs()` for both browser-side StreamPlugins and the Worker DO. Single source of truth for URL patterns and subscribe messages.
- **`@hoox-sh/axis-datafeed`** — optional Bun sidecar (`packages/datafeed/`) using CCXT Pro for users who want local WS without running Flask. Mirrors the PYNE datafeed gateway contract: `GET /datafeed/ohlcv`, `GET /datafeed/markets`, `WS /datafeed/watch`, `POST /datafeed/session`. Run with `bun run dev:datafeed`.

### Fixed

- **Mixed-provider quotes** — watchlist no longer falls back to Binance tickers for Kraken (or unknown venues).
- **Coinbase live bars** — stream uses Advanced Trade venue candles folded into the chart interval, not ticker buckets.
- **Binance synthetic fallback** — `fallback` defaults **off**, so a network error cannot look like real prices.

## [2.0.17] — 2026-08-19

Visible pre-eval squiggles, Problems that drop on edit, and idle lint for named args and declared vars.

### Added

- **Named-arg typos** — idle lint flags unknown function/method parameters (`plot(..., coltor=color.green)` → `color=`) from curated signatures, builtin docs, and user-function parameter lists.
- **User-var typos** — assignment / `var` / tuple-unpack / function-parameter names are added to the typo map (declaration is source of truth), so `length = 14` then `lenght` suggests `length`.

### Fixed

- **Lint underlines** — pre-eval / error marks use a high-precedence squiggle (SVG + wavy underline + inset line), not CodeMirror `baseTheme`, so they stay visible against Tailwind. Empty decoration sets rebuild when underlines are on. The tab-switch effect no longer loops and cancel the idle lint timer, which left the buffer with Problems but no squiggles.
- **Stale Problems** — pre-eval rows drop as soon as the buffer diverges from the last linted source. Idle lint no longer stamps the live buffer onto old diagnostics, and rescheduling the same buffer does not wipe a completed lint (fixing a typo no longer leaves the old error in the list).

## [2.0.16] — 2026-08-19

Restore editor hover, lint underlines, and chips after a dead Settings bag and clipped hover cards.

### Fixed

- **Editor intel dead bag** — an all-off persisted Settings bag (checkbox mount / store-proxy spread) no longer disables hover, lint underlines, completions, and chips. Hydrate recovers defaults; user patches write `rev`.
- **Hover cards clipped** — Pine hover tooltips set `clip: false` so overflow-hidden editor chrome no longer hides cards on the first lines.
- **Hover hide-on-apply** — decoration / selection transactions no longer dismiss hover cards; only document edits do.
- **Editor hover catalog** — bare `close` / `new` no longer steal `strategy.close` / `array.new`. Hover facts win; completions still walk modules.
- **`display.pane`** — real Pine v5+ member is allowlisted (no more typo → `display.none`). Invented `math.isnan` / `math.isfinite` completions removed.
- **Editor intel timeouts** — Hover / Completion timeout settings now reach `/lsp/*` (were hardcoded).
- **Intel number fields** — clamp on blur / spinner, not every keystroke, so `1500` is typeable.
- **Diagnostic hover** — respects Show errors / warnings / typos / info flags.
- **Pre-eval flags apply live** — toggling lint generation immediately re-runs or clears marks.
- **Hide + tables** — `table.*` HUDs follow visibility; drawings / fills / `barcolor` are owner-scoped so hide with a sibling no longer leaves the hidden script’s artifacts.
- **Hide exclusive pane** — empty oscillator strip is destroyed; show recreates it.
- **`*br` primitives** — `destroyPane` detaches line-break primitives; attach failure is not cached; segments are cached and culled to the visible range.
- **Last-bar drawings** — script paint no longer grows `rightOffset` up to 500 bars for wall-clock `timenow` (one-bar `bar_index+1` still maps).
- **PYNE Agent seed** — same-origin plugin install no longer writes a hardcoded Worker URL; chat stays off until the operator sets the endpoint.
- **Unstamped last-run marks** — engine underlines drop unless `meta.axisSource` (or `script`) still matches the buffer.

### Improved

- **Hover facts** — `hl2` / `ohlc4` / `hlcc4` use midpoint / OHLC / HLCC wording (only `hlc3` is typical price).
- **`plotshape` / `plotchar`** — curated params include `format`, `precision`, `force_overlay`; `series` is `int/bool`.
- **Docs** — `areabr` is only on the broken-segment row; debugging mermaid includes pre-eval → Problems.

## [2.0.15] — 2026-08-19

Editor intelligence settings, Supertrend `linebr` gaps, live script hide/run, and PYNE Agent chat markdown.

### Added

- **Editor intelligence settings** — Settings → **Editor** (and command *Open Editor Settings*) exposes every lint / pre-eval / hover-card / signature-hint / autocomplete / underline / gutter / inline-chip option, plus idle / tab-switch / remote timeouts. Defaults match the previous hardcoded behavior; **Reset defaults** restores them.
- **Strategy chart trade size** — entry/exit markers print `Long N` / `Short N` (and exit id + qty) so the filled amount is visible on the chart, not only the order id.
- **Hide plot names on last-value labels** — Settings and chart **[T]** clear `RSI` / `Overbought` titles beside the last value; the numeric label stays. Independent of **[N]**.

### Improved

- **Pre-eval timings** — idle lint stays **1s** after the last keystroke (configurable 200–3000 ms). Tab switch uses a separate **200 ms** beat (was a hardcoded 120 ms). Remote `/lsp/diagnostics` wait is **2s** (configurable) and only starts after idle; local marks still publish immediately. Stale “2s idle” editor comment removed.
- **PYNE Agent chat markdown** — replies render headings, lists, and **bold** instead of raw `###` / `1. **Foo**`. Plugin default API endpoint is empty (set in plugin config); no hardcoded Worker URL.
- **Editor hover + param checklist** — mouseover covers keywords, types/qualifiers, series (`close` / `bar_index`), namespaces (`ta.`), user inputs/functions, and hex colors. Call hints list type + default; current param is emphasized (no strikethrough on used). Hover cards use a void-theme header, parameter definition list, and inset example.
- **Pre-eval / Problems / debug chips** — idle lint is 1s; `study()` and bare `security()` warn; duplicate `indicator()`/`strategy()` warn; Problems label **pre-eval** vs **run**; debug chips have higher contrast and truncate long logs.
- **Live scripts auto-run** — starting a stream immediately re-runs every **visible** script on the chart (no extra Run). Hide pauses execution and clears that script’s plots (series, markers, drawings, fills, `barcolor` when it is the last visible script); show re-runs it. `library()` sources stay out of the live / reapply loop.
- **Editor type highlighting** — `int` / `float` / `string` / … and declared UDTs / enums (`type Point`, `export enum Easing`, `m.Easing`) use the type token in **bold**. `series` / `simple` are bold only as type qualifiers; `m.SuperTrend(` stays a library member.
- **Strategy Properties wiring** — Apply persists only changed `strategy()` kwargs (so leverage is not overwritten by default margin %). Leverage ↔ margin UI no longer writes the auto-filled sibling into the bag. Editor Properties apply on isolate/HPO runs. Execution flags are documented as not implemented in PYNE.

### Fixed

- **`plot.style_linebr` / `steplinebr` / `areabr` on `na`** — Lightweight Charts Line/Area series drop whitespace points and connect the remaining samples, so Supertrend-style `bull ? st : na` plots drew a diagonal through inactive stretches. `*br` styles now hide the LWC connector and stroke each finite run (isolated samples stay a tick). `plot.style_line` still spans `na`.
- **Hide mid-run** — an in-flight live apply no longer paints after Hide; empty-bar `startLive` no longer logs `No bars loaded`.
- **Last-value names** — compare / on-chain titles survive **[T]**; volume stays number-only unless a title was set. Default `exactOnCandle` puts `Long N` on the side arrow, not the in-bar circle.
- **Isolate / HPO strategy bag** — explicit `strategyProps: {}` means no rewrite; isolate no longer merges leftover editor broker settings onto a baked study.
- **Last-bar / `varip` drawings** — `line.new` / `box.new` / polylines / linefills that extend one bar past the series (`bar_index + 1`) are no longer snapped to the last candle (that flattened them into a vertical tick). Labels still clamp `timenow` onto the last bar. Historical `varip` **plots** already render as a normal 1-sample-per-bar series (AXIS does not send `realtime_last_bar`; enabling it would reset last-bar `varip` cells under pyne’s current re-init).

- **Remote LSP cooldown** — aborting an in-flight `/lsp/*` request (typing, hover leave, pre-eval cancel) no longer starts the 30s failure cooldown, so idle parse diagnostics still reach pyne.
- **Editor Problems / underlines** — a clean pre-eval no longer wipes last-run runtime errors. Pre-eval and last-run marks are unioned while the buffer still matches the run source.
- **`plotshape` / `plotchar` / `plotarrow` `style=`** — completions offer `shape.*` instead of invalid `plot.style_*`.
- **Pre-eval block comments** — `"/*"` and `https://` inside strings are no longer treated as comments (which could block Run).
- **Inline debug line parse** — log values like `RSI: 55` no longer become a chip on line 55; structured `line` wins.
- **`color=` completions** — `color.new` / `color.rgb` / `color.from_gradient` stay in the list (including after `color=color.`).

### See also

- [Editor](docs/ui/editor.mdx)

## [2.0.14] — 2026-08-17

Strategy hyperparameter search in Results, isolated trial runs, and `/optimize` proxy wiring.

### Added

- **Hyperparameter Optimisation** — built-in component plugin (`hyperparameter-optimisation`) and Results → **Optimise** tab. Searches `strategy()` `input.*` values over N trials. Evaluation SoT is pyne `POST /optimize` (TPE / random / grid + holdout / walk-forward); Pyodide falls back to an isolated client loop. Apply winner **merges** into Script Inputs (unsearched fields stay). Strategies only.
- **`runScript({ isolate, bars, signal })`** — headless engine eval so HPO trials do not touch `lastRun`, the chart, or the engine HUD. Live multiplex defers while a study is running.
- Vite / Docker nginx **proxy `/optimize`** next to `/run` so same-origin VPS and `bun run dev` hit Flask.

### See also

- [Hyperparameter Optimisation](docs/enduser/guides/hyperparameter-optimisation.mdx)

## [2.0.13] — 2026-08-17

Call-parameter intelligence, richer Pine highlighting, script input enums, and Pine table lifecycle.

### Added

- **Call parameter intelligence** — hover on `plot` / `input.int` / `ta.sma` (and other curated calls) shows parameter docs + an example. After `,` inside a call, completions offer remaining named args (`title=`, `minval=`) in a **Parameters** section and already-used ones under **Already used**. A signature hint below the cursor lists every parameter and marks used / current / unused.

### Improved

- **Pine editor highlighting** — series builtins (`close`, `bar_index`, `time`, OHLC) use a cyan token distinct from user variables; `import … as` aliases and library export members (`m.Easing`) use a violet family; types get a warm token. New chrome vars `--color-cyan`, `--color-editor-builtin`, `--color-editor-lib`, `--color-editor-lib-member`, `--color-editor-type`.

### Fixed

- **Script Inputs enum values** — `input.enum(m.Easing.linear)` no longer shows the import/Python path as a text field. Members are inferred from `enum` declarations (local + imported library source), values normalize to `Type.member`, and the modal seeds from that script’s `runResults` (not another indicator’s `lastRun`).
- **Script display name** — applied scripts / pane badges always use the Pine `indicator()` / `strategy()` / `library()` title (not engine `"plot"` or a stale file name).
- **Pine tables after delete** — table HUD only shows tables from still-applied scripts’ `runResults` (orphans / `__editor__` leftovers no longer stick). First-run migrates run cache to the real script id; last-script delete clears script drawings.
- **Pine table layout** — grid size expands from cell extents when engine understates rows/columns; frame/border and cell align improved.

## [2.0.12] — 2026-08-17

Editor color chips + type declarations, chart label/marker lifecycle, topbar icon map, debug UX.

### Added

- **Editor inline color chips** — square swatches (line-height × line-height) before Pine color literals (`#hex`, `color.red`, `color.rgb(...)`, `color.new(...)`). Click selects the range.
- **Add type declarations** (editor overflow → Source) — after a successful first run, inserts missing Pine **type1** (`series` / `simple` / `const`) and **type2** (`int` / `float` / `bool` / `string` / `color` / …) on untyped assignments.
- **`ICON_MAP`** (`src/ui/icon-map.ts` + `Icons` in `icons.tsx`) — one Lucide glyph per product intent; topbar panel buttons each use a unique icon.

### Improved

- **Panel hamburger menu** — consistent 12px label / 14px icons; **New window** → **New tab**.
- **System Logs** — clear control uses trash icon instead of ×.
- **Topbar panels** — reordered List → Editor → Library → Scripts → Inputs → Layers → DSM → On-Chain → Alerts → Values → Results → Script Logs → System Logs → Status.
- **Inline debug / Chart pins** — overflow Debug items include full how-to on hover; toggle shows status-bar tips.

### Fixed

- **Duplicate last-value labels** on indicator panes (editor owner + real script id stacked series).
- **Strategy long/short labels** stayed after remove — trade markers are owner-scoped and cleared on detach.
- **Chart chrome** — removed top-right fullscreen / chart-only icon buttons (F11 / Shift+F / Esc still work).
- **Inline debug enable gate** — chips only when explicitly on; pin gutter class clears when empty.

## [2.0.11] — 2026-08-17

Chart script lifecycle, per-script indicator panes, pyne-worker engine, panel drag UX.

### Fixed

- **Panel title bar** — a plain click no longer undocks the panel to float; undock/move starts only after the pointer is dragged past a small threshold (hamburger still: click = menu, hold/drag = move).
- **Non-overlay indicators** — each `overlay=false` script gets its own sub-pane (`ind_<id>`) instead of stacking into a single shared `indicator` pane. Removing one script only clears that owner’s series and no longer destroys siblings’ full history (was left with 1–2 bars).
- **Chart scripts lifecycle** — add/remove/reopen stays correct: owner-scoped detach (no leftover series/empty panes), ChartHost no longer wipes re-applied scripts after history paint, centralized `reapplyChartScripts` restores visible scripts (with saved inputs/strategy props) after symbol load / cache paint; applied scripts are sanitized on hydrate and re-run on reopen.

### Added

- **Engine `pyne-worker`** — built-in edge evaluator plugin (default `https://pyne-worker.cryptolinx.workers.dev`), API key field, Workers Manager / Settings presets. Distinct from AXIS data-plane Worker and Flask `server`.

## [2.0.10] — 2026-08-16

Market data resilience, Script Settings input layout, and local-first editor LSP.

### Improved

- **Script Settings → Inputs formatting** — Pine `group`, `inline`, `tooltip` (`\\n`), and `active` / `active=<ident>` layout in the modal (TV Settings-style sections, same-line clusters, `?` help, grayed inactive fields). `input.text_area` uses a multi-line control.
- **Editor LSP hover + autocomplete** — local builtins/doc annotations show **immediately** (no wait on a dead Backend URL); remote Pro API is short-timeout + 30s cooldown after failure. **⌘/Ctrl-Space** triggers completion; tooltip z-index raised so hover/suggest stay above chart chrome.

### Fixed

- **Browser market data / plugins (CORS “status null”)** — when the page cannot reach venue hosts or remote plugin modules (geo, firewall, port 9443, extensions), AXIS no longer hard-depends on a single cross-origin path:
  - **Binance REST** tries `api.binance.com` → `data-api.binance.vision`, then the Worker allowlisted proxy `GET /api/market/binance/{klines,ticker/24hr,exchangeInfo}`.
  - **Binance WS** rotates `stream.binance.com:9443` → `:443` → default 443 → `data-stream.binance.vision`.
  - **PYNE Agent plugin** ships same-origin at `/plugins/axis-pine-agent.js` (legacy remote URL migrates on restore); agent API endpoint still defaults to the pyne-agent Worker.
  - **Service worker** navigation never rejects `respondWith` (offline shell HTML); cache version **v5**.

### Added

- **Worker market proxy** — `worker/src/market.ts` public allowlist for Binance klines / 24hr ticker / exchangeInfo (short isolate cache; not an open reverse proxy).

## [2.0.9] — 2026-08-15

Editor symbol catalog, richer Pine highlighting, CORS for Pages previews, and CI greens.

### Added

- **Editor symbol & emoji manager** — status-bar **Symbols** catalog of TV-editor-safe arrows, box drawing, blocks, marks, spaces, and chart emoji (IBM Plex Mono vs wide). Insert raw, quoted, or `plotchar(…)`.

### Improved

- **Pine highlighting** — stateful multiline strings + `/* */` blocks, `\\n` / hex-color atoms, namespaces (`ta.`, `label.new`), types, control vs definition keywords, function names before `(`.
- **Format** — leaves continuation lines of an unclosed string or block comment untouched.

### Fixed

- **CORS** — Cloudflare Pages previews (`*.pynescript-axis.pages.dev`) can call `https://axis.hoox.sh`. Pyne always allowlists those product Origins and treats `GET /health` as a free CORS path (AXIS Settings probe). Worker `pickOrigin` already echoed the same hosts.
- **CI** — library publish stays on the local cache when leftover/invalid git credentials fail remote (was `GitHub: Bad credentials` in the full unit suite). Smoke waits on `axis-status-message` and opens Plugins via Runtimes. Vite build on macOS/Windows resolves Solid `Topbar.tsx` / `Watchlist.tsx` instead of same-stem legacy JS. Docker push uses the `release` bake group (no `:local` docker.io tags) and bake-action v6 env overrides.

### Changed

- **Pyodide PYNE wheel** — vendor `pynescript-0.3.7` (`Runtime.run(libraries=)` for `import ns/Name/ver`, ring-series skip, runtime hot path). Engine catalog, legacy JS engine, SW cache test, and editor builtins synced from pyne 0.3.7.

## [2.0.8] — 2026-08-15

Architecture modal, library publish emulator, drawings/plot parity, and the post-2.0.7 hardening stack.

### Changed

- **Pyodide PYNE wheel** — vendor `pynescript-0.3.6` (UDT `array.binary_search*` `sort_field`, drawing export/delete/fold). Engine catalog, legacy JS engine, SW cache test, and editor builtin metadata synced from pyne 0.3.6.

### Added

- **Library publish emulator** — `library()` scripts publish to git `{basePath}/published/{ns}/{Name}/{1,2,3…}/lib.pyne` (plus local cache). Library panel **Publish library**, or auto-publish on a successful Run. Consumers `import ns/Name/ver`; AXIS resolves the folder and sends sources to the engine (`register_library_source`).
- **Architecture modal** — topbar **Wire** (and command palette **Open Architecture**) opens a compose-recipe dialog: pick Offline Lab / Live Crypto / CSV Desk / On-Chain / Team Cloud, then swap or switch off any source · stream · engine · storage · dataset slot. Plan name records drift (`Live Crypto +1 −1`); Apply commits `setActivePlugin` + optional on-chain panel.
- **Pine `label` styles / yloc** — normalize passes through `style`, `yloc`, `size`/`text_size`, `textcolor`, and `color`; SVG paint supports `label.style_label_up|down|left|right|center` (and bare tokens), bubble tips, icon markers (`xcross`, triangles, …), and `yloc.abovebar` / `yloc.belowbar` when OHLC bars are available (default `yloc.price` + bubble for unknown styles).
- **About AXIS modal** — click the topbar HOOX/AXIS brand (or command palette **About AXIS** / Help → About) for product, author, and HOOX ethos from [hoox.sh/manifesto](https://hoox.sh/manifesto), with links to AXIS / PYNE / docs.
- **Script settings → Properties** — when a `strategy()` is loaded, a **Properties** tab exposes broker parameters (initial capital, order size / pyramiding, commission, leverage / margin, process orders on close, calc flags). Overrides persist per script and are merged into `strategy()` on run without rewriting the editor buffer.
- **`linefill.new` paint** — normalize + SVG quad fill between two lines (pairs with pyne `export_for_api` linefill serialization).
- **`barcolor()`** — per-bar candle body/wick tint from `kind: barcolor` series (LWC color fields).
- **plotshape multi-script** — shape markers are owner-scoped by script id so one run does not wipe another script’s shapes.
- **Non-overlay drawings** — `overlay=false` scripts paint geometry on the indicator pane Y-scale; `force_overlay` still routes to price.
- **Compile `line.set_*`** — pyne folds set events onto handles before export (final geometry for AXIS).

### Improved

- **Editor default width** — factory / layout-reset docked editor width is **50vw** (was fixed 460px); existing persisted widths unchanged.
- **Editor gutters on demand** — line-number column stays content-width (digits only; overrides CM 20px min); diagnostic + inline-debug gutters hide until they have markers (profiler-style).
- **Modal focus trap** — shared `installFocusTrap` cycles Tab inside Settings / About and restores prior focus on close.
- **Chart a11y region** — ChartHost exposes `role="region"` with symbol/interval/bar-count label; load success/error uses polite/assertive SR announcer.
- **Session DO stream sanitize** — symbol `^[A-Z0-9]{1,20}$` + Binance interval allowlist before upstream WS URL is built.
- **Prod plugin remote allowlist** — production builds default-deny remote plugin hosts (same-origin `/plugins/*` + `data:` + allowlisted PYNE Agent host); override with `VITE_ALLOW_REMOTE_PLUGINS` / `VITE_PLUGIN_REMOTE_ALLOW`.
- **Plot fill apply** — skip SVG rebuild when fill fingerprint matches; pan/zoom paint uses visible-range cull + pixel-budget stride on dense bands.
- **Runner OHLCV times cache** — live re-apply reuses the times axis when `chartDataGen` + length + last time are unchanged (open-bar ticks).
- **Webhook URL policy** — https-only, no credentials, reject loopback/private IP literals; 8s AbortController timeout.
- **Presentation Escape** — detect AXIS modals via `[role=dialog][aria-modal=true]` (not only native `<dialog open>`).
- **CSP baseline** — nginx + Bun static server send Content-Security-Policy (self scripts, wasm-unsafe-eval, https/wss connect, frame-ancestors self).
- **First-paint bundle** — chart PWA critical path no longer statically imports CodeMirror/editor or `@tauri-apps/*`: `index.tsx` dynamic-imports App vs EditorApp; `EditorPane` is Solid `lazy` + `Show` when docked editor is open; Tauri shell install is dynamic-imported after a lightweight `isTauriShell` check.
- **Multi-chart slot bars reactive** — `chart-registry` stores per-slot `bars` / `chartDataGen` in a Solid store so inactive ChartHost slots re-paint when those paths change.
- **PWA SW update UX** — stop blind `SKIP_WAITING` without a reload path; post skip-waiting only when activating a waiting update, and soft-reload once on `controllerchange` (refreshing guard) so mixed old/new modules never stick. Still skips DEV and Tauri.
- **Heavy live re-runs** — at ≥10k bars, `every-tick` indicator re-runs are treated as `bar-close` so full OHLCV is not re-encoded for the engine on every open-bar tick (`effectiveLiveRerunMode`).
- **Offline history fallback** — when venue/source fetch fails, `loadSymbolData` paints warm `bars-cache` series and reports `Offline · N cached bars` (telemetry `degraded`).
- **SW runtime cache cap** — `axis-runtime-v4` soft-caps at 96 entries (FIFO trim after put); version bump clears prior unbounded `v3` runtime caches.
- **Watchlist quote batching** — multi-symbol WS ticks coalesce to one Solid price-map write per animation frame.
- **Live tick rAF coalesce** — multiplex keeps only the newest bar until the next animation frame so trade-ticker floods (Coinbase) do not thrash store + LWC every message.
- **Pane resize coalescing** — `PaneManager` ResizeObserver callbacks flush once per rAF (was synchronous `applyOptions` per pane entry).
- **Smart series apply fingerprint** — overlay tip no-op when length + last time **and** last value match (skips redundant LWC `update` on silent re-runs).
- **Overlay tip-only re-apply** — silent live `syncOverlayLines` updates the last point without a full `toLwcLineData` map when prior meta length + lastTime match (falls back to full setData on length/time change).
- **StatusBar / Results strategy reports** — no longer rebuild trade pairing on every live `store.bars` path update; depend on `lastRun` / `chartDataGen` / fill-mode prefs.
- **`loadBars` batching** — multi-field store writes run inside Solid `batch()` for a single reactive flush.
- **Vite critical path** — `modulePreload` drops CodeMirror / pyne-builtins from first paint; gzip enabled on Docker nginx; `X-Frame-Options: DENY`.
- **OHLCV bulk paint hardening** — `mapBarsToPriceData` / volume mapper drop non-finite rows so one NaN bar cannot blank LWC series.
- **Plot styles** — distinct series kinds for `plot.style_columns` (vs histogram), `plot.style_cross` (discrete markers, no connector), and `plot.style_stepline_diamond` (stepline + vertex markers). plotshape diamond/cross map to square marks with optional `+`/`✕` glyphs. LWC still lacks column-width and native diamond/cross point markers — documented in charting docs.
- **`line.style_arrow_*`** — script lines paint SVG arrow heads for `arrow_left` / `arrow_right` / `arrow_both` (were solid stroke only).

### Fixed

- **Editor Problems panel close** — auto-open only when diagnostic count *increases*; no longer re-forces open on every pre-eval/store tick while problems remain (statusbar toggle can stay closed).
- **Worker `/api/run` auth fail-closed** — when `EXTERNAL_BACKEND` is non-empty or `PYODIDE_IN_WORKER=enabled` and `ALLOW_OPEN_KEYS` is not `"1"`, `POST /api/run` requires `requireApiKey` (also still forced by `API_KEYS` / `REQUIRE_RUN_AUTH`); local demos keep open keys without burning unauthenticated compute on a real backend.
- **Script-only drawing layer leak** — `clearScriptPaneLayers()` on ChartHost unmount (RO + time-scale subs were retained after multi-chart dispose).
- **Companion panel postMessage** — origin-bound target + receiver check (no more `*`).
- **Legacy results event CSS class** — allowlist kind tokens before interpolating into `class` (attribute breakout).
- **ResizeHandle multi-touch** — ignore non-primary pointer ids mid-drag.
- **bars-cache IDB integrity** — `pagehide` / `beforeunload` flush pending debounced puts.

### Tests

- **CI workflow** — `.github/workflows/ci.yml` runs `bun run test`, `test:security`, and Playwright `@smoke` (Chromium) on PR / main.
- **Optional firehose bench** — `tests/bench/` (`AXIS_BENCH=1` / `bun run test:bench`): 500k `appendBar` ticks on ~50k history with soft wall budget; skipped by default.
- **Drawings / plot-visuals** — unit coverage for `force_overlay` normalize, `linefill` edge cases, `barcolorSeriesToMap` / `coerceBarColor`, and GC with `linefill` present.
- **plot-visuals** — columns / cross / stepline_diamond kind mapping, histogram-family helpers, diamond/cross shape + glyph defaults.
- **chart-type / heavy-data** — non-finite OHLC filter on price + volume mappers.
- **store-append-scale** — always-on `appendBar` same-time + cap invariants.
- **multiplex-heavy-rerun / sw-strategy / load-symbol** — heavy re-run mode, runtime cache FIFO cap, offline bars-cache fallback.
- **register-sw** — pure update helpers (`shouldSoftReloadOnControllerChange`, skip-waiting) + controllerchange single-reload mocks.
- **security / runner / fills** — remote plugin prod allowlist, webhook URL policy, OHLCV times cache, plot fill signature.

## [2.0.7] — 2026-08-12

Pine drawings diagnostics and plotarrow direction; pairs with pyne 0.3.5 last-bar line export.

### Fixed

- **`line.new` / drawings apply** — prefer DrawingLayer fallback when applying Pine drawings; warn when the engine returns drawings that normalize to zero or when no layer is mounted (load bars first).
- **`plotarrow`** — negative series samples render as down arrows (were always up).

## [2.0.6] — 2026-08-12

Test suite isolation and store hydrate defaults hardening.

### Fixed

- **Tests** — isolate store/state defaults across suites; strategy-extra uses event prices (not bar fills); engine `isReady` mock returns JSON health; hydrate never restores plane telemetry from disk.
- **Store seed** — createStore no longer aliases nested `DEFAULTS` objects (telemetry/panels/live), so path updates cannot poison factory defaults.

## [2.0.5] — 2026-08-12

Panel manager defaults / reset / chart overlay; classic Status + System Logs chrome; editor open-in-new-tab.

### Added

- **Panel manager** — per-panel **default position** (dock + size + float coords in `PANEL_META`); panel menu **Reset to default**.
- **Chart overlay** — per-panel toggle and bulk **Chart overlay: all on/off** (`setAllPanelsChartOverlay`); edge-docked panels float over the chart without shrinking it.
- **Editor** — **Open in new tab** in overflow panel options (and left dock menu).

### Changed

- **Status bar** — restored classic fixed footer look (no panel title chrome).
- **System Logs** — restored classic collapsible strip (expand/collapse body); topbar shows/hides the strip. Label **System Logs** (not bare “Logs”).

## [2.0.4] — 2026-08-11

Script Logs / System Logs naming and Status / System Logs topbar toggles.

### Changed

- **Script Logs / System Logs** — Script `log.*` pane titled **Script Logs** (editor tool + panel); app telemetry titled **System Logs**.
- **Status & System Logs** — topbar toggles for **Script Logs**, **System Logs**, **Status**.

## [2.0.3] — 2026-08-11

Runtimes hub, editor save-before-run / idle lint, Workers Manager reliability, and hardened VPS probe routing.

### Fixed

- **Workers Manager endless probing** — open-effect no longer tracks `store.endpoint` (backend changes re-fired probes); every probe gets a hard timeout merged with the modal abort; Pyodide probe uses HEAD instead of downloading full `pyodide.js`; `probeAllWorkers` uses `allSettled`.
- **Workers Manager / hardened VPS** — pyne Pro probes use same-origin `https://axis.hoox.sh/health` (nginx → loopback :5002) instead of client `127.0.0.1:5002`, which UFW correctly blocks on the public VPS.

### Changed

- **Runtimes hub** — single dialog for **Status** (Workers Manager) and **Plugins** (catalog / install / library); topbar **Runtimes** entry; cross-links between sections; models remain separate.
- **Save before Run** — clicking Run (editor header, topbar split, Mod-Enter, command palette) auto-saves the active script to the library when the tab is dirty or not yet bound (`libraryId`). Save failure blocks the run.
- **Idle lint** — editor underlines (e.g. `plt()` → unknown) reappear after **2s** without typing, not only after Save/Run. Mid-keystroke marks stay cleared; bare call typos like `plt()` flagged locally.
- **Workers Manager UX** — distinct icon per catalog worker; **Usage / When to use** copy on Detail + Install; docs updated.
- **Editor line numbers** — gutter width follows digit count only (no fixed min-width / heavy padding).

## [2.0.2] — 2026-08-11

Editor chrome polish and docked panel **hover slide**.

### Added

- **Panel hover slide** — docked panels can collapse to a peek strip and slide open/closed on pointer enter/leave. Toggle **Slide on hover** in the panel hamburger menu (left/right/bottom only). Store APIs: `setPanelHoverSlide`, `togglePanelHoverSlide`, `isPanelHoverSlide`. Preference persists on `panelChrome[id].hoverSlide`.

### Changed

- **Editor chrome polish** — header tools always show **icon + label** (no hover slide-in); **Format** removed from the editor header and tab strip (still available via overflow **Format document** and `Shift+Alt+F` / `Mod+Shift+F`).
- **Library from editor** — primary **Library** tool opens the script library panel; overflow menu also has **Open library**.

### Fixed

- **Tab close / switch** — closing a tab left of the active one no longer jumps focus; CM buffer is snapshotted before add/close/switch; `setDoc` no-ops on identical content.

## [2.0.1] — 2026-08-11

Security and performance release from the multi-agent **harden-perf** audit
(4 specialist scanners + synthesis). Report: `docs/devops/harden-perf-audit-2026-08-11.md`.

### Security

- Fail-closed Worker auth when D1 is bound without `API_KEYS` KV (`API_KEYS_REQUIRED`).
- CORS: product hosts + project-scoped `*.pynescript-axis.pages.dev` only (no open `*.pages.dev`).
- `/api/run`: auth when `API_KEYS` or `REQUIRE_RUN_AUTH`; per-IP/key rate limit (30/min); script/bars size caps; upstream proxy timeout.
- Git OAuth: env `GITHUB_OAUTH_CLIENT_ID` / `GITLAB_OAUTH_CLIENT_ID` wins over body `clientId`; tighter start/poll rate limits.
- Watchlist: build rows with `textContent` (no unescaped symbol `innerHTML`).

### Performance & reliability

- bars-cache: memory-first `getCachedBars`, IDB hydrate, `getCachedBarCount` / range without full clone when warm.
- DSM gap-fill progress uses `getCachedBarCount` instead of full series loads.
- engine-ws: 45s dead cool-down — keep dead client so live re-runs do not thrash reconnects.

### Commits

- `0a668e00` — fix(security,perf): gate /api/run, OAuth clientId, WS cool-down
- `156221b9` — fix(security,perf): fail-closed Worker auth, CORS, bars-cache


---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

## Full history (recursive)

### 2026-09 (2 commits)

#### Fixes

- `16499ac7` (2026-09-04) — fix(results): skip live-tick persist and unstick studio e2e

#### Chores

- `e84b8325` (2026-09-04) — chore(release): prepare v2.2.0

### 2026-08 (237 commits)

#### Security

- `d2b50220` (2026-08-13) — a11y,security: focus trap, chart region, SessionDO stream sanitize
- `4321c4b9` (2026-08-13) — security,perf: plugin allowlist, webhook policy, CSP, fill/runner hot paths
- `72869743` (2026-08-13) — perf,security,ci: multi-agent optim stack (registry, overlay tip, auth, SW, bundle, CI)
- `ebfc9955` (2026-08-07) — harden chart, data, and run paths for performance and crash resilience

#### Features

- `783a1003` (2026-08-30) — feat(ui): fullscreen studio overlay, Results JSON tree, and market proxy hardening
- `9081a559` (2026-08-29) — feat(worker): MEXC public REST through /api/market/mexc/* proxy
- `fb193c25` (2026-08-29) — feat(panel): per-panel icon in FloatableShell header
- `9196e4cb` (2026-08-29) — feat(ui): storage-change migration dialog
- `008fb22a` (2026-08-29) — feat(storage): persist strategy/indicator run results via StoragePlugin
- `eb86c103` (2026-08-28) — feat(results): fullscreen results studio, HPO polish, and tier gating
- `28a1f202` (2026-08-27) — feat(settings): add topbar tab to SettingsPage (studio view)
- `339f6a05` (2026-08-27) — feat(settings): add topbar visibility settings tab
- `67b1558d` (2026-08-24) — feat(security): enforce CSP baseline on Cloudflare Pages deploys
- `3fb40122` (2026-08-24) — feat(data): native MEXC spot venue + PYNE Pro origin pynescript.online
- `09e047cd` (2026-08-24) — feat(ui): single Studio button replaces Wire/Runtime/Settings
- `cd0148ca` (2026-08-23) — feat(cli): ship production-grade @hoox-sh/axis-cli 0.2.0
- `0d45a6f2` (2026-08-23) — feat(ui): full-page studio overlay for Runtime, Wire, and Settings
- `6900c093` (2026-08-22) — feat(ui): slide-over drawers for Settings, Runtimes, and Wire
- `c685a2d4` (2026-08-22) — feat(ui): Venue picker pairs native CEX and CCXT in one control
- `fe0ed9c7` (2026-08-22) — feat(ui): CCXT symbol catalog and hide paired stream
- `95144094` (2026-08-22) — feat(data): CCXT session keys and plugin-config/editor fixes
- `339175f0` (2026-08-21) — feat(ui): advanced config fields in Settings + full ccxt exchange list
- `203b4492` (2026-08-21) — feat(ui): topbar plugin config row for source/stream configSchema
- `6b4d5543` (2026-08-21) — feat(plugins): gateway-aware active source/stream resolution
- `1631975f` (2026-08-21) — feat(stream): ccxt-ws gateway stream plugin
- `c1887afd` (2026-08-21) — feat(source): ccxt-rest gateway source plugin
- `a47baf04` (2026-08-21) — feat(data): gateway transport layer for CCXT datafeed
- `3c72d089` (2026-08-20) — feat(release): AXIS v2.0.18 multi-venue DO, credential vault, CCXT sidecar
- `c42992e8` (2026-08-19) — feat(release): AXIS v2.0.17 editor lint underlines and typos
- `720237a1` (2026-08-19) — feat(release): AXIS v2.0.16 editor intel recovery
- `fd23d4a8` (2026-08-19) — feat(release): AXIS v2.0.15 editor intelligence and linebr
- `cbe6369f` (2026-08-19) — feat(editor): richer hover, param checklist, and pre-eval
- `a2178fc9` (2026-08-18) — feat: live script execution, chart labels, and strategy properties
- `35557be3` (2026-08-17) — feat(release): AXIS v2.0.14 strategy hyperparameter optimisation
- `9ec62e96` (2026-08-17) — feat(release): AXIS v2.0.13 params, highlighting, input enums, tables
- `db3b42c1` (2026-08-17) — feat(release): AXIS v2.0.12 editor UX, chart lifecycle, icon map
- `f96319e3` (2026-08-17) — feat(release): AXIS v2.0.11 chart scripts lifecycle and pyne-worker engine
- `7f85d664` (2026-08-16) — feat(release): AXIS v2.0.10 market proxy, inputs layout, local-first LSP
- `2cae2b72` (2026-08-15) — feat(editor): symbol catalog and richer Pine highlighting
- `9411a16b` (2026-08-15) — feat(pyodide): vendor pynescript 0.3.7 wheel
- `fe6dfb18` (2026-08-15) — feat(library): git versioned publish emulator for import ns/Name/ver
- `4d1e8647` (2026-08-13) — feat(ui): architecture modal to wire plugin slots from recipes
- `814cb21f` (2026-08-13) — feat(editor): 50vw default width; content-sized gutters
- `80f25012` (2026-08-13) — feat(pyodide): vendor pynescript 0.3.6 wheel
- `904ec110` (2026-08-12) — feat(drawings): paint line.style_arrow_left/right/both heads
- `669ee31d` (2026-08-12) — feat(drawings,plot): label styles/yloc, plot columns/cross/diamond
- `8b80166b` (2026-08-12) — feat(drawings): non-overlay pane Y + force_overlay routing
- `46229069` (2026-08-12) — feat(drawings,plot): linefill paint, barcolor, multi-script shapes
- `4b379391` (2026-08-12) — feat(ui): strategy Properties tab in Script settings
- `4bf973e4` (2026-08-12) — feat(ui): About AXIS modal on logo click
- `e96114b0` (2026-08-12) — feat(editor): handle PYNE Agent insert/open script events
- `e29aa644` (2026-08-12) — feat(ui,panels): panel defaults, chart overlay, classic logs chrome
- `a00ad891` (2026-08-11) — feat(ui): dockable Status and System Logs; Script Logs naming
- `7f44667e` (2026-08-11) — feat(runtimes,editor): hub, idle lint, save-before-run, tight line gutters
- `0c4a812d` (2026-08-11) — feat(editor,panels): hover-slide docks and editor chrome polish
- `7abea423` (2026-08-10) — feat(chart): price-scale decimals with auto from symbol/bars
- `235079b7` (2026-08-10) — feat(editor): autoformat, color tools, and chrome redesign
- `9ce5e0f3` (2026-08-10) — feat: plot style chart parity, preeval constants, and storage versions
- `dee91540` (2026-08-10) — feat(ui): fullscreen modes, price-pane scale controls, brand density
- `8aa9dddc` (2026-08-10) — feat(ui): symbol modal and richer Scripts panel cards
- `60502d08` (2026-08-10) — feat(cli): add AXIS CLI for install, setup, deploy, and doctor
- `da9dd6fd` (2026-08-10) — feat: Workers Manager modal and Tauri desktop shell
- `cf938db1` (2026-08-09) — feat(examples): add Pine v6 script library starter pack
- `a21dc811` (2026-08-08) — feat(plugins): install PYNE Agent component and enable component URL load
- `fae48240` (2026-08-08) — feat(onchain): refresh jobs, CSV export, and popular protocol presets
- `61c9993c` (2026-08-08) — feat(onchain): alerts UI, data view, commands, and ADR-015
- `8ad97cb8` (2026-08-07) — feat(onchain): alerts, layers, HUD health, and DSM walk-back polish
- `f91a10f7` (2026-08-07) — feat(onchain): data plane with DefiLlama TVL, DEX OHLCV, and events
- `f62611a0` (2026-08-07) — feat(editor): typo marks, wrap toggle, resizable Problems
- `259204e5` (2026-08-07) — feat(editor): pre-eval marks wrong code and disables Run
- `6a945396` (2026-08-07) — feat(drawings): merge parallel agent tool packs with full tests
- `9427a565` (2026-08-07) — feat(drawings): Gann, fib extras, patterns, and forecast tools
- `963f5f87` (2026-08-07) — feat(drawings): seed types and catalog for next parity packs
- `aaa2cca5` (2026-08-07) — feat(drawings): pitchfork, brush, callout, and more parity tools
- `1abe0795` (2026-08-07) — feat(drawings): registry-based tools toward charting platform parity
- `807262a4` (2026-08-07) — feat(data): dataset manager load window, venue live, expand to now
- `0e4ae885` (2026-08-06) — feat(data): raise historical bars cap to 100k
- `58ff7be5` (2026-08-06) — feat(data): cached datasets browser and Data Manager chart source
- `c1d45d00` (2026-08-06) — feat(ui): high-end theme presets, Scripts panel, Run accent only while busy
- `4a6c5e49` (2026-08-06) — feat(data): background Data Source Manager for multi-page OHLCV backfill
- `b7887c92` (2026-08-06) — feat(editor): slide-in tool labels on hover
- `4d533975` (2026-08-06) — feat(strategy): close fills, slippage next-open, marker prefs; fix script settings focus
- `4705cb96` (2026-08-06) — feat: symbol-scoped drawings, chart refresh, labels, editor docs
- `43b0de57` (2026-08-04) — feat(docker): full Buildx bake + Compose stack for AXIS PWA
- `b51879b0` (2026-08-04) — feat(ui): move chart Theme Manager to its own Settings tab
- `5f6863f0` (2026-08-03) — feat: chart Theme Manager (Pine chart.bg_color/fg_color) and UI hardening
- `26a8358d` (2026-08-03) — feat: GitHub/GitLab OAuth connect, multi-script results focus, hoox-sh org
- `902f3d4f` (2026-08-03) — feat: multi-agent PWA hardening for rock-solid reliability
- `b844a76f` (2026-08-02) — feat(ui): library panel, editor run/tab, live-after-load default
- `ed812a67` (2026-08-02) — feat(chart): render Pine fill(plot1, plot2, color=…) as SVG bands
- `7b481574` (2026-08-02) — feat(library): default git scripts to .pyne under pyne-library
- `52e2aa8c` (2026-08-02) — feat(library): drag-drop .pine files into script library
- `0b0df8e7` (2026-08-01) — feat(editor,topbar): parallel polish — ruler, diagnostics, git, pins, problems
- `10dd5074` (2026-08-01) — feat(editor): show cursor line:col in stats strip
- `c44f4cd9` (2026-08-01) — feat(chart): script action icons on pane name badges
- `ee31517a` (2026-08-01) — feat: TV-class power features from parallel agents
- `a6cd8e1b` (2026-08-01) — feat(editor): inline debug, wrap, stats; layers left slide-in
- `9309f9a2` (2026-08-01) — feat(layers): list and select user drawings in Layers panel
- `f45bf320` (2026-08-01) — feat(drawings): vline, extend, arrow, ellipse + toolbar polish
- `40430f6b` (2026-08-01) — feat(chart): multi-chart layouts, indicator align, editor full height
- `bacedac8` (2026-08-01) — feat(ui): chart reflow with docks, reload/reset, float editor fixes
- `0f9c4433` (2026-08-01) — feat(ui): stack multiple docked panels one below the other
- `f982e0d8` (2026-08-01) — feat(chart): multi-pane sync, scale controls, drawing GC, history depth

#### Fixes

- `defaccea` (2026-08-29) — fix(data): try MEXC Worker proxy first, direct host as fallback
- `167921f2` (2026-08-29) — fix(worker): update CORS product hosts to pynescript.online (retire .ai)
- `8426f3d9` (2026-08-29) — fix(editor): remove duplicate 'Open in new tab' entry
- `6178bced` (2026-08-29) — fix(ui): status bar chips wobble on hover
- `e0b8d4a8` (2026-08-27) — fix(chart): repaint full series on input override recompute
- `5fe39320` (2026-08-27) — fix(ui): fine-tune settings polish and worker probe
- `ad473102` (2026-08-27) — fix(ui): polish settings pages and fix worker health probe blocking
- `bb702efb` (2026-08-27) — fix(wire): remove separate scrolling sections from wire page
- `f38a0239` (2026-08-26) — fix(compile): display= folding into plot_attrs for data_window-only plots
- `cb9c1773` (2026-08-26) — fix(compile): hline linestyle via plot_meta backfill + default auto mode
- `5bc18f5d` (2026-08-26) — fix(hline): synthesize plot_meta in interpret path for hline linestyle
- `d417025f` (2026-08-26) — fix(multi-chart): restore slot history on focus so each cell computes independently
- `5025302f` (2026-08-26) — fix(hline): carry linestyle through both drawing and overlay paths
- `b07befb9` (2026-08-25) — fix(chart): render table cell valign/text-size; carry bgcolor band titles
- `86b86bd7` (2026-08-24) — fix(chart): never host hlines on bgcolor underlays
- `53cef490` (2026-08-24) — fix(chart): finish PlotSample widening in runner types
- `2db34902` (2026-08-24) — fix(chart): preserve engine color series so bgcolor/barcolor render
- `68b13118` (2026-08-23) — fix(settings): keep user inputs on applied scripts
- `ea13ba50` (2026-08-23) — fix(ui): seed Wire plan on mount and expose source for e2e
- `70d0b378` (2026-08-23) — fix(chart): honor Pine plot display.* flags
- `bed28c62` (2026-08-23) — fix(chart): hide Pine drawings, label pad, histbase, re-own
- `a05e42d8` (2026-08-23) — fix(chart): plotshape pane routing and drawing tool settings
- `098bfee4` (2026-08-23) — fix(chart): drawing move, linefill GC, overlay pane routing
- `55e26ddd` (2026-08-22) — fix(editor): stop afterDot state leak from trailing-dot floats
- `d98048a8` (2026-08-22) — fix(editor): pre-eval typo round 3 — generics, import paths, dotted calls
- `47beaa62` (2026-08-22) — fix(editor): pre-eval typo round 2 — decl forms, curly quotes, linktoseries
- `5f0c3f36` (2026-08-22) — fix(editor): stop pre-eval typo flood on built-in vars, qualifiers, text.*
- `2f8ff1d2` (2026-08-22) — fix(ui): plugin config first-save crash + gateway select options
- `a6323558` (2026-08-21) — fix(ui): single shared plugin config row + exchange dropdown
- `7e74a266` (2026-08-21) — fix(gateway): remote-page loopback resolution + drop shadowed require
- `67361dc6` (2026-08-21) — fix(datafeed): ccxt-ws browser ESM require + ccxt-rest walk-back window
- `aefa3baf` (2026-08-20) — fix(editor): skip hex color tails in pre-eval identifier scanner
- `d408f110` (2026-08-20) — fix: resolve all 23 pre-existing TypeScript errors + CI typecheck gate
- `804c5662` (2026-08-20) — fix(test): reset store provider state in credentials beforeEach
- `b160498e` (2026-08-19) — fix: review follow-up for hover, hide, linebr, and agent seed
- `35efaed7` (2026-08-19) — fix(plugins): render PYNE Agent markdown and drop default endpoint
- `7ccd745d` (2026-08-19) — fix(chart): break plot.style_linebr on na
- `dbcf1f0a` (2026-08-18) — fix: review follow-up for live hide, labels, and strategy props
- `fa57f639` (2026-08-17) — fix(editor): LSP pre-eval marks and last-bar drawings
- `f0235ac1` (2026-08-15) — fix(ci): desktop Watchlist case clash and GHCR-only docker push
- `42cb454f` (2026-08-15) — fix(ci): green unit, smoke, desktop build, and docker bake
- `4d34d82a` (2026-08-13) — fix(editor): allow Problems panel to stay closed
- `eb61d218` (2026-08-12) — fix(drawings,plot): line.new last-bar export path + plotarrow direction
- `299ec83c` (2026-08-12) — fix(test,store): green suite — isolate defaults, health mock, bar fills
- `41099e71` (2026-08-11) — fix(plugins): clearer errors when cross-origin plugin import lacks CORS
- `3bc43323` (2026-08-11) — fix(panels): harden hover-slide reflow for non-DOM test windows
- `0a668e00` (2026-08-11) — fix(security,perf): gate /api/run, OAuth clientId, WS cool-down
- `156221b9` (2026-08-11) — fix(security,perf): fail-closed Worker auth, CORS, bars-cache
- `9bfc801b` (2026-08-10) — fix(editor,run): defer syntax lint; enum completions; protect interactive Run
- `24f9cf68` (2026-08-08) — fix(run): Re-run replace, add-instance menu, clear stuck Running
- `77d2727e` (2026-08-08) — fix(onchain): health probe always targets Worker base
- `b24fbd19` (2026-08-08) — fix(onchain): honor empty health endpoint override
- `f8e3ae47` (2026-08-08) — fix(onchain): always use AXIS Worker proxy; allow product CORS origins
- `794ecadb` (2026-08-08) — fix(onchain): do not proxy DefiLlama via axis.hoox.sh SPA host
- `6d672e34` (2026-08-07) — fix(editor): recognize strategy qty constants; copy problems
- `3557ac99` (2026-08-07) — fix(drawings): keep trendline draft when tool re-syncs mid-place
- `b81991da` (2026-08-06) — fix(deploy): same-origin Pro API on https://axis.hoox.sh
- `3e1f3a76` (2026-08-06) — fix(git): harden storage integrity and OAuth device flow
- `6f870e52` (2026-08-06) — fix(data): backfill from now with gap validate; theme chrome; editor tools
- `ebddd006` (2026-08-06) — fix(data): multi-page walk-back without startTime+endTime trap
- `fdb4c6b1` (2026-08-06) — fix(ui): repair DrawingToolbar JSX after badge layout comment
- `1fd8b64f` (2026-08-06) — fix(ui): keep script badges above drawing toolbar chrome
- `9140e31d` (2026-08-04) — fix(strategy): correct PnL for Long/Short reverse entries
- `260a59c4` (2026-08-04) — fix(strategy): stop zeroing net PnL from placeholder prices/profit
- `0867b1ce` (2026-08-04) — fix(ui): make log copy buttons work on HTTP (clipboard fallback)
- `10313f67` (2026-08-04) — fix(strategy): qty-aware PnL, equity curve, and Strategy results tab
- `4b32864d` (2026-08-04) — fix(pyodide): align vendored wheel dist-info with pynescript filename
- `7f516350` (2026-08-04) — fix(ui): stop overlapping PRICE, indicator, and symbol badges
- `73fd9d3d` (2026-08-03) — fix: strategy events, plot colors, and price-scale labels
- `16a381d1` (2026-08-03) — fix(ui): icon-only editor tools; new tab in panel hamburger
- `a4cc7b27` (2026-08-02) — fix(chart): collapse stacked same-text Pine status labels
- `146bb090` (2026-08-02) — fix(results): drop no-fill closes; recover Source inputs; clamp future labels
- `134414dc` (2026-08-02) — fix(library): strip TradingView Expand (N lines) chrome on import
- `3d89f4ac` (2026-08-02) — fix(library): open every dropped .pine as its own editor tab
- `abcf5eb2` (2026-08-02) — fix(library): block browser file-open on pine drag-drop
- `85e037be` (2026-08-01) — fix(dock): side-by-side panels on left/right (indicators left of editor)
- `33305aec` (2026-08-01) — fix(chart): plot indicators on stable sub-pane id
- `4fd29aea` (2026-08-01) — fix(chart): stop oscillator scripts vanishing on the price pane
- `8a11fdc5` (2026-08-01) — fix(editor): restore full height so lines are editable
- `3a77976d` (2026-08-01) — fix(replay): start with full history, not a single candle
- `f89b9cc6` (2026-08-01) — fix(editor): sync full Pine builtins corpus from pyne

#### Performance

- `de00cbf3` (2026-08-13) — perf(pwa): heavy live re-run throttle, offline bars fallback, SW v4 cap
- `a9375440` (2026-08-13) — perf: coalesce live ticks, resize, and strategy UI; harden paint/security
- `cb901eb4` (2026-08-10) — perf: full-app hardening — live ticks, overlays, load abort, boot split
- `a9f57958` (2026-08-10) — perf(chart): heavy history paint, conflation, and O(1) live ticks

#### Refactors

- `afb85816` (2026-08-26) — refactor(about): remove ethos/author, add versions and philosophy
- `6041c2d6` (2026-08-22) — refactor(ui): move plugin config section into Settings → Data tab
- `f19fe9a2` (2026-08-08) — refactor: rename remaining pine-* modules to pyne-*
- `18eedc78` (2026-08-08) — refactor: rename pine-language/lsp/builtins editor stack to pyne-*
- `096a799f` (2026-08-08) — refactor: rename pine-editor CSS, DOM, and PyneEditor component
- `b52526af` (2026-08-08) — refactor: rename pine-editor.js to pyne-editor.js
- `f0a1446b` (2026-08-02) — refactor: rename chart palette TV→VOID; document Pine naming parity

#### Documentation

- `0a705de9` (2026-08-27) — docs(changelog): add topbar settings and wire page fix entries
- `35dacd21` (2026-08-24) — docs: studio shell, MEXC venue, and PYNE Pro origin across guides
- `dce471b0` (2026-08-21) — docs(devops): list /datafeed/ among nginx-proxied Pro API paths
- `27b5ca13` (2026-08-21) — docs(changelog): datafeed gateway phase 4 additions
- `36900319` (2026-08-15) — docs(cors): document Pages preview origins for axis.hoox.sh
- `d3172dbb` (2026-08-11) — docs: AXIS 2.0.1 docs, CLI-first ops, Pine Script v6 examples
- `78c22e85` (2026-08-11) — docs(release): recursive changelog, AGENTS release workflow, v2.0.1
- `f7c30e04` (2026-08-09) — docs: prefix internal links with /axis/docs
- `3d6fe1ab` (2026-08-08) — docs(ui): clarify on-chain uses public APIs unless Worker endpoint
- `f21dcc47` (2026-08-08) — docs: update llm.txt for PyneEditor rename
- `95e181c3` (2026-08-08) — docs: document on-chain data plane in README, hubs, and worker
- `df7b77ab` (2026-08-07) — docs: add PYNE Agent (pyne-agent-worker) plugin guides
- `5d1dc0f0` (2026-08-07) — docs: add PYNE Agent (pyne-agent-worker) plugin guides
- `dc62332f` (2026-08-03) — docs: regenerate llm.txt and llms.txt agent corpora
- `5dc92693` (2026-08-01) — docs: align UI and end-user guides with last 15 commits

#### CI

- `0c963fc6` (2026-08-23) — ci(cli): do not fail release when access public is forbidden
- `88ca0133` (2026-08-23) — ci(cli): treat already-published 0.2.0 as success and set public
- `c35de1fe` (2026-08-23) — ci(cli): auth registry checks and always set package public
- `e07c59df` (2026-08-23) — ci(cli): force @hoox-sh/axis-cli public after npm publish
- `dd3ebf85` (2026-08-23) — ci(cli): publish with NPM_TOKEN_HOOXSH and isolate CLI tests
- `75c4543c` (2026-08-22) — ci: versioned docker tags and npm publish for axis-cli
- `3ddc4193` (2026-08-10) — ci(docker): fix image build, enhance make targets, add GHCR workflow
- `5b4bbef4` (2026-08-10) — ci: build Tauri desktop app on every main push

#### Tests

- `5d5844ae` (2026-08-23) — test(e2e): open Plugins via studio rail; exact Offline Lab apply

#### Chores

- `862631e6` (2026-08-29) — chore(release): prepare v2.1.1
- `40668dbc` (2026-08-29) — chore(release): prepare v2.1.0
- `f34c76cf` (2026-08-26) — chore(release): bump to v2.0.27 — PYNE wheel 0.4.0, hline linestyle, multi-chart fix
- `d323c8fd` (2026-08-24) — chore(release): v2.0.26
- `a01be631` (2026-08-23) — chore(release): AXIS v2.0.23
- `22966e62` (2026-08-23) — chore(release): AXIS v2.0.22
- `3e7236ef` (2026-08-21) — chore(release): v2.0.20
- `b4b3227b` (2026-08-15) — chore(release): AXIS v2.0.8
- `236d042f` (2026-08-12) — chore(release): AXIS v2.0.7
- `5f6d7a9a` (2026-08-12) — chore(release): AXIS v2.0.6
- `12cffe27` (2026-08-11) — chore: ignore local multi-agent sync notice files
- `33e11930` (2026-08-06) — chore(worker): gitignore wrangler.toml and ship example
- `9cb4dad0` (2026-08-06) — chore: vendor latest pyne 0.3.0 wheel (parity Aug 6)
- `9fba8aaf` (2026-08-03) — chore: rename SuperChart branding to AXIS including CF project id
- `0cbda10b` (2026-08-01) — chore(pyodide): vendor pynescript 0.3.0 wheel with drawing GC

#### Style

- `21676494` (2026-08-22) — style(ui): render inline plugin config fields via TopbarField

#### Merges

- `938835cb` (2026-08-08) — Merge pull request #1 from hoox-sh/feat/onchain-data-plane

#### Other

- `e6491985` (2026-08-08) — merge: resolve main conflicts for on-chain docs

### 2026-07 (79 commits)

#### Security

- `8c4a635c` (2026-07-24) — Harden + bugs + polish (16 changes)

#### Features

- `593bb8aa` (2026-07-31) — feat(inputs): OHLC source enums and cross-indicator plot sources
- `501761db` (2026-07-30) — feat(ui): make all panels border-resizable down to 1px
- `852d2fa2` (2026-07-30) — feat(ui): Scriptlogs rename; editor FloatableShell + tools
- `745e3426` (2026-07-30) — feat(ui): Pine Logs panel and Editor Profiler mode
- `a2ed35e6` (2026-07-30) — feat(chart): multi-type price series and fix settings save race
- `d0e52bb2` (2026-07-29) — feat: live watchlist WS quotes and TV-style drawing chrome
- `9487673c` (2026-07-29) — feat(ui): softer inputs and collapsible panel dock menu
- `4e9a6100` (2026-07-29) — feat(ui): density scale slider and floatable dockable panels
- `4e3f029d` (2026-07-29) — feat(ui): data window, layers, script inputs; plot visuals + strategy
- `60c7e2f9` (2026-07-29) — feat(settings): presets for VPS UI + local pyne compile
- `52cd2668` (2026-07-29) — feat(editor): prefer pyne Pro API LSP for completion and hover
- `08fdbf24` (2026-07-29) — feat(editor): Pine completion and hover from LSP builtin metadata
- `ebb4db8d` (2026-07-29) — feat(hud): ENG/RUN/MODE/PATH chips with sticky hover info
- `ba480687` (2026-07-29) — feat(settings): expose PYNE execution mode (interpret/compile/auto)
- `7dc63117` (2026-07-27) — feat(axis): connection HUD, WSS engine path, chart stability
- `7cf3d357` (2026-07-27) — feat(axis): quality stack at 95% coverage, e2e, and ops polish
- `55a5a0c2` (2026-07-26) — feat(axis): self-host Pyodide and preload on idle
- `e264c91e` (2026-07-26) — feat(axis): source-aware watchlist with interval and refresh settings
- `5de17948` (2026-07-26) — feat(axis): plugin capability badges and storage status chrome
- `b56e4f61` (2026-07-26) — feat(axis): git script storage and Pine table HUD
- `3e00e1e1` (2026-07-26) — feat(axis): script library, storage plugins, and drawing polish
- `6322cd7b` (2026-07-26) — feat(axis): render Pine drawings and drag user drawings
- `c9d2a0e8` (2026-07-26) — feat(axis): interactive chart drawing tools
- `31b7eed8` (2026-07-26) — feat(axis): jump-to-trade from Results and status-bar P&L
- `9c0e3b06` (2026-07-26) — feat(axis): strategy trade markers, equity pane, and event normalization
- `bd0a106b` (2026-07-26) — feat(axis): ship AXIS charting PWA, evaluator corpus fixes, and /run/batch
- `c2f27a02` (2026-07-25) — feat: SuperChart rewrite + Pine evaluator runtime fidelity
- `acee8d1c` (2026-07-24) — feat: slide-in editor pane with push-layout and drag resize
- `2a6a2163` (2026-07-23) — feat: Pyodide engine rewrite, watchlist sidebar, URL hash sync, demo scripts
- `40db7f47` (2026-07-23) — feat(pwa): wire multi-tab editor (CodeMirror 6 with tab persistence)
- `68da3cce` (2026-07-23) — feat(pwa): plugin manager, script library, theme switcher, symbol autocomplete, plugin examples
- `fe90be7b` (2026-07-23) — feat(pwa): settings dialog, multi-pane, volume, time presets, strategy tester
- `9be7d819` (2026-07-23) — feat(frontend): modular PWA + Cloudflare Worker backend
- `28b57862` (2026-07-20) — feat(v6): multiline strings, export const runtime, strategy state, library import

#### Fixes

- `d5e487f2` (2026-07-31) — fix(profiler): compute gutter % from Σ line cost, not wall ms
- `4d5ad0a0` (2026-07-31) — fix(profiler): send profiler over WS and auto-run on enable
- `34cb26a3` (2026-07-31) — fix(editor): render LSP hover markdown and round tooltip corners
- `0abecff8` (2026-07-31) — fix(profiler): pass profiler flag to API and map profile/logs
- `33308a88` (2026-07-29) — fix(ui): stop pine drawing flicker; indigo loader accent
- `3c6dbbae` (2026-07-29) — fix(engine): REST fallback after WS timeout must not reuse dead AbortSignal
- `7b4b951e` (2026-07-29) — fix(settings): clearer endpoint probe errors for NetworkError
- `156e8c7f` (2026-07-29) — fix(hud): keep ENG plane in sync with selected engine
- `8ffa6c5c` (2026-07-29) — fix(ui): pyodide load hint, clarify MODE vs ENG chips, clip tick pulse
- `9dfeab37` (2026-07-29) — fix(pyodide): install local wheels with deps=false
- `f4dd5d0b` (2026-07-29) — fix(settings): always show execution mode for server/pyodide
- `57814bd1` (2026-07-29) — fix(settings): show execution mode for pyodide engine too
- `7d0021d2` (2026-07-29) — fix(engine): tolerate bare NaN in REST /run responses
- `b97649fd` (2026-07-29) — fix(engine): send execution mode in REST /run body
- `22178b3a` (2026-07-27) — fix(api): accept null optional symbol on WS live re-runs
- `431b3da2` (2026-07-26) — fix(axis): serve pyodide wheels from public/ and stop SPA HTML fallback
- `2d10a39a` (2026-07-26) — fix(axis): open Indicators panel from topbar toggle
- `f75867d8` (2026-07-26) — fix(axis): return multi-plot series from /run and harden trade pairing
- `49ddff4e` (2026-07-26) — fix(axis): multi-plot series with colors and bar-mode crossover
- `cf36ed70` (2026-07-26) — fix(axis): serve example plugins from /plugins in production
- `754b433c` (2026-07-26) — fix(axis): split plugin-badge utils for bun tests; drop wrangler d.ts
- `1ef06799` (2026-07-26) — fix(axis): resolve marker time from bar_time and kind from parity events
- `4252dc9e` (2026-07-26) — fix(evaluator): Console UDT multi-dispatch, bare na, and bar-loop lock
- `95479073` (2026-07-24) — fix(chart): fix chart and volume pane CSS layout
- `6642164d` (2026-07-24) — Fix chart overlap: absolute-position the loading skeleton
- `086277c3` (2026-07-24) — Fix data window positioning: use fixed coords + getBoundingClientRect
- `aaff9631` (2026-07-24) — Fix 4 layout/UX issues: loading skeleton, auto-run demos, watchlist, data window
- `4bc3132f` (2026-07-24) — fix: stdev always returns None due to AdvancedIndicators dispatch + PineSeries initial None
- `e0854e83` (2026-07-24) — fix: dict/NoneType errors in Pyodide engine (input.int, color.new, arith)
- `40568a06` (2026-07-24) — fix: builtin dispatch only passes kwargs if handler accepts them
- `7f2d7928` (2026-07-24) — fix: SMA constant values and RSI None crash in Pyodide engine
- `c35b12d6` (2026-07-23) — fix: merge kwargs into positional args for builtins in Pyodide runtime

#### Documentation

- `6bd9c848` (2026-07-29) — docs: inline TSDoc and module headers across the codebase
- `a3ee4a19` (2026-07-29) — docs(cors): allow any localhost/127 port on Worker; skip 0.0.0.0
- `2b09f248` (2026-07-28) — docs(license): AGPL-3.0-only (not or-later)
- `8fe2058f` (2026-07-28) — docs: cross-link HOOX / pyne / axis with hoox.sh websites

#### Tests

- `1e314369` (2026-07-29) — test(engine): assert REST /run body includes execution mode

#### Chores

- `42bf3ba9` (2026-07-29) — chore(pyodide): vendor latest pyne wheel and sync bridge
- `e6040569` (2026-07-28) — chore: bootstrap standalone axis repo from pyne frontend/
- `8dff3a71` (2026-07-28) — chore(license): relicense to AGPL-3.0-or-later under jango_blockchained
- `202a0499` (2026-07-23) — chore: switch frontend + worker to Bun + TypeScript 6

#### Style

- `1ee7f8ea` (2026-07-26) — style(axis): larger drawing toolbar icons
- `432dcf51` (2026-07-26) — style(axis): swap Hell Flieder for void indigo from landing pack

#### Other

- `514b90d1` (2026-07-24) — Add copy buttons with SVG icons to status bar + results panels

### 2026-01 (1 commits)

#### Features

- `bb224279` (2026-01-13) — feat: Google Server Setup and Closed Source Transition

### 2025-10 (2 commits)

#### Features

- `38a00b82` (2025-10-24) — feat(script): Add overlay series for line chart and improve data handling

#### Other

- `5613175b` (2025-10-20) — Add technical analysis built-ins and corresponding tests

---

## How to update

1. Edit **[Unreleased]** (or the new version section) by hand for the story.
2. Regenerate the recursive history block:

```bash
python3 scripts/generate-changelog.py
```

3. Commit changelog with the release; then tag, push, publish, sync
   (see `AGENTS.md` § Changelog & releases).

