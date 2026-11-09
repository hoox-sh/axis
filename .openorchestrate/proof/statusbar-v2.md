# Status bar v2 — engineering checklist

Card: `Status bar v2: collapsed = classic scanline (Image #1); expanded = measured latency/network/app perf`

## Assertions

- [x] Collapsed (`telemetry.hud.compact` true, default) = **classic scanline**: Live · Last · Diagnostics · Compose (Server/… or eng path chips) · status message · bars / dataset · scripts · panes
- [x] Expanded (`compact` false) = **measured metrics**: Run latency samples / lastRunMs, tick→paint p50/p95/worst (`paintLatencyStats`), Path WS/REST, Eng/Src/Str/Sto plane states, feed when present — empty samples render `—` (no fakes)
- [x] Chevron / Settings **Compact status bar** semantics match: compact ↔ classic; expanded ↔ perf
- [x] Diagnostics still classic-only (Compose vs eng/run/path/src/str/sto)
- [x] Click/keyboard inspectors only (no hover/pin) — unchanged
- [x] Settings keys unchanged: `telemetry.hud.compact`, `telemetry.hud.diagnostics`; MCP `telemetry.hudCompact`
- [x] Unit: `bun test --isolate tests/hud-inspector.test.ts tests/hud-model.test.ts tests/ui-popover-shell.test.ts` → 57 pass / 0 fail
- [x] E2E: system Chromium + `AXIS_E2E_BASE=http://127.0.0.1:3000` → `e2e/statusbar.spec.ts` → 3 passed
- [x] Live screenshots below; CHANGELOG Unreleased Changed; no VERSION bump / deploy

## Screenshots

- Classic (collapsed): `.openorchestrate/proof/statusbar-v2-classic.png`
- Expanded (metrics): `.openorchestrate/proof/statusbar-v2-expanded.png`
- DOM dump: `.openorchestrate/proof/statusbar-v2-dom.json`

## Settings keys

| Key | Meaning |
| --- | --- |
| `telemetry.hud.compact` | Classic scanline when true (default). MCP `telemetry.hudCompact` |
| `telemetry.hud.diagnostics` | Classic only: raw eng/run/path/src/str/sto instead of Compose |
| panel chrome `statusbar` | Show/hide the footer strip (unchanged) |

## Verify commands

```bash
bun test --isolate tests/hud-inspector.test.ts tests/hud-model.test.ts tests/ui-popover-shell.test.ts
# with Vite on :3000 and system Chromium:
AXIS_E2E_BASE=http://127.0.0.1:3000 bunx playwright test e2e/statusbar.spec.ts
```

## Files

- `src/ui/StatusBar.tsx`, `src/ui/ConnectionHud.tsx`, `src/ui/telemetry.ts`
- `src/ui/settings/SettingsPage.tsx`, `src/store/types.ts`, `src/store/index.ts`
- `tests/hud-inspector.test.ts`, `e2e/statusbar.spec.ts`, `CHANGELOG.md`
