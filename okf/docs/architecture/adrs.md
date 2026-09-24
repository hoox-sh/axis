---
type: "Document"
title: "Architecture Decision Records"
description: "ADR-001 through ADR-015 for AXIS: registry, AXIS≠engine, Solid+Vite, three built-in engines, configSchema, URL load, storage, CF project id, proxies, DO fan-out, migration, CORS,…"
resource: "docs/architecture/adrs.mdx"
tags: [adrs, architecture, doc, docs]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:02:55Z
sources:
  - id: tree
    resource: "docs/architecture/adrs.mdx"
    title: "docs/architecture/adrs.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/architecture/adrs.mdx`.

# Outline

* Index
* ADR-001: Pluggable unified registry
  * Context
  * Decision
  * Consequences
* ADR-002: AXIS ≠ engine
  * Context
  * Decision
  * Consequences
* ADR-003: Solid + Vite product UI
  * Context
  * Decision
  * Consequences
* ADR-004: Built-in engines
  * Context
  * Decision
  * Consequences
* ADR-005: Declarative configSchema
  * Context
  * Decision
  * Consequences
* ADR-006: URL-loadable plugins
  * Context
  * Decision
  * Consequences
* ADR-007: Storage as a plugin
  * Context
  * Decision
  * Consequences
* ADR-008: Frozen CF project id
  * Context
  * Decision
  * Consequences
* ADR-009: Worker proxies first
  * Context
  * Decision
  * Consequences
* ADR-010: Durable Object stream fan-out
  * Context
  * Decision

# Mentions

* [src](/code/src.md)
* [src/alerts](/code/src/alerts.md)
* [src/data](/code/src/data.md)
* [src/engines](/code/src/engines.md)
* [src/onchain](/code/src/onchain.md)
* [src/plugins](/code/src/plugins.md)
* [src/store](/code/src/store.md)
* [src/ui](/code/src/ui.md)
* [tests](/code/tests.md)
* [worker/src](/code/worker/src.md)
