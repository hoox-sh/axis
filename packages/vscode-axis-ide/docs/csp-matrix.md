# AXIS IDE webview CSP matrix

Audit against design KD-6 / CSP matrix (Task 25 + Task 27). **Do not widen runtime CSP
without updating this doc** (and README).

HTML is host-generated (`src/editors/chart-html.ts`, `src/views/results-html.ts`)
with `webview.cspSource` — never hard-coded `vscode-resource:` / `https:`.

Optional Pyodide widen is gated by **`axis.engine.allowPyodide`** (default **false**).
Runtime helper: `buildChartCspDirectives(cspSource, allowPyodide)` in
`src/editors/chart-html.ts`. Version lock: `LOCAL_PYODIDE_VERSION = '0.29.5'` in
`src/host/pyodide-profile.ts` (calculator / bars-in only — not stream-owning; Wasm
assets are **not** shipped in this VSIX).

## Enforced (chart + results / strategy) — default

| Directive | Chart (`axis.chart`) | Results / Strategy (`axis.results` / `axis.strategy`) |
| --- | --- | --- |
| `default-src` | `'none'` | `'none'` |
| `base-uri` | `'none'` | `'none'` |
| `form-action` | `'none'` | `'none'` |
| `script-src` | `${webview.cspSource}` | `${webview.cspSource}` |
| `style-src` | `${webview.cspSource} 'unsafe-inline'` | `${webview.cspSource} 'unsafe-inline'` |
| `img-src` | `${webview.cspSource} data: blob:` | `${webview.cspSource} data: blob:` |
| `connect-src` | `'none'` | `'none'` |
| `worker-src` | _(omitted)_ | _(omitted)_ |
| Inline `<script>` | **Forbidden** (src= only) | **Forbidden** (src= only) |

`style-src 'unsafe-inline'` covers VS Code theme CSS variables. Scripts and
styles load via `asWebviewUri` from `dist/webview/{chart,results}/` under
`localResourceRoots`. Lightweight Charts is bundled into the chart `main.js`
(no CDN).

## vs AXIS PWA (`public/_headers`)

| Directive | PWA | IDE webviews (default) |
| --- | --- | --- |
| `default-src` | `'self'` | `'none'` |
| `script-src` | `'self'` + nonce + `wasm-unsafe-eval` + agent worker | `${webview.cspSource}` only |
| `style-src` | `'self' 'unsafe-inline'` | `${webview.cspSource} 'unsafe-inline'` |
| `img-src` | `'self' data: blob:` | `${webview.cspSource} data: blob:` |
| `connect-src` | `'self' https: wss:` + localhost | **`'none'`** — host proxies network |
| `worker-src` | `'self' blob:` | omitted until Pyodide flag on |
| COOP / COEP | same-origin / credentialless | N/A (VS Code iframe) |

**Default policy:** extension host owns `fetch` / WS (Pro `/run`, Worker live
tickets, datafeed). Webviews are paint / UI only. That keeps `connect-src
'none'` and matches KD-6.

## Optional widen (`axis.engine.allowPyodide` — off by default)

When `axis.engine.allowPyodide` is **true**, the **chart** webview CSP only is
widened via `buildChartCspDirectives(..., true)` / `buildChartWebviewHtml({ allowPyodide: true })`:

| Directive | Value |
| --- | --- |
| `script-src` | `${webview.cspSource} 'wasm-unsafe-eval'` |
| `worker-src` | `blob: ${webview.cspSource}` |

All other directives stay on the paint-only matrix (`connect-src 'none'`, no
inline script). Results / Strategy stay paint-only unless a future task documents
otherwise.

**Enable path checklist**

1. Setting default remains **false** in `package.json` / contributes fragment.
2. Host reads the flag when building chart HTML (`chart-editor` → `allowPyodide`).
3. Calculator profile is bars-in only (`src/host/pyodide-profile.ts`); do not treat
   Pyodide as stream-owning.
4. Do **not** vendor multi-MB Pyodide under `dist/` / VSIX until a dedicated task
   ships assets; flag + CSP alone do not load Wasm.
5. Update this matrix + README whenever the widen set changes.
