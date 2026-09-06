// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CodeMirror 6 line operations + the editor "run" keymap.
 *
 * The `…Spec` functions are pure: they take an `EditorState` and return a
 * `TransactionSpec` (or `null` when nothing can be done), so they are
 * testable headless under Bun. The `view`-taking wrappers dispatch those
 * specs. {@link buildRunKeymap} wraps the run/format/debug-toggling bindings
 * in `Prec.high` so they beat the default CM keymap.
 *
 * @module editor/cm-line-ops
 */

import {
  EditorSelection,
  EditorState,
  Prec,
  type Extension,
  type TransactionSpec,
} from '@codemirror/state';
import { EditorView, keymap, type KeyBinding } from '@codemirror/view';

/** Callbacks for the editor "run" keymap (Mod-Enter, format, debug toggles). */
export interface RunKeymapHandlers {
  /** Mod-Enter — run the active script. */
  onRun?: () => void;
  /** Shift-Alt-f / Mod-Shift-f — format the document. */
  onFormat?: () => void;
  /**
   * Alt-p — toggle chart debug pins. Return `false` to let the key fall
   * through when no handler is available (matches the legacy binding).
   */
  onToggleDebugPins?: () => boolean;
  /** Mod-Shift-l — toggle the 80-column ruler. */
  onToggleRuler?: () => void;
  /** Mod-Shift-d — toggle inline debug annotations. */
  onToggleInlineDebug?: () => void;
  /** Mod-Shift-b — toggle the profiler gutter. */
  onToggleProfiler?: () => void;
}

/** Pine line-comment marker used by {@link toggleLineCommentSpec}. */
const LINE_COMMENT = '// ';

/**
 * Toggle `// ` line comments across the selection.
 *
 * Lines already starting with `// ` (after leading whitespace) are
 * uncommented; every other line gets the marker inserted after its indent.
 * Pine-safe: a bare `//` prefix (e.g. `//@version=6`) is never stripped —
 * it is treated as uncommented and gets `// ` prefixed instead.
 */
export function toggleLineCommentSpec(state: EditorState): TransactionSpec | null {
  const sel = state.selection.main;
  const first = state.doc.lineAt(sel.from);
  const last = state.doc.lineAt(sel.to);
  const changes: { from: number; to: number; insert: string }[] = [];
  for (let n = first.number; n <= last.number; n++) {
    const line = state.doc.line(n);
    const indent = line.text.match(/^\s*/)?.[0] ?? '';
    const body = line.text.slice(indent.length);
    const insert = body.startsWith(LINE_COMMENT)
      ? indent + body.slice(LINE_COMMENT.length)
      : indent + LINE_COMMENT + body;
    changes.push({ from: line.from, to: line.to, insert });
  }
  return changes.length ? { changes } : null;
}

/**
 * Duplicate the lines touched by the selection, inserting the copy after the
 * block. The selection stays on the original block.
 */
export function duplicateLineSpec(state: EditorState): TransactionSpec | null {
  const sel = state.selection.main;
  const first = state.doc.lineAt(sel.from);
  const last = state.doc.lineAt(sel.to);
  const text = state.doc.sliceString(first.from, last.to);
  const atEof = last.to >= state.doc.length;
  return {
    // Insert after the block's trailing newline (or before EOF with a leading
    // newline) so the copy lands on its own line.
    changes: { from: atEof ? last.to : last.to + 1, insert: atEof ? '\n' + text : text + '\n' },
    // Insertion happens after the block, so the old selection is unchanged.
    selection: sel,
  };
}

/**
 * Delete the lines touched by the selection. A middle/leading line absorbs
 * its trailing newline; the last line absorbs the previous newline instead.
 */
export function deleteLineSpec(state: EditorState): TransactionSpec | null {
  const sel = state.selection.main;
  const first = state.doc.lineAt(sel.from);
  const last = state.doc.lineAt(sel.to);
  let from = first.from;
  let to = last.to;
  if (to < state.doc.length) {
    to += 1; // include the trailing newline
  } else if (first.number > 1) {
    from -= 1; // last line: absorb the previous newline
  }
  return {
    changes: { from, to, insert: '' },
    selection: EditorSelection.cursor(from),
  };
}

/**
 * Move the lines touched by the selection one step up (`dir: -1`) or down
 * (`dir: 1`). Returns `null` at document boundaries. The selection moves
 * with the block.
 */
