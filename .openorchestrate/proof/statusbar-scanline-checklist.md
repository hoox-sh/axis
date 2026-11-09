# Status-bar scanline — engineering checklist

Card: Refactor status bar: drop HUD hover container, ship a new always-visible concept

- [x] Hover no longer opens any status/HUD container (`onMouseEnter` / hover-bridge / pin removed from ConnectionHud)
- [x] Click / keyboard opens a `role=dialog` inspector above the rail (shared Popover, `side=top`, `aria-modal`)
- [x] Esc / outside / second click closes (dialog is modal so `app.escape` does not swallow Esc)
- [x] Scanline still shows Live, Last, Compose/diagnostics, status message, bars, dataset, scripts/panes
- [x] Unit: `bun test --isolate tests/hud-inspector.test.ts tests/hud-model.test.ts tests/ui-popover-shell.test.ts` → 42 pass / 0 fail
- [x] E2E: `AXIS_E2E_BASE=http://127.0.0.1:3000 bunx playwright test e2e/statusbar.spec.ts` → 2 passed
- [x] Live Chrome: hover Live chip → no dialog; click → dialog "LIVE — stream arm"
- [x] CHANGELOG Unreleased Changed; no VERSION bump / deploy
