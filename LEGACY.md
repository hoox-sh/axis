# Legacy static shell (pre-Solid)

The AXIS product path is:

```text
bun run dev          → Vite + Solid (`src/index.tsx`)
bun run build        → `dist/` served by `axis_pwa_server.py` / CF Pages
```

## What is legacy

| Path | Role |
|------|------|
| `src/main.js` | Old bootstrap (chart.js, legacy-topbar.js, legacy-watchlist.js, …) |
| `src/registry.js` + `registry.d.ts` | Pre-Solid plugin registry — singleton is `legacyRegistry` |
| `src/registry-bootstrap.js` | Side-effect builtin registration for the old shell |
| `src/sources/index.js`, `src/streams/index.js`, `src/engines/index.js` | Legacy builtin plugin barrels (typed by `plugin-types.d.ts`) |
| `src/state.js`, `src/state-hash.js` | Pre-Solid store + URL hash hydration |
| `src/ui/{manager,legacy-topbar,legacy-watchlist,settings,status,symbol-autocomplete,tabbed-editor,results}.js` | Legacy DOM UI |
| `style.css` | TV-blue-era tokens |
| `pyne-editor.js` | Pre-Solid CM6 wiring (was `pine-editor.js`) |
| `server.ts` | Bun static server for the old tree |
| Root `sw.js` | Service worker for static shell |

## What is current

| Path | Role |
|------|------|
| `src/index.tsx` / `src/app.tsx` | Solid app |
| `src/chart/ChartHost.tsx` | LWC panes (imperative container split from Solid) |
| `src/plugins/registry.ts` | Shipping plugin registry — singleton is `registry` |
| `src/{sources,streams,engines}/catalog.ts` | Shipping builtin catalogs |
| `src/ui/*` | Topbar, Settings, Results, Logs, … |
| `public/` + `bun run build` | Production PWA assets |

Legacy files remain so `bun test` (static server) and historical scripts keep
working. They are not the shipping UI.

## Verified not reachable from the product

Traced the real import graph from `src/index.tsx`: **none** of the legacy files
above are reachable, and none appear in `dist/` after `bun run build`. The only
consumers are `tests/registry.test.ts`, `tests/state.test.ts`, and
`tests/server.test.ts` (which fetches `/src/main.js` over HTTP to check MIME
types). Roughly 3,900 lines total.

That makes deleting this tree a **product decision** about `LEGACY.md`, not a
refactor — do not delete it as drive-by cleanup. The two plugin registries are
deliberately kept distinct: the legacy singleton is exported as
`legacyRegistry` so it cannot be confused with the shipping `registry`.
