---
type: "Playbook"
title: "How to read the AXIS bundle"
description: "Read the root index, open one concept, and follow its links instead of scanning the repo."
tags: [axis, playbook, okf]
status: stable
okf_lock: human
generated:
  by: human:jango_blockchained
  at: 2026-09-24T00:00:00Z
sources:
  - id: spec
    resource: https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md
    title: Open Knowledge Format v0.2
---

# What this bundle is

This directory is an [Open Knowledge Format](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md) v0.2 bundle. It is a compiled cache of the AXIS repo: one concept per source directory and per document, with import and mention links already resolved.

Start at [the root index](/index.md). Open the section you need. Read that concept. Follow `# Depends on`, `# Used by`, and `# Nested` before opening source files. A question about one module should cost the index plus a concept, not a search across `src/`.

# Commands

* `bun run okf:query chart drawings` finds concepts by path, title, and description.
* `bun run okf:context src/chart/drawings` prints that concept and one-line blurbs for its neighbors.
* `bun run okf:lint` checks the bundle. Errors fail. Warnings are producer conventions.
* `bun run okf:enrich` drafts and relinks the bundle from the tree.
* `bun run okf:check` fails when the committed bundle does not match the tree.

The draft is deterministic. It records exports, imports, package specifiers, and the first non-license comment. It does not call a model, so a commit hook can refresh it without a network or a secret.

# What the hook does

`.githooks/pre-commit` runs this pipeline on every commit, from the git index, then stages the generated bundle. A new curated file is staged with it. An unstaged edit to a curated playbook is left unstaged, and it is not described by that commit's bundle. `OKF_SKIP=1` skips the refresh. `--no-verify` skips the hook entirely.

Curated concepts set `okf_lock: human` (or `generated.by: human:…`). The compiler never rewrites them. Generated concepts set `okf_lock: generated` and are replaced when their sources change. `generated.at` stays put until the concept body changes.

# Where to go next

The product map is [AXIS map](/playbooks/axis-map.md). The pipeline that writes this bundle lives at [scripts/okf](/code/scripts/okf.md).
