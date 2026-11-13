# P2 — tipBlankResumeAt leak in live-wire teardown

Date: 2026-11-13
Card: "P2: delete tipBlankResumeAt entry in live-wire release()/dropScriptLocal"
Source: `.openorchestrate/proof/code-optimization-analysis-2026-11-13.md`, finding 5.

## What changed

- `src/engine/live-wire.ts` — `dropScriptLocal()` now deletes `this.tipBlankResumeAt.delete(subId)`
  alongside the other per-subscription teardown deletes (next to `scriptDepth`).
  `release()` calls `dropScriptLocal()` first, so both teardown paths are covered by the
  one delete. No other behavior changed; `tipBlankResumeAt` is script-subscription state
  only (set/cleared in `streamEvalScript`'s tip-blank branch), so the series-only deletes
  in `release()` were left untouched.
- `tests/engine/live-wire.test.ts` — two focused tests appended:
  1. `release()` drops the `tipBlankResumeAt` entry for the torn-down sub (and leaves other subs' entries alone).
  2. Server release ack path (`status: idle/released` → `dropScriptLocal`) drops the entry.

## Tests run

```
bun test --isolate tests/engine/live-wire.test.ts
 83 pass
 0 fail
 383 expect() calls
 Ran 83 tests across 1 file. [1358.00ms]
```

(81 pre-existing + 2 new.)

## Notes / surprises

- `release()` does not need its own delete: it delegates to `dropScriptLocal()` as its
  first statement, so a single delete there covers both paths. Adding a second delete in
  `release()` would be redundant.
- The append-point is inside the last `describe` block of the test file; no other tests touched.
- No unrelated files were modified by this change (pre-existing modifications to
  store/index.ts, pane-manager.ts, live-append.ts, multiplex.ts, etc. were left as found).
- No commits, no push, no deploys.
