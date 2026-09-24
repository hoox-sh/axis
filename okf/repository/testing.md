---
type: "Document"
title: "AXIS testing guide"
description: "Covers plugin URL schemes, storage-via-URL reject, poisoned localStorage, worker partition isolation, If-Match 409, admin keys."
resource: "TESTING.md"
tags: [doc, testing]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:02:55Z
sources:
  - id: tree
    resource: "TESTING.md"
    title: "TESTING.md"
    author: process:git
okf_lock: generated
---

# Source

Repo path `TESTING.md`.

# Outline

* Quick commands
* Layout
* E2E (Playwright)
* Security
* Coverage policy
  * Soft spots to raise for 90%
* Integration suites
* Conventions
* Adding a unit test

# Mentions

* [scripts](/code/scripts.md)
* [tests](/code/tests.md)
* [tests/fixtures](/code/tests/fixtures.md)
* [tests/integration](/code/tests/integration.md)
