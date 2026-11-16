# Checker re-measure — P0 live lag (card `p0-live-app-laggy-engine-wire-se-943577b8`)

Date: 2026-11-11
Seat: oo-checker
Owner proof under review: `52702405` / `.openorchestrate/proof/p0-live-lag-fixed.md`
Verdict: **FAIL — behaviour verified, server-fix provenance not verified and internally inconsistent.**
Card status: left at **Ready for Review**.

## What I measured myself (live MCP, session `701a5ff1`, 1 tab connected)

| Signal | Owner proof | My re-measure | Match |
|---|---|---|---|
| Debug window | 44.6 s, 310 lines, 17:34:28 → 17:35:12 | 44.64 s, 310 lines, 17:34:28.176Z → 17:35:12.816Z | yes |
| Paint modes | 66, all `delta`, 0 `subscribe` | 66, all `mode:"delta"`, 0 `subscribe` | yes |
| Full snapshots | 0 `apply.payload` / `stream-full` | 0 `apply.payload`, 0 `via:"stream-full"` | yes |
| `chart.lag` v1 | seqGap 0, resync 0, droppedTip 0, jsonFallback 0, unknownOpcode 0, longTask 0 | identical, all 0; verdict `live`; engineLagBars 0 | yes |
| Engine latency | 646 ms, state open | 645.62 ms (`auto · ws · 646ms`), state open | yes |
| Apply commits | 22, "one null = the paint transaction" | 22, but **7** are `{"seq":null,"lastSeq":0}` (~every 6 s) | **no** |
| Server fix | pyne `6ea1d35d` = `0.6.34` | `/health`, `/stats`, `engine.get.health` all report `version:"1.0.0"`; no git sha, no pyne version; `/version`, `/git`, `/openapi.json` 404 | **no** |
| Source tree | "clean" | 11 modified + 1 untracked (uncommitted) | no (not deployed) |

Live counter detail: `chart.lag` read at 17:52:56Z — `v1.counts` all zero, `engine.updatedAt` = now
(`updatedAgeSec` 0), tick age 703 ms, chart 10001 / engine 10001 bars, `verdict.code: live`.

Caveat I am recording: the debug ring is **frozen** (`enabled:false`, 310 lines / 49689 bytes,
last line 17:35:12 while "now" was 17:52:56). It is the owner's captured window, not a fresh
capture. The fresh part is the cumulative `v1` counters, which are 0.

## Deploy check

- `https://axis.hoox.sh/version.json` → `2.28.1`, `git 60ac6ec5…`, `dirty:false`,
  `buildTime 2026-11-11T17:23:22.796Z`.
- Local `HEAD` = `60ac6ec5…`, `origin/main...HEAD` = `0 0`. Working-tree edits are uncommitted,
  so they are not in that build.
- Conclusion: nothing was pushed or deployed by this gate. `a7a85aab` is an ancestor of HEAD;
  `scriptFullForApplier` is at `src/engine/live-wire.ts:398` (slice fallback at `:422`), not `:344`.

## FAIL block

```text
FAILED: check #3 — "confirm the server fix is the one running", plus checklist item [3]
        "every claim has a source".
SAW:    The live engine does not report the claimed identity. curl https://pynescript.online/health
        → service "pynescript-pro-api", version "1.0.0"; /stats top-level version "1.0.0"; the app's
        own engine.get.health → version "1.0.0". No git sha and no pyne package version is exposed
        anywhere (/version, /git, /openapi.json → 404). Nothing in the running system confirms
        pynescript 6ea1d35d / 0.6.34. The proof's own timeline contradicts it: the cited image
        pynescript-api:latest was built 2026-11-09 20:42:21 UTC, i.e. BEFORE the 2026-11-10
        "before" state that still showed 41/41 stream-full snapshots. A fix already running on
        11-09 cannot be what changed between the before and after measurements. The improvement
        most plausibly comes from the AXIS client commits shipped in Pages 2.28.1 (build
        2026-11-11T17:23:22Z): a7a85aab, 18fe7e65, a7cb0266, 6c209277.
        Second, smaller: the table says "one null = the paint transaction" for apply.commit; the
        window actually has 7 `{"seq":null,"lastSeq":0}` commits, not 1.
FIX:    Reconcile the attribution. Either
        (a) paste the deployed server identity from the host — `git -C /root/pynescript rev-parse HEAD`,
            `git -C /root/pynescript describe --tags`, and `docker image inspect` of the running
            container — and show it equals 6ea1d35d / 0.6.34 with a build time that post-dates the
            before-state; or
        (b) restate the root cause as the AXIS client fix and list the four commits that Pages
            2.28.1 actually deployed, moving the pyne change to "expected/also aligned".
        In both cases correct "one null" → 7 null-seq commits and re-check the "Source tree clean"
        line against the current dirty tree (uncommitted, not deployed).
```

Behaviour is not in dispute: 0 full snapshots, 66/66 delta paints, seqGap 0, resync 0,
646 ms, verdict live. Only the provenance of the server fix and two evidence numbers fail.

## Non-blocking item (my earlier FAIL)

The defensive `bar_times` slice stays open as its own item: with the captured shape
`bar_times_len == columns` (10022) the `slice(-count)` branch is unreachable, so it cannot
affect this lag fix and does not gate this card. Owner: oo-spec-2, tracked separately.

## Re-gate — PASS (2026-11-11, after owner correction)

Supersedes the FAIL above. The owner corrected the attribution (attach `b4133c5c`):
the behaviour change is credited to Pages `2.28.1` / the AXIS client fixes, and
pynescript 0.6.34 is explicitly marked unproven because the running engine reports
`version:"1.0.0"` with no sha and its cited build predates the before-state.
The `seq:null` count was corrected from 1 to 7 of 22.

Re-checked: 0 `apply.payload` / 0 `stream-full`, 66/66 `mode:"delta"`, 22 commits
with 7 null, 5 `chart.lag` samples over ~5 min across 3 page loads with seqGap /
resync / droppedTip / jsonFallback / unknownOpcode / longTask all 0, verdict `live`,
`engineLagBars` 0, live-wire suite 78/0 at HEAD.

Verdict: PASS. Card moved to Done.
Residual risk: the server half stays unproven — close it by exposing `PYNE_GIT_SHA`
in `/health`, or pinning the engine back to `0.6.29` and re-measuring.