export function moveLineSpec(state: EditorState, dir: -1 | 1): TransactionSpec | null {
  const sel = state.selection.main;
  const first = state.doc.lineAt(sel.from);
  const last = state.doc.lineAt(sel.to);
  const blockTexts: string[] = [];
  for (let n = first.number; n <= last.number; n++) {
    blockTexts.push(state.doc.line(n).text);
  }

  if (dir === -1) {
    if (first.number === 1) return null;
    const target = state.doc.line(first.number - 1);
    // Region [target.from, last.to) holds target + block; reorder to block + target.
    const insert = [...blockTexts, target.text].join('\n');
    const shift = target.from - first.from;
    return {
      changes: { from: target.from, to: last.to, insert },
      selection: mapSelection(state.selection, shift),
    };
  }

  if (last.number === state.doc.lines) return null;
  const target = state.doc.line(last.number + 1);
  // Region [first.from, target.to) holds block + target; reorder to target + block.
  const insert = [target.text, ...blockTexts].join('\n');
  const shift = target.text.length + 1;
  return {
    changes: { from: first.from, to: target.to, insert },
    selection: mapSelection(state.selection, shift),
  };
}

function mapSelection(sel: EditorSelection, shift: number): EditorSelection {
  return EditorSelection.create(
    sel.ranges.map((r) => EditorSelection.range(r.from + shift, r.to + shift)),
  );
}

/** View wrappers — dispatch the pure specs above. */

export function toggleLineComment(view: EditorView): boolean {
  const spec = toggleLineCommentSpec(view.state);
  if (!spec) return false;
  view.dispatch(spec);
  return true;
}

export function duplicateLine(view: EditorView): boolean {
  const spec = duplicateLineSpec(view.state);
  if (!spec) return false;
  view.dispatch(spec);
  return true;
}

export function deleteLine(view: EditorView): boolean {
  const spec = deleteLineSpec(view.state);
  if (!spec) return false;
  view.dispatch(spec);
  return true;
}

export function moveLine(view: EditorView, dir: -1 | 1): boolean {
  const spec = moveLineSpec(view.state, dir);
  if (!spec) return false;
  view.dispatch(spec);
  return true;
}

/**
 * The editor "run" keymap bindings. Mod-S / Mod-G are intentionally absent —
 * they are owned by the shortcut Hub (with tabbed-editor fallbacks).
 */
export function runKeymapBindings(handlers: RunKeymapHandlers): KeyBinding[] {
  return [
    {
      key: 'Mod-Enter',
      run: () => {
        handlers.onRun?.();
        return true;
      },
    },
    {
      key: 'Shift-Alt-f',
      run: () => {
        handlers.onFormat?.();
        return true;
      },
    },
    {
      key: 'Mod-Shift-f',
      run: () => {
        handlers.onFormat?.();
        return true;
      },
    },
    {
      key: 'Alt-p',
      run: () => {
        if (!handlers.onToggleDebugPins) return false;
        return handlers.onToggleDebugPins();
      },
    },
    {
      key: 'Mod-/',
      run: (view) => {
        toggleLineComment(view);
        return true;
      },
    },
    {
      key: 'Mod-d',
      run: (view) => {
        duplicateLine(view);
        return true;
      },
      preventDefault: true,
    },
    {
      key: 'Mod-Shift-k',
      run: (view) => {
        deleteLine(view);
        return true;
      },
      preventDefault: true,
    },
    {
      key: 'Alt-ArrowUp',
      run: (view) => {
        moveLine(view, -1);
        return true;
      },
      preventDefault: true,
    },
    {
      key: 'Alt-ArrowDown',
      run: (view) => {
        moveLine(view, 1);
        return true;
      },
      preventDefault: true,
    },
    {
      key: 'Mod-Shift-l',
      preventDefault: true,
      run: () => {
        handlers.onToggleRuler?.();
        return true;
      },
    },
    {
      key: 'Mod-Shift-d',
      preventDefault: true,
      run: () => {
        handlers.onToggleInlineDebug?.();
        return true;
      },
    },
    {
      key: 'Mod-Shift-b',
      preventDefault: true,
      run: () => {
        handlers.onToggleProfiler?.();
        return true;
      },
    },
  ];
}

/**
 * The editor run keymap wrapped in `Prec.high` so it beats the default CM
 * keymap (which is mounted after it in PyneEditor).
 */
export function buildRunKeymap(handlers: RunKeymapHandlers): Extension {
  return Prec.high(keymap.of(runKeymapBindings(handlers)));
}