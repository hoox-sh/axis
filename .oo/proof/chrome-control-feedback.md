# Shared chrome control feedback — engineering draft

Card: Polish highest-level CSS: details, micro-actions, and feedback on shared chrome

## Checklist

- [x] `.sc-btn` / `.sc-chip` / capsules / live / module press is `translateY(var(--ui-press-y))` (1px), not scale bounce
- [x] `:focus-visible` uses inset ring + `outline-offset: -1px` (no layout jump)
- [x] Disabled / `aria-disabled` opacity + `not-allowed`; busy `wait` + `--ui-busy-opacity`
- [x] `.sc-chip` selected = inset ring, not accent border swap; font-weight stays 500
- [x] Status strip gap/pad/capsule height are tokens; capsule type `max(10px, …)`
- [x] `prefers-reduced-motion` zeros press transform
- [x] `--ui-scale` and 10px floor kept
- [x] `PANEL_LIFT` / `ELEV_LIFT` / `EDGE_MIN` not reopened; panel fill hex not touched
- [x] HUD hover-bridge not resurrected (no `.axis-hud-info:hover` / `hover-bridge`)
- [x] Native `<details>` conversion skipped (no shared accordion faked with hover)
- [x] CHANGELOG Unreleased Changed
- [x] Tests: `bun test --isolate tests/phase4-ux-tokens.test.ts tests/theme-manager.test.ts tests/shell-chrome-tokens.test.ts` → 68/0
- [x] `biome check --diagnostic-level=error` on touched files → exit 0
- [ ] Live click of press/focus in a running app (browser was `about:blank`; no :5173)

## Refused

- Restyling every panel/component
- Second theme
- Chart canvas / live tick / loader animation
- Status-bar HUD hover panel markup
- Converting library/settings disclosures to `<details>`
