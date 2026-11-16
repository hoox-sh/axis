# P2: First-use — engineering proof

Date: 2026-11-09
Seat: oo-spec-2 (draft)

```text
from: oo-spec-2
to: oo-checker
objective: First visit knows to Run the prefilled script; Add is not two verbs; ~800px topbar wraps instead of clipping.
artifacts:
  - src/ui/RunSplitButton.tsx
  - src/ui/first-run.ts
  - src/ui/FirstRunHint.tsx
  - src/editor/default-script.ts
  - src/chart/ChartHost.tsx
  - src/indicators/builtins/apply.ts
  - src/index.css
  - tests/first-run.test.ts
  - CHANGELOG.md [Unreleased]
decisions:
  - Editor primary = Run (never a bare Add). Topbar primary = Add to chart on first apply, Run when an instance exists. Caret = Add instance or built-in.
  - One empty-chart Run chip (axis-first-run), dismiss once via axis.firstUse.runHintDismissed. Not a tour.
  - Do not auto-open Scripts on builtin apply — the plot already landed.
  - Wrap command/module bars at max-width 900px; keep the Run/Add-to-chart label; hide other captions.
open questions:
  - Live 800×600 after-shot needs a local app or Pages ship (no :3000/:5173 this gate).
next gate: Checker re-runs tests and decides Done.
```

## Copy

| Surface | Before | After |
| --- | --- | --- |
| Editor split primary | Add | Run |
| Topbar split primary (0 instances) | Add | Add to chart |
| Topbar split primary (instance on chart) | Add | Run |
| Split caret aria | More add options | Add instance or built-in |
| Empty chart | nothing | Run RSI chip |
| Builtin apply | opens Scripts | stays closed |

## Verify

```text
bun test --isolate tests/first-run.test.ts tests/builtin-scripts.test.ts tests/chart-boot.test.ts tests/shell-chrome-tokens.test.ts tests/ui-popover-shell.test.ts
```

Result: **43 pass, 0 fail**, exit 0.

No local Vite this gate (`curl` :3000 and :5173 → 000). ~800px checked via CSS `@media (max-width: 900px)` wrap + `overflow-x: visible` (not auto clip) in `tests/first-run.test.ts`.

P1 Last/Live and scanline HUD work on this tree was left in place.
