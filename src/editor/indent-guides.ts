// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Indent grid for the Pine editor: guides + leading-whitespace dots.
 *
 * Pine indents with 4 spaces. Each leading-whitespace run is replaced by a
 * width-preserving widget split into 4-column cells: every complete cell
 * renders an overlay guide line at its left edge plus faint dots, so each
 * nesting level gets both a vertical guide and visible space markers.
 * Partial trailing cells render dots only. Tabs expand to 4-column stops.
 *
 * Replacement (not marks) keeps dots and guides in one decoration, always
 * in sync, viewport-scoped via {@link MatchDecorator}.
 *
 * Theme hooks: `.ax-indent-cell` / `.ax-iguide` / `.ax-indent-dots`.
 *
 * @module editor/indent-guides
 */

import {
  Decoration,
  type DecorationSet,
  type EditorView,
  MatchDecorator,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { PINE_INDENT_WIDTH } from './code-folding';

/** Expanded columns of a leading run (tabs → 4-column stops). */
function runColumns(run: string): number {
  let col = 0;
  for (const ch of run) {
    if (ch === '\t') col += PINE_INDENT_WIDTH - (col % PINE_INDENT_WIDTH);
    else col += 1;
  }
  return col;
}

/** Width-preserving indent grid for one leading-whitespace run. */
export class IndentWidget extends WidgetType {
  constructor(readonly run: string) {
    super();
  }

  eq(other: IndentWidget) {
    return other.run === this.run;
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'ax-indent';
    el.setAttribute('aria-hidden', 'true');
    let cols = runColumns(this.run);
    while (cols >= PINE_INDENT_WIDTH) {
      const cell = document.createElement('span');
      cell.className = 'ax-indent-cell';
      const guide = document.createElement('i');
      guide.className = 'ax-iguide';
      const dots = document.createElement('span');
      dots.className = 'ax-indent-dots';
      dots.textContent = '·'.repeat(PINE_INDENT_WIDTH);
      cell.appendChild(guide);
      cell.appendChild(dots);
      el.appendChild(cell);
      cols -= PINE_INDENT_WIDTH;
    }
    if (cols > 0) {
      const dots = document.createElement('span');
      dots.className = 'ax-indent-dots';
      dots.textContent = '·'.repeat(cols);
      el.appendChild(dots);
    }
    return el;
  }
}

/** Leading-whitespace runs (spaces/tabs at line start) → indent grid. */
export const indentMatcher = new MatchDecorator({
  regexp: /^[ \t]+/g,
  decoration: (match) =>
    Decoration.replace({ widget: new IndentWidget(match[0]) }),
});

/** Indent grid for the Pine editor (viewport-scoped, width-preserving). */
export function indentGuidesExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = indentMatcher.createDeco(view);
      }
      update(u: ViewUpdate): void {
        this.decorations = indentMatcher.updateDeco(u, this.decorations);
      }
    },
    { decorations: (v) => v.decorations },
  );
}
