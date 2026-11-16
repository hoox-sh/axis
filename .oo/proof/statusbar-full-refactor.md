# Full status-bar refactor — engineering checklist

Card: `Full status-bar refactor: no pinned/hover cards; animated CSS icons + metrics; collapsible compact HUD; settings aligned`

## Assertions

- [x] No hover-open / pinned hover cards on status bar / HUD (`onMouseEnter` / hover-bridge / pin absent from ConnectionHud)
- [x] Inspectors open by click / keyboard only (`Popover` `role=dialog` `side=top`)
- [x] Collapse control (`axis-statusbar-collapse`) toggles `telemetry.hud.compact`
- [x] Collapsed (`data-compact=1`) = Live + Last (+ chevron) only — no Compose / status message / bars
- [x] Expanded = full scanline (Compose/diagnostics, status, bars, dataset, scripts/panes)
- [x] Settings: **Compact status bar** + **Connection diagnostics** labels match behavior; both persist via store (`flushPersist` on toggle)
- [x] CSS metric glyphs for Live / Last / Compose / Diagnostics / plane chips; `prefers-reduced-motion` disables their animations
- [x] Unit: `bun test --isolate tests/hud-inspector.test.ts tests/hud-model.test.ts tests/ui-popover-shell.test.ts` → 54 pass / 0 fail
- [x] E2E: `AXIS_E2E_BASE=http://127.0.0.1:3000 bunx playwright test e2e/statusbar.spec.ts` → 3 passed (click inspector, compose, collapse)
- [x] Live Chrome: expanded + collapsed screenshots below
- [x] CHANGELOG Unreleased Changed; no VERSION bump / deploy

## Screenshots

- Expanded: `.openorchestrate/proof/statusbar-expanded.png`
- Collapsed: `.openorchestrate/proof/statusbar-collapsed.png`

## Settings keys

| Key | Meaning |
| --- | --- |
| `telemetry.hud.compact` | Collapsed bar = compact HUD (Live + Last). MCP `telemetry.hudCompact` |
| `telemetry.hud.diagnostics` | Expanded only: raw eng/run/path/src/str/sto instead of Compose |
| panel chrome `statusbar` | Show/hide the footer strip (unchanged) |

## Files

- `src/ui/StatusBar.tsx`, `src/ui/ConnectionHud.tsx`, `src/index.css`
- `src/ui/settings/SettingsPage.tsx`, `src/store/types.ts`
- `tests/hud-inspector.test.ts`, `e2e/statusbar.spec.ts`
