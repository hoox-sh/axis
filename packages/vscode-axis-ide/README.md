# AXIS IDE

**VS Code extension** that brings the [AXIS](https://hoox.sh/axis) charting IDE beside Pine / PYNE buffers — run orchestration, charts, results, and live sessions inside the editor.

| | |
| --- | --- |
| **Extension id** | `hoox-sh.axis-ide` |
| **License** | [AGPL-3.0-only](./LICENSE) |
| **Hard dependency** | [`hoox-sh.pyne`](https://marketplace.visualstudio.com/items?itemName=hoox-sh.pyne) (PYNE Language Support) — **recommended ≥ 0.5.4** |

Part of the **[HOOX](https://hoox.sh) open trading stack**. Sister products: **[PYNE](https://hoox.sh/pyne)** (Pine language tooling) and **[HOOX](https://hoox.sh)** (edge execution).

> Independent, unofficial extension. **Not** affiliated with, endorsed by, or sponsored by TradingView, Inc.
> Pine Script™ and TradingView® are trademarks of TradingView, Inc.

## Status

This is the **0.1.0** scaffold with protocol, SecretStorage, **`axis.chart`**, HistoryClient, Open Chart, and Run:

- Activation without `onStartupFinished` (workspace globs + commands + `onCustomEditor:axis.chart`)
- Output channel **AXIS Run** (`AXIS: Show Run Output`)
- Status bar item (`axis.ide.status`) with Worker/Pro key **set/missing** marks (never values)
- **AXIS Chart** custom editor on `*.axis.json` (CSP webview + bundled Lightweight Charts; mock or datafeed `chart.full`)
- **AXIS: Open Chart** opens or creates a sibling `*.axis.json` beside the active Pine file (editor title menu; existing files are not rewritten)
- **AXIS: Run Script** (`Ctrl/Cmd+Enter`) → Pro `/run` on HistoryClient venue bars (default) or mock bars when `axis.chart.useMockBars` is true; paints `chart.full` candles or `axis-run` diagnostics; Silent variant skips Results focus / error toasts
- **Results / Strategy** panel WebviewViews (`axis.results` / `axis.strategy`) with §7.1 focus rules; **AXIS: Focus Results** retargets the open run
- Activity-bar TreeViews: Library / Layers / Scripts (no watchlist yet)
- Settings: `axis.telemetry.offline`, `axis.engine.id` (`server` only for now), `axis.engine.endpoint` (loopback by default; remote needs `axis.engine.allowRemoteEndpoint`), `axis.chart.useMockBars` / `historyBars`, `axis.datafeed.url`
- Plot/drawing overlays from engine results are carried on `chart.full.plots` but **webview plot paint is deferred** (candles only in PR-06)
- Typed host↔webview envelope codecs under `src/protocol/` (coverage-gated)
- Worker (`pn_…`) / Pro (`pyn_…`) keys via `axis.secrets.*` → `ExtensionContext.secrets` only

MCP provider and plot overlays ship later.

## Build layout

| Artifact | Path | Notes |
| --- | --- | --- |
| Extension host bundle | **`out/extension.js`** | Produced by `esbuild.host.mjs` (PYNE parity). **Do not move the host entry to `dist/`.** |
| Chart webview assets | **`dist/webview/chart/`** | Vite build (`compile:webview:chart`); CSP HTML is host-generated. |
| Results webview assets | **`dist/webview/results/`** | Shared Results/Strategy Vite bundle (`compile:webview:results`). |

## Requirements

- VS Code / compatible editor `^1.95.0`
- **PYNE Language Support** `hoox-sh.pyne` (installed via `extensionDependencies`; use **≥ 0.5.4** when possible)

## Activation

Activates on P0 commands and when the workspace contains AXIS/Pine sources. Pine globs intentionally match the PYNE language extension list: `*.pyne`, `*.pine`, `*.pinev5`, `*.pinev6`, `*.pinescript`, plus `*.axis.json`.

## Commands

| Command | Id |
| --- | --- |
| AXIS: Show Run Output | `axis.showRunOutput` |
| AXIS: Open Chart | `axis.openChart` (open/create sibling `*.axis.json`) |
| AXIS: Run Script | `axis.runScript` (Ctrl/Cmd+Enter on pinescript) |
| AXIS: Run Script (Silent) | `axis.runScriptSilent` |
| AXIS: Set Worker API Key | `axis.secrets.setWorkerKey` |
| AXIS: Set Pro API Key | `axis.secrets.setProKey` |
| AXIS: Clear Stored Secrets | `axis.secrets.clear` (Worker + Pro) |

### SecretStorage UX (`axis.secrets.*`)

Keys live only in `ExtensionContext.secrets` (VS Code SecretStorage):

| Slot | Prefix / shape | Commands |
| --- | --- | --- |
| Worker API key | `/^pn_[a-f0-9]{48}$/` | `axis.secrets.setWorkerKey` |
| Pro API key | `pyn_` + 20–508 `[A-Za-z0-9_-]` | `axis.secrets.setProKey` |
| Both | — | `axis.secrets.clear` (confirm; deletes Worker + Pro) |

- Set flows use `showInputBox({ password: true })`; invalid input is rejected **before** store.
- Empty input on a set command clears that slot.
- Status bar shows Worker/Pro **set/missing** only — never key material.
- Keys are **never** `contributes.configuration` properties (no `axis.worker.apiKey` / `axis.pro.apiKey`).
- Run / live paths read SecretStorage only (no plaintext PYNE settings import — Q5).

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| `axis.telemetry.offline` | `true` | Keep product telemetry off |
| `axis.engine.id` | `server` | Pro `/run` only in this release |
| `axis.engine.endpoint` | `http://127.0.0.1:5002` | Pro base URL (no `/run` suffix); loopback unless remote allowed |
| `axis.engine.allowRemoteEndpoint` | `false` | Opt-in before sending Bearer off-machine (**application** scope — workspace cannot enable) |
| `axis.engine.allowPyodide` | `false` | Opt-in chart CSP widen for optional Pyodide calculator (`wasm-unsafe-eval` + `worker-src blob:`). Bars-in only; **Wasm assets not shipped** in this VSIX (version lock `0.29.5`) |
| `axis.chart.useMockBars` | `false` | Opt-in mock/fixture bars for chart + run. Default **false** uses real history via datafeed |
| `axis.chart.historyBars` | `1500` | Default history window (clamped ≤20000) |
| `axis.datafeed.url` | `http://127.0.0.1:5003` | Local axis-datafeed base (`GET /datafeed/ohlcv`); remote needs `axis.engine.allowRemoteEndpoint` |

**Real history (default):** start `@hoox-sh/axis-datafeed` on `:5003`. Chart clears then paints fetched bars (`chart.full` seq above handshake); runs fail clearly if fetch fails (no empty `/run` body, no silent mock). Set `axis.chart.useMockBars` to **true** only for offline/fixture dogfood.

Secrets are **not** settings — use the `axis.secrets.*` commands above.

## Webview CSP

Chart and Results/Strategy webviews share a paint-only CSP (host proxies network):

| Directive | Value |
| --- | --- |
| `default-src` | `'none'` |
| `script-src` | `${webview.cspSource}` (no inline script) |
| `style-src` | `${webview.cspSource} 'unsafe-inline'` |
| `img-src` | `${webview.cspSource} data: blob:` |
| `connect-src` | `'none'` |

When **`axis.engine.allowPyodide`** is enabled (default **false**), the **chart**
webview only adds `'wasm-unsafe-eval'` to `script-src` and
`worker-src blob: ${webview.cspSource}` (helper `buildChartCspDirectives`).
Results/Strategy stay paint-only. Pyodide remains a bars-in calculator stub
(`LOCAL_PYODIDE_VERSION = '0.29.5'`); multi-MB Wasm is not packaged in the VSIX yet.

Full matrix vs the AXIS PWA and the Pyodide enable path: [docs/csp-matrix.md](./docs/csp-matrix.md). Do not change runtime CSP without updating that doc.

## Develop

Use **`bun run --cwd <pkg> <script>`** (flag after `run`). On current Bun, `bun --cwd <pkg> run <script>` can exit 0 without executing the script.

```bash
bun install --cwd packages/vscode-axis-ide   # or npm install
bun run --cwd packages/vscode-axis-ide compile              # host esbuild + chart Vite webview
bun run --cwd packages/vscode-axis-ide compile:webview      # Vite → dist/webview/chart only
bun run --cwd packages/vscode-axis-ide check                # tsc host + webview/chart
bun run --cwd packages/vscode-axis-ide watch:webview        # Vite watch (pair with watch)
bun run --cwd packages/vscode-axis-ide test:unit            # bun:test (protocol, editors, secrets, coverage script)
bun run --cwd packages/vscode-axis-ide test:coverage        # unit + lcov under coverage/
bun run --cwd packages/vscode-axis-ide test:coverage:gate   # coverage + BASELINE/protocol ratchet
bun run --cwd packages/vscode-axis-ide test                 # @vscode/test-electron
bun run --cwd packages/vscode-axis-ide package              # → axis-ide-0.1.0.vsix (runs vscode:prepublish → compile)
```

Root aliases: `bun run vscode:ide:compile` / `vscode:ide:test` / `vscode:ide:test:coverage:gate` / `vscode:ide:package`.

Electron tests need `hoox-sh.pyne` installed into the downloaded VS Code. By default the harness globs `pyne-vscode-*.vsix` from a sibling `pynescript` / `pyne` checkout. Override with `AXIS_IDE_PYNE_VSIX=/path/to/pyne-vscode-….vsix`. In CI (`CI` / `GITHUB_ACTIONS`), a missing or failed install **hard-fails**.

## License

GNU Affero General Public License **version 3 only** (SPDX: `AGPL-3.0-only`). See [LICENSE](./LICENSE) and package [NOTICE](./NOTICE) (lists **TradingView Lightweight Charts™** Apache-2.0 and other third-party). File headers must not say “or later”. Sister extension `hoox-sh.pyne` remains AGPL-3.0-or-later — do not relicense it.
