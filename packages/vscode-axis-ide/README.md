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

This is the **0.1.0** scaffold with protocol, SecretStorage, and the **`axis.chart`** custom editor shell:

- Activation without `onStartupFinished` (workspace globs + commands + `onCustomEditor:axis.chart`)
- Output channel **AXIS Run** (`AXIS: Show Run Output`)
- Status bar item (`axis.ide.status`) with Worker/Pro key **set/missing** marks (never values)
- **AXIS Chart** custom editor on `*.axis.json` (CSP webview shell; LWC paint next)
- Stub **AXIS: Open Chart** (sibling file create lands next)
- Optional setting `axis.telemetry.offline` (default `true`)
- Typed host↔webview envelope codecs under `src/protocol/` (coverage-gated)
- Worker (`pn_…`) / Pro (`pyn_…`) keys via `axis.secrets.*` → `ExtensionContext.secrets` only

MCP provider and Results webviews ship later.

## Build layout

| Artifact | Path | Notes |
| --- | --- | --- |
| Extension host bundle | **`out/extension.js`** | Produced by `esbuild.host.mjs` (PYNE parity). **Do not move the host entry to `dist/`.** |
| Chart webview assets | **`dist/webview/chart/`** | Vite build (`compile:webview`); CSP HTML is host-generated. |

## Requirements

- VS Code / compatible editor `^1.95.0`
- **PYNE Language Support** `hoox-sh.pyne` (installed via `extensionDependencies`; use **≥ 0.5.4** when possible)

## Activation

Activates on P0 commands and when the workspace contains AXIS/Pine sources. Pine globs intentionally match the PYNE language extension list: `*.pyne`, `*.pine`, `*.pinev5`, `*.pinev6`, `*.pinescript`, plus `*.axis.json`.

## Commands

| Command | Id |
| --- | --- |
| AXIS: Show Run Output | `axis.showRunOutput` |
| AXIS: Open Chart | `axis.openChart` (stub) |
| AXIS: Set Worker API Key | `axis.secrets.setWorkerKey` |
| AXIS: Set Pro API Key | `axis.secrets.setProKey` |
| AXIS: Clear Stored Secrets | `axis.secrets.clear` (Worker + Pro) |

Worker keys must match `/^pn_[a-f0-9]{48}$/`. Pro keys require `pyn_` + 20–508 `[A-Za-z0-9_-]`. Empty input clears that slot. Keys are **never** `contributes.configuration` properties (no `axis.worker.apiKey` / `axis.pro.apiKey` settings).

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| `axis.telemetry.offline` | `true` | Keep product telemetry off |

Secrets are **not** settings — use the `axis.secrets.*` commands above.

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

GNU Affero General Public License **version 3 only** (SPDX: `AGPL-3.0-only`). See [LICENSE](./LICENSE) and the AXIS root `NOTICE`.
