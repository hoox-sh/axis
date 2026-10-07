# Legacy static shell (pre-Solid) — removed

The AXIS product path:

```text
bun run dev          → Vite + Solid (`src/index.tsx`)
bun run build        → `dist/` served by CF Pages
```

## Removed in 2.21.0

The pre-Solid static shell (~3,900 lines) was deleted. Before deleting it, the
real import graph was traced from `src/index.tsx`: **no** legacy file was
reachable and none appeared in `dist/` after `bun run build`. The only
consumers were three tests.

| Deleted | Role |
|---------|------|
| `src/main.js` | Old bootstrap |
| `src/registry.js`, `src/registry.d.ts` | Pre-Solid plugin registry |
| `src/registry-bootstrap.js` | Side-effect builtin registration for the old shell |
| `src/plugin-types.d.ts` | Ambient typings for the legacy `.js` plugin barrels |
| `src/chart.js` | Pre-Solid chart container |
| `src/state.js`, `src/state-hash.js` | Pre-Solid store + URL hash hydration |
| `src/sources/index.js`, `src/streams/index.js`, `src/engines/index.js` | Legacy builtin plugin barrels |
| `src/ui/{manager,legacy-topbar,legacy-watchlist,settings,status,symbol-autocomplete,tabbed-editor,results}.js` | Legacy DOM UI |
| `pyne-editor.js` | Pre-Solid CM6 wiring |
| `style.css` | TV-blue-era tokens |
| `storage.js` | Unused |
| `server.ts` | Bun static server for the old tree |
| Root `sw.js` | Duplicate service worker (`public/sw.js` is the only one) |
| `tests/{registry,state,server}.test.ts` | Tests of the deleted files only |

Also dropped from `tests/sw-strategy.test.ts` the "public/sw.js and sw.js are
equal" guard — it existed only to keep the duplicate in sync, and
`public/sw.js` is now the single service worker that `/sw.js` serves and
`src/pwa/register-sw.ts` registers.

## Current paths

| Path | Role |
|------|------|
| `src/index.tsx` / `src/app.tsx` | Solid app |
| `src/chart/ChartHost.tsx` | LWC panes (imperative container split from Solid) |
| `src/plugins/registry.ts` | Plugin registry — singleton is `registry` |
| `src/{sources,streams,engines}/catalog.ts` | Builtin catalogs |
| `src/ui/*` | Topbar, Settings, Results, Logs, … |
| `public/` + `bun run build` | Production PWA assets |

There is no `frontend/` directory and no `make run-frontend` target. To serve a
static build locally, run `bun run build` and serve `dist/`.