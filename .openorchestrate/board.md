# Board

> One place for work. Statuses: Todo · Working · Blocked · Ready for Review · Done.
> Nothing is done until this file says Done.

| task                                                                                                                  | owner      | status | priority | proof                                                                                                                                                                                                                                                                                                                                                                                                                                           | blockedReason | source   |
| --------------------------------------------------------------------------------------------------------------------- | ---------- | ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------- |
| Unify app panel contrast tokens and enforce a 10px minimum font size across the UI                                    | oo-checker | Done   |          | PASS (Checker accepted). Checked: `buildChromeCssVars` floors PANEL_LIFT=1.12 / ELEV_LIFT=1.06 / TEXT_MIN=4.5 / FAINT_MIN=3.2 / EDGE_MIN=3 via liftSurface + ensureContrastOn; loud→quiet then EDGE_MIN; `--color-border-soft` not forced to EDGE_MIN; suite `chrome contrast floors` (8 presets + flat lift + loud+EDGE_MIN); CHANGELOG Unreleased; attached verify 57/0 + lint exit 0. Font floor slices 1–4 prior.                           |               | continue |
| Revert theme chrome beyond inputs/buttons: undo window/panel/border theme changes; keep only input and button styling | oo-spec-2  | Done   |          | Engineering draft. Reverted `PANEL_LIFT`/`ELEV_LIFT`/`EDGE_MIN` (`apply.ts` = HEAD); restored panel/border tokens (`#0c0e14` / `#262d3d` / `#1e2430`) + translucent float/card fills; kept 10px font floors + input/button control CSS. Dropped `chrome contrast floors` suite. Proof: `bun test --isolate tests/theme-manager.test.ts` → 47/0; biome errors-level clean on theme files; before/after + checklist attached via oo_proof_attach. |               |          |

## Rules

- Every card has one owner.
- Five statuses, no more: Todo · Working · Blocked · Ready for Review · Done.
- If you are stuck, set Blocked, write why, and ping the Chief.
- Pass work as a handoff, not a transcript.
- A card moves to Done only with proof attached.

## Handoff format

```text
from:
to:
objective:
artifacts:
decisions:
open questions:
next gate:
```
