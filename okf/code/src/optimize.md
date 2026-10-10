---
type: "Code Module"
title: "src/optimize"
description: "src/optimize contains client.ts, guard.ts, index.ts, and 2 more files."
resource: "src/optimize"
tags: [code, optimize]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-10T20:32:38Z
sources:
  - id: tree
    resource: "src/optimize"
    title: "src/optimize"
    author: process:git
okf_lock: generated
---

# Files

* `client.ts` — RunStudyOpts, _holdoutOk, _pickWinnerForTests, _scoreStatsForTests, loadPersistedStudy, persistStudy, plannedEngineRuns, runHpoStudy, walkForwardWindowCount
* `guard.ts` — beginStudy, endStudy, isStudyActive
* `index.ts` — MAX_TRIALS, ObjectiveId, ParamSpec, SamplerId, StudySnapshot, ValidationSpec, beginStudy, defaultParamFromInput, endStudy, isStudyActive, loadPersistedStudy, persistStudy
* `space.ts` — clampValue, defaultParamFromInput, isSearchableInput, randomAssignment, spaceReady, toPyneSpace
* `types.ts` — HPO_STORAGE_KEY, MAX_ENGINE_RUNS, MAX_TRIALS, ObjectiveId, ParamKind, ParamSpec, ParamValue, SamplerId, StudySnapshot, TrialRow, ValidationId, ValidationSpec

# Depends on

* [src/engines](/code/src/engines.md)
* [src/indicators](/code/src/indicators.md)
* [src/plugins](/code/src/plugins.md)
* [src/results](/code/src/results.md)
* [src/storage](/code/src/storage.md)
* [src/store](/code/src/store.md)

# Used by

* [src/streams](/code/src/streams.md)
* [src/ui](/code/src/ui.md)
* [tests](/code/tests.md)
