---
type: "Document"
title: "Performance & architecture audit — Q4 2026"
description: "Prioritized gap analysis for turning AXIS into a production-grade, super-snappy, modern charting application."
resource: "docs/architecture/perf-audit-2026-11.mdx"
tags: [architecture, doc, docs, perf-audit-2026-11]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-11-01T18:07:47Z
sources:
  - id: tree
    resource: "docs/architecture/perf-audit-2026-11.mdx"
    title: "docs/architecture/perf-audit-2026-11.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/architecture/perf-audit-2026-11.mdx`.

# Outline

* 1. Baseline health
* 2. Architecture strengths to preserve
* 3. Top bottlenecks & weaknesses
  * 3.1 Reactivity surface too coarse
  * 3.2 ChartHost is an effect-dense component
  * 3.3 Overlay updates are unconditional
  * 3.4 Live tick still propagates to non-visual store paths
  * 3.5 Engine response parsing is main-thread synchronous
  * 3.6 Memory pressure from long-lived transient objects
  * 3.7 UI theming and layout effects are not batched
  * 3.8 Accessibility & polish gaps
* 4. Prioritized improvement plan
  * Phase 0 — Measure first (week 1)
  * Phase 1 — Reactive architecture (weeks 2–3)
  * Phase 2 — Rendering & data-plane performance (weeks 3–4)
  * Phase 3 — Engine boundary improvements (weeks 4–5)
  * Phase 4 — UX / visual polish (weeks 5–6)
  * Phase 5 — Continuous quality gates (week 6+)
* 5. Validation metrics
* 6. Risks & mitigations
* 7. Related files
* 8. Phase 0 / Phase 1 implementation notes
  * Phase 0 — Instrumentation (landed)
  * Phase 1 — Narrow bar plane (landed)
  * Tooling updates
  * Validation after Phase 0/1
  * Phase 2 — Rendering & data-plane performance (landed)
  * Validation after Phase 2
  * Phase 3 — Engine-boundary performance (landed)
  * Validation after Phase 3
  * Phase 4 — UX / visual polish (landed)
  * Validation after Phase 4
  * Phase 5 — Continuous quality gates (landed)
  * Validation after Phase 5
* 9. Next move

# Mentions

* [e2e](/code/e2e.md)
* [scripts](/code/scripts.md)
* [src](/code/src.md)
* [src/chart](/code/src/chart.md)
* [src/data](/code/src/data.md)
* [src/editor](/code/src/editor.md)
* [src/engine](/code/src/engine.md)
* [src/engines](/code/src/engines.md)
* [src/indicators](/code/src/indicators.md)
* [src/perf](/code/src/perf.md)
* [src/store](/code/src/store.md)
* [src/stores](/code/src/stores.md)
* [src/ui](/code/src/ui.md)
* [src/ui/panels](/code/src/ui/panels.md)
* [src/ui/shortcuts](/code/src/ui/shortcuts.md)
* [src/workers](/code/src/workers.md)
* [tests](/code/tests.md)
