# Changelog

All notable changes to **AXIS** (`hoox-sh/axis`) are documented in this file.

This changelog is **recursive**: it lists the full git history of the
repository, grouped by month and conventional-commit type. Agents and
humans **must keep it updated** on every release (see `AGENTS.md` § Changelog & releases).

Format roughly follows [Keep a Changelog](https://keepachangelog.com/) with
commit SHAs for traceability.

_Generated/updated: 2026-08-11 · 196 commits · describe-tag: `v2.0.3`_

---

## [Unreleased]

_Nothing yet — next changes land here._

## [2.0.4] — 2026-08-11

Script Logs / System Logs naming and dockable Status + System Logs panes.

### Changed

- **Script Logs / System Logs** — Script `log.*` pane titled **Script Logs** (editor tool + panel); app telemetry titled **System Logs** (no bare “Logs”).
- **Dockable Status & System Logs** — Status bar and System Logs are FloatableShell panes (`statusbar`, `logs`); closable/dockable like Results. Topbar toggles: **Script Logs**, **System Logs**, **Status**.

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

## Full history (recursive)

### 2026-08 (114 commits)

#### Security

- `ebfc9955` (2026-08-07) — harden chart, data, and run paths for performance and crash resilience

#### Features

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

- `cb901eb4` (2026-08-10) — perf: full-app hardening — live ticks, overlays, load abort, boot split
- `a9f57958` (2026-08-10) — perf(chart): heavy history paint, conflation, and O(1) live ticks

#### Refactors

- `f19fe9a2` (2026-08-08) — refactor: rename remaining pine-* modules to pyne-*
- `18eedc78` (2026-08-08) — refactor: rename pine-language/lsp/builtins editor stack to pyne-*
- `096a799f` (2026-08-08) — refactor: rename pine-editor CSS, DOM, and PyneEditor component
- `b52526af` (2026-08-08) — refactor: rename pine-editor.js to pyne-editor.js
- `f0a1446b` (2026-08-02) — refactor: rename chart palette TV→VOID; document Pine naming parity

#### Documentation

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

- `3ddc4193` (2026-08-10) — ci(docker): fix image build, enhance make targets, add GHCR workflow
- `5b4bbef4` (2026-08-10) — ci: build Tauri desktop app on every main push

#### Chores

- `12cffe27` (2026-08-11) — chore: ignore local multi-agent sync notice files
- `33e11930` (2026-08-06) — chore(worker): gitignore wrangler.toml and ship example
- `9cb4dad0` (2026-08-06) — chore: vendor latest pyne 0.3.0 wheel (parity Aug 6)
- `9fba8aaf` (2026-08-03) — chore: rename SuperChart branding to AXIS including CF project id
- `0cbda10b` (2026-08-01) — chore(pyodide): vendor pynescript 0.3.0 wheel with drawing GC

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

