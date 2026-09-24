---
type: "Playbook"
title: "AXIS map"
description: "Where the chart, data plane, editor, worker, and CLI live, and which repo owns Pine evaluation."
tags: [axis, playbook, architecture]
status: stable
okf_lock: human
generated:
  by: human:jango_blockchained
  at: 2026-09-24T00:00:00Z
sources:
  - id: overview
    resource: docs/architecture/overview.mdx
    title: Architecture overview
---

# Product

AXIS is the SolidJS charting PWA in this repo. Pine Script evaluation is not implemented here. It runs in the sibling `pyne` repo (the checkout is sometimes still named `pynescript`), reached through a local API, the Cloudflare Worker, or in-browser Pyodide.

Do not invent Pine identifiers or TradingView host methods. Builtin names come from `src/editor/data/pyne-builtins.json`. The chart palette is `VOID` in the chart series factory.

# Code

* [src/ui](/code/src/ui.md) is the product shell, including Studio.
* [src/chart](/code/src/chart.md) is the chart surface, series, and drawings.
* [src/data](/code/src/data.md) is the data-source manager: backfill, validate, gap-fill.
* [src/editor](/code/src/editor.md) is the Pine editor.
* [src/indicators](/code/src/indicators.md) runs scripts and hosts the built-in catalog.
* [src/mcp](/code/src/mcp.md) is the in-app MCP host.
* [src/onchain](/code/src/onchain.md) is the on-chain plane.
* [src/storage](/code/src/storage.md) is script storage and import.
* [worker/src](/code/worker/src.md) is the Cloudflare Worker API, `/mcp`, and the on-chain proxy.
* [packages/cli/src](/code/packages/cli/src.md) is the `axis` CLI.
* [scripts/okf](/code/scripts/okf.md) drafts, links, and lints this bundle.

# Docs

[Architecture overview](/docs/architecture/overview.md) is the narrative version of the same split. [OKF bundle](/docs/devops/okf.md) is the operator note for the hook and the check.

The `VERSION` file is the release number. `bun run sync:versions` stamps the generated copies. `CHANGELOG.md` stays hand-written under `## [Unreleased]` and is not copied into this bundle, because the changelog is history rather than a map.
