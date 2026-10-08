---
type: "Document"
title: "CI and testing"
description: "GitHub Actions for AXIS: unit coverage gate, Playwright smoke, worker typecheck, nightly full e2e."
resource: "docs/devops/ci-and-testing.mdx"
tags: [ci-and-testing, devops, doc, docs]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-08T19:09:06Z
sources:
  - id: tree
    resource: "docs/devops/ci-and-testing.mdx"
    title: "docs/devops/ci-and-testing.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/devops/ci-and-testing.mdx`.

# Outline

* Abstract
* Conceptual model
* Interface surface — local commands
* CI workflows
  * ci.yml (excerpted jobs)
  * axis-nightly.yml
* Internals
  * Coverage policy (summary)
  * E2E design
  * Storybook
* Invariants & edge cases
* Failure modes
* See also

# Mentions

* [scripts](/code/scripts.md)
* [src](/code/src.md)
