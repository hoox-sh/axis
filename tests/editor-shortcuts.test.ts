// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Editor keymap extensions: Pine-safe line ops (comment / duplicate / delete /
 * move) and the `Prec.high`-wrapped run keymap from `src/editor/cm-line-ops.ts`.
 *
 * Line ops are tested headless via their pure `…Spec` functions (no DOM);
 * keymap bindings are inspected and handler-based `run` callbacks invoked
 * directly.
 */

import { describe, expect, it } from 'bun:test';
import {
  EditorSelection,
  EditorState,
  type TransactionSpec,
} from '@codemirror/state';
import type { EditorView, KeyBinding } from '@codemirror/view';
import {
  buildRunKeymap,
  deleteLineSpec,
  duplicateLineSpec,
  moveLineSpec,
  runKeymapBindings,
  toggleLineCommentSpec,
  type RunKeymapHandlers,
} from '../src/editor/cm-line-ops.ts';

function stateWith(
  doc: string,
  selection?: EditorSelection | { anchor: number; head?: number },
): EditorState {
  return EditorState.create({
    doc,
    selection: selection ?? EditorSelection.cursor(0),
  });
}

function applySpec(
  state: EditorState,
  spec: TransactionSpec | ((s: EditorState) => TransactionSpec | null),
): EditorState {
  const resolved = typeof spec === 'function' ? spec(state) : spec;
  if (!resolved) return state;
  return state.update(resolved).state;
}

function bindingFor(bindings: KeyBinding[], key: string): KeyBinding | undefined {
  return bindings.find((b) => b.key === key);
}

/** Invoke a binding's `run` with a fake view (handler bindings ignore it). */
function runBinding(binding: KeyBinding | undefined): boolean {
  expect(binding).toBeDefined();
  const run = binding!.run;
  expect(run).toBeDefined();
  return run!(null as unknown as EditorView);
}

describe('toggleLineCommentSpec', () => {
  it('prefixes `// ` on an uncommented line', () => {
    const next = applySpec(stateWith('close = high', EditorSelection.cursor(0)), toggleLineCommentSpec);
    expect(next.doc.toString()).toBe('// close = high');
  });

  it('removes `// ` from a commented line', () => {
    const next = applySpec(stateWith('// close = high', EditorSelection.cursor(0)), toggleLineCommentSpec);
    expect(next.doc.toString()).toBe('close = high');
  });

  it('preserves leading indentation when commenting', () => {
    const next = applySpec(stateWith('  plot(close)', EditorSelection.cursor(2)), toggleLineCommentSpec);
    expect(next.doc.toString()).toBe('  // plot(close)');
  });

  it('is Pine-safe: never strips a bare `//` prefix (e.g. //@version=6)', () => {
    const next = applySpec(stateWith('//@version=6', EditorSelection.cursor(0)), toggleLineCommentSpec);
    expect(next.doc.toString()).toBe('// //@version=6');
  });

  it('comments every line touched by a multi-line selection', () => {
    const next = applySpec(
      stateWith('a\nb\nc', EditorSelection.range(0, 3)),
      toggleLineCommentSpec,
    );
    expect(next.doc.toString()).toBe('// a\n// b\nc');
  });
});

describe('duplicateLineSpec', () => {
  it('duplicates the cursor line below', () => {
    const next = applySpec(stateWith('a\nb\nc', EditorSelection.cursor(2)), duplicateLineSpec);
    expect(next.doc.toString()).toBe('a\nb\nb\nc');
  });

  it('duplicates a multi-line selection as a block', () => {
    const next = applySpec(
      stateWith('a\nb\nc', EditorSelection.range(0, 3)),
      duplicateLineSpec,
    );
    expect(next.doc.toString()).toBe('a\nb\na\nb\nc');
  });

  it('keeps the selection on the original block', () => {
    const next = applySpec(stateWith('a\nb\nc', EditorSelection.cursor(2)), duplicateLineSpec);
    expect(next.selection.main.head).toBe(2);
  });
});

describe('deleteLineSpec', () => {
  it('deletes the cursor line and its trailing newline', () => {
    const next = applySpec(stateWith('a\nb\nc', EditorSelection.cursor(2)), deleteLineSpec);
    expect(next.doc.toString()).toBe('a\nc');
  });

  it('deletes the last line by absorbing the previous newline', () => {
    const next = applySpec(stateWith('a\nb\nc', EditorSelection.cursor(4)), deleteLineSpec);
    expect(next.doc.toString()).toBe('a\nb');
  });

  it('deletes a multi-line selection as one block', () => {
    const next = applySpec(
      stateWith('a\nb\nc\nd', EditorSelection.range(2, 5)),
      deleteLineSpec,
    );
    expect(next.doc.toString()).toBe('a\nd');
  });
});

