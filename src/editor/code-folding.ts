// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Indent-based code folding for the Pine editor.
 *
 * Pine (`pyne-language`) is a {@link StreamLanguage} with no Lezer syntax
 * tree, so syntax-driven folding is unavailable. Pine is
 * indentation-significant (4 spaces), so fold ranges derive from indent
 * depth: a line folds when followed (past blank lines) by deeper-indented
 * lines. Standard `foldGutter` + `foldKeymap` UX on top.
 *
 * @module editor/code-folding
 */

import { keymap, type EditorView } from '@codemirror/view';
import { codeFolding, foldGutter, foldKeymap, foldService } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';

/** Spaces per indent level (matches the Pine formatter). */
export const PINE_INDENT_WIDTH = 4;

/** Column width of a leading indent run (tabs count as one indent level). */
export function indentColumn(text: string): number {
  let col = 0;
  for (const ch of text) {
    if (ch === ' ') col += 1;
    else if (ch === '\t') col += PINE_INDENT_WIDTH - (col % PINE_INDENT_WIDTH);
    else break;
  }
  return col;
}

/**
 * Foldable range starting at `lineFrom` (a line start offset), or null.
 * The range covers the trailing newline through the end of the last
 * deeper-indented line, so the header line itself stays visible.
 */
export function pineFoldRange(
  state: EditorState,
  lineFrom: number,
): { from: number; to: number } | null {
  const doc = state.doc;
  let lineNo: number;
  try {
    lineNo = doc.lineAt(lineFrom).number;
  } catch {
    return null;
  }
  const head = doc.line(lineNo);
  if (!head.text.trim()) return null;
  const baseIndent = indentColumn(head.text);
  let end: number | null = null;
  for (let n = lineNo + 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (!line.text.trim()) continue;
    if (indentColumn(line.text) <= baseIndent) break;
    end = line.to;
  }
  if (end == null) return null;
  return { from: head.to, to: end };
}

/** Indent-based fold service for Pine buffers. */
export const pineIndentFoldService = foldService.of((state, from) => {
  return pineFoldRange(state, from);
});

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Lucide chevron paths (24×24). `open` = block is expanded (not folded). */
function chevronSvg(open: boolean): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  // Down = expanded (click folds); right = folded (click unfolds).
  path.setAttribute('d', open ? 'm6 9 6 6 6-6' : 'm9 18 6-6-6-6');
  svg.appendChild(path);
  return svg;
}

/**
 * Fold gutter marker. `open` is true when the range is expanded
 * (CodeMirror `markerDOM` convention).
 */
export function foldMarker(open: boolean): HTMLElement {
  const el = document.createElement('span');
  el.className = `ax-fold-marker${open ? ' is-open' : ''}`;
  el.appendChild(chevronSvg(open));
  const label = open ? 'Fold block' : 'Unfold block';
  el.title = label;
  el.setAttribute('aria-label', label);
  el.setAttribute('data-open', open ? '1' : '0');
  return el;
}

/** Clickable placeholder shown on the header line while a block is folded. */
export function foldPlaceholder(
  _view: EditorView,
  onclick: (event: Event) => void,
): HTMLElement {
  const el = document.createElement('span');
  el.className = 'ax-fold-placeholder';
  el.textContent = '⋯';
  el.title = 'Unfold block';
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', 'Unfold block');
  el.addEventListener('mousedown', (e) => {
    e.preventDefault();
    onclick(e);
  });
  return el;
}

/** Gutter + keymap + indent fold service for the Pine editor. */
export function codeFoldingExtension(): Extension {
  return [
    codeFolding({ placeholderDOM: foldPlaceholder }),
    foldGutter({ markerDOM: foldMarker }),
    keymap.of(foldKeymap),
    pineIndentFoldService,
  ];
}
