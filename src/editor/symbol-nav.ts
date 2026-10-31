// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CodeMirror navigation for Pine: go to definition, find references, rename,
 * and document highlight.
 *
 * All four read the same {@link SymbolIndex} (built once per document version
 * and cached by `Text` identity), so a keystroke costs one O(n) scan and every
 * navigation costs a lookup.
 *
 * Keymap: `F12` definition · `Shift-F12` references · `F2` rename ·
 * `Alt`-click definition. Dialogs use CodeMirror's own panel so they inherit
 * the editor theme and never fight the chart layout.
 *
 * @module editor/symbol-nav
 */

import { EditorSelection, Prec, type EditorState, type Extension, type Text } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, keymap, showDialog } from '@codemirror/view';
import {
  buildSymbolIndex,
  definitionOf,
  planRename,
  referencesOf,
  symbolAt,
  type SymbolIndex,
  type SymbolRef,
} from './symbol-index';

/** One index per document version (Text objects are immutable). */
const indexCache = new WeakMap<Text, SymbolIndex>();

/** Cached symbol index for the current document. */
export function indexFor(doc: Text): SymbolIndex {
  let index = indexCache.get(doc);
  if (!index) {
    index = buildSymbolIndex(doc.toString());
    indexCache.set(doc, index);
  }
  return index;
}

/** Cap decorations so a common name in a huge script cannot flood the view. */
const MAX_HIGHLIGHT = 400;

const occurrenceMark = Decoration.mark({ class: 'cm-pine-symbol-occurrence' });
const declarationMark = Decoration.mark({ class: 'cm-pine-symbol-declaration' });

/**
 * Mark every occurrence of the symbol under the cursor.
 * Declarations get a stronger tint so a rename preview is readable at a glance.
 */
export function occurrenceDecorations(state: EditorState): DecorationSet {
  const sel = state.selection;
  if (!sel.main.empty || sel.ranges.length > 1) return Decoration.none;
  const pos = sel.main.head;
  // `symbolAt` only matches tokens the index kept (strings/comments excluded),
  // so no separate literal scan is needed here.
  const index = indexFor(state.doc);
  const refs = referencesOf(index, pos);
  if (!refs.length || refs.length > MAX_HIGHLIGHT) return Decoration.none;
  const ranges = refs.map((ref) =>
    (ref.kind === 'decl' ? declarationMark : occurrenceMark).range(ref.from, ref.to),
  );
  return Decoration.set(ranges, true);
}

/** Jump to the declaration of the symbol at `pos`. */
export function goToDefinitionAt(view: EditorView, pos: number): boolean {
  const index = indexFor(view.state.doc);
  const decl = definitionOf(index, pos);
  if (!decl) return false;
  view.dispatch({
    selection: EditorSelection.single(decl.from, decl.to),
    effects: EditorView.scrollIntoView(decl.from, { y: 'center' }),
  });
  view.focus();
  return true;
}

/** `F12` — definition for the symbol under the cursor. */
export function goToDefinition(view: EditorView): boolean {
  return goToDefinitionAt(view, view.state.selection.main.head);
}

function columnOf(text: string, offset: number): number {
  const lineStart = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  return offset - lineStart + 1;
}

/** Panel row label: `line:col  kind  source line`. */
function refLabel(doc: string, ref: SymbolRef): string {
  const lineText = doc.split('\n')[ref.line - 1] ?? '';
  return `${ref.line}:${columnOf(doc, ref.from)}  ${ref.kind.padEnd(6)}  ${lineText.trim()}`;
}

function openReferencesDialog(view: EditorView, name: string, refs: readonly SymbolRef[]): void {
  const doc = view.state.doc.toString();
  showDialog(view, {
    class: 'cm-pine-references',
    top: true,
    content: (v, closeDialog) => {
      const form = document.createElement('form');
      form.className = 'cm-pine-refs';

      const head = document.createElement('div');
      head.className = 'cm-pine-refs-head';
      head.textContent = `${refs.length} reference${refs.length === 1 ? '' : 's'} to ${name}`;
      form.appendChild(head);

      const list = document.createElement('div');
      list.className = 'cm-pine-refs-list';
      for (const ref of refs) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'cm-pine-refs-row';
        row.textContent = refLabel(doc, ref);
        row.title = 'Jump to this reference';
        row.addEventListener('click', () => {
          v.dispatch({
            selection: EditorSelection.single(ref.from, ref.to),
            effects: EditorView.scrollIntoView(ref.from, { y: 'center' }),
          });
          closeDialog();
          v.focus();
        });
        list.appendChild(row);
      }
      form.appendChild(list);
      return form;
    },
  });
}