describe('moveLineSpec', () => {
  it('moves the cursor line up', () => {
    const next = applySpec(stateWith('a\nb\nc\nd', EditorSelection.cursor(4)), (s) =>
      moveLineSpec(s, -1),
    );
    expect(next.doc.toString()).toBe('a\nc\nb\nd');
    expect(next.selection.main.head).toBe(2);
  });

  it('moves the cursor line down', () => {
    const next = applySpec(stateWith('a\nb\nc\nd', EditorSelection.cursor(2)), (s) =>
      moveLineSpec(s, 1),
    );
    expect(next.doc.toString()).toBe('a\nc\nb\nd');
    expect(next.selection.main.head).toBe(4);
  });

  it('moves a multi-line block down with the selection', () => {
    const next = applySpec(
      stateWith('a\nb\nc\nd', EditorSelection.range(2, 5)),
      (s) => moveLineSpec(s, 1),
    );
    expect(next.doc.toString()).toBe('a\nd\nb\nc');
    expect(next.selection.main.from).toBe(4);
    expect(next.selection.main.to).toBe(7);
  });

  it('returns null at document boundaries', () => {
    expect(moveLineSpec(stateWith('a\nb', EditorSelection.cursor(0)), -1)).toBeNull();
    expect(moveLineSpec(stateWith('a\nb', EditorSelection.cursor(3)), 1)).toBeNull();
  });
});

describe('runKeymapBindings', () => {
  const bindings = runKeymapBindings({});

  it('exposes all 12 editor bindings', () => {
    const keys = bindings.map((b) => b.key).sort();
    expect(keys).toEqual(
      [
        'Mod-Enter',
        'Shift-Alt-f',
        'Mod-Shift-f',
        'Alt-p',
        'Mod-/',
        'Mod-d',
        'Mod-Shift-k',
        'Alt-ArrowUp',
        'Alt-ArrowDown',
        'Mod-Shift-l',
        'Mod-Shift-d',
        'Mod-Shift-b',
      ].sort(),
    );
  });

  it('does NOT bind Mod-S or Mod-G (Hub-owned)', () => {
    expect(bindingFor(bindings, 'Mod-S')).toBeUndefined();
    expect(bindingFor(bindings, 'Mod-G')).toBeUndefined();
  });

  it('Mod-Enter invokes onRun', () => {
    let ran = 0;
    const b = runKeymapBindings({ onRun: () => void ran++ });
    expect(runBinding(bindingFor(b, 'Mod-Enter'))).toBe(true);
    expect(ran).toBe(1);
  });

  it('Mod-Shift-f invokes onFormat', () => {
    let formatted = 0;
    const b = runKeymapBindings({ onFormat: () => void formatted++ });
    expect(runBinding(bindingFor(b, 'Mod-Shift-f'))).toBe(true);
    expect(formatted).toBe(1);
  });

  it('Alt-p returns false when onToggleDebugPins is unset', () => {
    expect(runBinding(bindingFor(bindings, 'Alt-p'))).toBe(false);
  });

  it('Alt-p invokes onToggleDebugPins and returns its result', () => {
    const b = runKeymapBindings({ onToggleDebugPins: () => true });
    expect(runBinding(bindingFor(b, 'Alt-p'))).toBe(true);
  });

  it('Mod-Shift-l / Mod-Shift-d / Mod-Shift-b invoke their toggles', () => {
    let ruler = 0;
    let inline = 0;
    let profiler = 0;
    const b = runKeymapBindings({
      onToggleRuler: () => void ruler++,
      onToggleInlineDebug: () => void inline++,
      onToggleProfiler: () => void profiler++,
    });
    expect(runBinding(bindingFor(b, 'Mod-Shift-l'))).toBe(true);
    expect(runBinding(bindingFor(b, 'Mod-Shift-d'))).toBe(true);
    expect(runBinding(bindingFor(b, 'Mod-Shift-b'))).toBe(true);
    expect(ruler).toBe(1);
    expect(inline).toBe(1);
    expect(profiler).toBe(1);
  });

  it('line-op bindings carry preventDefault where the spec requires it', () => {
    expect(bindingFor(bindings, 'Mod-d')?.preventDefault).toBe(true);
    expect(bindingFor(bindings, 'Mod-Shift-k')?.preventDefault).toBe(true);
    expect(bindingFor(bindings, 'Alt-ArrowUp')?.preventDefault).toBe(true);
    expect(bindingFor(bindings, 'Alt-ArrowDown')?.preventDefault).toBe(true);
    expect(bindingFor(bindings, 'Mod-Shift-l')?.preventDefault).toBe(true);
    expect(bindingFor(bindings, 'Mod-Shift-d')?.preventDefault).toBe(true);
    expect(bindingFor(bindings, 'Mod-Shift-b')?.preventDefault).toBe(true);
    expect(bindingFor(bindings, 'Mod-/')?.preventDefault).toBeUndefined();
  });
});

describe('buildRunKeymap', () => {
  it('returns a non-empty Prec.high-wrapped extension', () => {
    const ext = buildRunKeymap({} as RunKeymapHandlers);
    expect(ext).toBeDefined();
    expect(ext).toBeTruthy();
  });
});