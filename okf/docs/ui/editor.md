---
type: "Document"
title: "Editor"
description: "AXIS Pine editor: CodeMirror 6, diagnostics, 80-col ruler, git sync, stats, docked vs popout, editor bridge."
resource: "docs/ui/editor.mdx"
tags: [doc, docs, editor, ui]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:02:55Z
sources:
  - id: tree
    resource: "docs/ui/editor.mdx"
    title: "docs/ui/editor.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/ui/editor.mdx`.

# Outline

* Abstract
* Conceptual model
* Interface surface
  * Docked mode
  * Popout mode
  * Run entry points
  * Header tools (axis-editor-tools)
  * Stats strip
  * Symbols & emoji
  * Highlighting
  * Four information surfaces
  * Diagnostics & Problems
  * 80-column ruler
  * Git sync bar
  * Completion corpus
  * Library load
* Internals
  * editorRef pattern
  * Persistence
* Invariants
* Failure modes
* See also

# Mentions

* [scripts](/code/scripts.md)
* [src/editor](/code/src/editor.md)
* [tests](/code/tests.md)