/** `Shift-F12` — list every reference to the symbol under the cursor. */
export function findReferences(view: EditorView): boolean {
  const state = view.state;
  const index = indexFor(state.doc);
  const pos = state.selection.main.head;
  const occ = symbolAt(index, pos);
  if (!occ) return false;
  const refs = referencesOf(index, pos);
  if (!refs.length) return false;
  openReferencesDialog(view, occ.name, refs);
  return true;
}

function notify(view: EditorView, message: string): void {
  showDialog(view, { class: 'cm-pine-symbol-note', label: message, submitLabel: 'OK' });
}

/** Apply a validated rename at `offset`. */
export function applyRename(view: EditorView, offset: number, newName: string): boolean {
  const index = indexFor(view.state.doc);
  const plan = planRename(index, offset, newName);
  if (!plan.ok) {
    notify(view, plan.reason);
    return false;
  }
  view.dispatch({
    changes: plan.edits.map((edit) => ({ from: edit.from, to: edit.to, insert: newName })),
    userEvent: 'rename',
  });
  view.focus();
  return true;
}

/** `F2` — rename the symbol under the cursor (declaration + every reference). */
export function startRename(view: EditorView): boolean {
  const doc = view.state.doc;
  const offset = view.state.selection.main.head;
  const decl = definitionOf(indexFor(doc), offset);
  if (!decl) return false;

  const dialog = showDialog(view, {
    class: 'cm-pine-rename',
    top: true,
    label: `Rename ${decl.kind} “${decl.name}”`,
    input: { value: decl.name, 'aria-label': 'New name', name: 'name' },
    submitLabel: 'Rename',
  });
  void dialog.result.then((form) => {
    if (!form) return;
    const value = form.querySelector('input')?.value?.trim() ?? '';
    if (!value || value === decl.name) return;
    // The document moved while the dialog was open — offsets are stale.
    if (view.state.doc !== doc) {
      notify(view, 'The script changed while renaming — run Rename again.');
      return;
    }
    applyRename(view, offset, value);
  });
  return true;
}

/** Alt-click a symbol to jump to its declaration. */
const altClickDefinition = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (!event.altKey || event.button !== 0) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;
    const moved = goToDefinitionAt(view, pos);
    if (!moved) return false;
    event.preventDefault();
    return true;
  },
});

const symbolTheme = EditorView.baseTheme({
  '.cm-pine-symbol-occurrence': {
    backgroundColor: 'color-mix(in srgb, var(--color-accent) 18%, transparent)',
    borderRadius: '2px',
  },
  '.cm-pine-symbol-declaration': {
    backgroundColor: 'color-mix(in srgb, var(--color-accent) 34%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--color-accent) 45%, transparent)',
    borderRadius: '2px',
  },
  '.cm-pine-refs-head': {
    padding: '4px 8px',
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    opacity: '0.75',
  },
  '.cm-pine-refs-list': {
    maxHeight: '220px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
  },
  '.cm-pine-refs-row': {
    font: 'inherit',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '12px',
    textAlign: 'left',
    whiteSpace: 'pre',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    padding: '2px 8px',
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
  },
  '.cm-pine-refs-row:hover, .cm-pine-refs-row:focus-visible': {
    backgroundColor: 'color-mix(in srgb, var(--color-accent) 16%, transparent)',
    outline: 'none',
  },
});

const symbolKeymap = Prec.high(
  keymap.of([
    { key: 'F12', preventDefault: true, run: goToDefinition },
    { key: 'Shift-F12', preventDefault: true, run: findReferences },
    { key: 'F2', preventDefault: true, run: startRename },
  ]),
);

/**
 * Navigation extension: document highlight + keymap + Alt-click.
 * Mount once per editor view (see `PyneEditor`).
 */
export function symbolNavExtension(): Extension {
  return [
    symbolTheme,
    altClickDefinition,
    symbolKeymap,
    EditorView.decorations.compute(['doc', 'selection'], occurrenceDecorations),
  ];
}
