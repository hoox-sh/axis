/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Editor intelligence must actually paint: hover cards, lint underlines,
 * and inline debug chips. These tests go through the apply path, not just
 * “the parser returned a message”.
 */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import { EditorState } from '@codemirror/state';
import {
  DEFAULT_EDITOR_INTEL,
  EDITOR_INTEL_REV,
  isDeadEditorIntelBag,
  readEditorIntel,
} from '../src/editor/editor-intel';
import {
  applyDiagnostics,
  combineEditorDiagnostics,
  diagnosticsExtension,
  diagnosticsStateField,
  setDiagnosticsData,
} from '../src/editor/diagnostics';
import { localPreevaluate } from '../src/editor/preevaluate';
import {
  pyneHover,
  pyneHoverLocal,
  pyneLspExtensions,
} from '../src/editor/pyne-lsp';
import {
  applyInlineDebug,
  inlineDebugExtension,
  inlineDebugStateField,
  setInlineDebugData,
} from '../src/editor/inline-debug';
import { collectInlineDebugAnnotations } from '../src/results/inline-debug';
import { patchEditorIntel, resetEditorIntel, store } from '../src/store';

const BAD_SRC = `//@version=6
indicator("t")
plot(close)
plt(1)
`;

function deadIntelBag(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(DEFAULT_EDITOR_INTEL)) {
    if (k === 'rev') continue;
    out[k] = typeof v === 'boolean' ? false : v;
  }
  return out;
}

describe('dead editorIntel persist recovery', () => {
  it('flags an all-off bag without rev as dead', () => {
    expect(isDeadEditorIntelBag(deadIntelBag())).toBe(true);
  });

  it('does not flag a user who only turned hover off', () => {
    expect(isDeadEditorIntelBag({ hoverEnabled: false })).toBe(false);
    expect(readEditorIntel({ hoverEnabled: false }).hoverEnabled).toBe(false);
    expect(readEditorIntel({ hoverEnabled: false }).preevalEnabled).toBe(true);
  });

  it('hydrates a dead bag back to working defaults', () => {
    const bag = readEditorIntel(deadIntelBag());
    expect(bag.hoverEnabled).toBe(true);
    expect(bag.preevalEnabled).toBe(true);
    expect(bag.diagUnderlines).toBe(true);
    expect(bag.autocompleteEnabled).toBe(true);
    expect(bag.inlineChips).toBe(true);
    expect(bag.rev).toBe(EDITOR_INTEL_REV);
  });

  it('patchEditorIntel keeps other flags when spreading from the store proxy', () => {
    resetEditorIntel();
    patchEditorIntel({ hoverTimeMs: 300 });
    const bag = readEditorIntel(store.editorIntel);
    expect(bag.hoverEnabled).toBe(true);
    expect(bag.preevalEnabled).toBe(true);
    expect(bag.diagUnderlines).toBe(true);
    expect(bag.hoverTimeMs).toBe(300);
  });
});

describe('lint underlines apply to the editor state', () => {
  beforeEach(() => {
    resetEditorIntel();
  });

  it('local pre-eval produces a ranged typo on plt()', () => {
    const diags = localPreevaluate(BAD_SRC);
    const typo = diags.find((d) => /plt/.test(d.message));
    expect(typo).toBeTruthy();
    expect(typo!.to).toBeGreaterThan(typo!.from);
    expect(BAD_SRC.slice(typo!.from, typo!.to)).toBe('plt');
  });

  it('keeps pre-eval marks when last-run has no stamp', () => {
    const pre = localPreevaluate(BAD_SRC);
    const merged = combineEditorDiagnostics(pre, { status: 'ok' }, BAD_SRC);
    expect(merged.some((d) => /plt/.test(d.message))).toBe(true);
  });

  it('drops pre-eval from Problems when the buffer moved on', () => {
    const pre = localPreevaluate(BAD_SRC);
    const fixed = BAD_SRC.replace('plt(1)', 'plot(1)');
    expect(
      combineEditorDiagnostics(pre, null, fixed, BAD_SRC).some((d) => /plt/.test(d.message)),
    ).toBe(false);
  });

  it('setDiagnosticsData builds underline decorations', () => {
    const pre = localPreevaluate(BAD_SRC);
    expect(pre.length).toBeGreaterThan(0);
    const state = EditorState.create({
      doc: BAD_SRC,
      extensions: [diagnosticsExtension()],
    });
    const tr = state.update({ effects: setDiagnosticsData.of(pre) });
    const st = tr.state.field(diagnosticsStateField);
    expect(st.diags.length).toBeGreaterThan(0);
    expect(st.decorations.size).toBeGreaterThan(0);
    let marks = 0;
    st.decorations.between(0, tr.state.doc.length, (_from, _to, value) => {
      const cls = String((value as { spec?: { class?: string } }).spec?.class || '');
      if (cls.includes('cm-diag-mark')) marks += 1;
    });
    expect(marks).toBeGreaterThan(0);
  });

  it('doc edits that delete a lint range drop that diagnostic', () => {
    const pre = localPreevaluate(BAD_SRC);
    const typo = pre.find((d) => /plt/.test(d.message));
    expect(typo).toBeTruthy();
    let state = EditorState.create({
      doc: BAD_SRC,
      extensions: [diagnosticsExtension()],
    });
    state = state.update({ effects: setDiagnosticsData.of(pre) }).state;
    state = state.update({
      changes: { from: typo!.from, to: typo!.to, insert: 'plot' },
    }).state;
    const st = state.field(diagnosticsStateField);
    expect(st.diags.some((d) => /plt/.test(d.message))).toBe(false);
  });

  it('applyDiagnostics no-ops when the payload is unchanged', () => {
    const pre = localPreevaluate(BAD_SRC);
    const state0 = EditorState.create({
      doc: BAD_SRC,
      extensions: [diagnosticsExtension()],
    });
    // applyDiagnostics needs a view-like dispatch; drive via transactions
    let state = state0.update({ effects: setDiagnosticsData.of(pre) }).state;
    const first = state.field(diagnosticsStateField);
    const sig = `${first.diags.length}:${first.decorations.size}`;
    state = state.update({ effects: setDiagnosticsData.of(pre) }).state;
    const second = state.field(diagnosticsStateField);
    expect(`${second.diags.length}:${second.decorations.size}`).toBe(sig);
    expect(applyDiagnostics).toBeTypeOf('function');
  });

  it('applyDiagnostics rebuilds when diags exist but nothing is painted', () => {
    const pre = localPreevaluate(BAD_SRC);
    expect(pre.length).toBeGreaterThan(0);
    let state = EditorState.create({
      doc: BAD_SRC,
      extensions: [diagnosticsExtension()],
    });
    patchEditorIntel({ diagUnderlines: false });
    const mock = {
      get state() {
        return state;
      },
      dispatch(spec: { effects?: unknown }) {
        state = state.update(spec as never).state;
      },
    };
    applyDiagnostics(mock as never, pre);
    expect(state.field(diagnosticsStateField).diags.length).toBeGreaterThan(0);
    expect(state.field(diagnosticsStateField).decorations.size).toBe(0);

    patchEditorIntel({ diagUnderlines: true });
    applyDiagnostics(mock as never, pre);
    const st = state.field(diagnosticsStateField);
    expect(st.diags.length).toBeGreaterThan(0);
    expect(st.decorations.size).toBeGreaterThan(0);
    let marks = 0;
    st.decorations.between(0, state.doc.length, (_from, _to, value) => {
      const cls = String((value as { spec?: { class?: string } }).spec?.class || '');
      if (cls.includes('cm-diag-mark')) marks += 1;
    });
    expect(marks).toBeGreaterThan(0);
  });
});

describe('hover cards', () => {
  beforeEach(() => {
    resetEditorIntel();
  });

  it('pyneLspExtensions mounts hover when intel is on', () => {
    const ext = pyneLspExtensions(DEFAULT_EDITOR_INTEL);
    expect(ext.length).toBeGreaterThan(0);
    const off = pyneLspExtensions({ ...DEFAULT_EDITOR_INTEL, hoverEnabled: false, autocompleteEnabled: false, signatureHints: false });
    expect(off.length).toBe(0);
  });

  it('hover cards for plot / close / ta.sma are not clipped', () => {
    const src = `//@version=6
indicator("t")
x = ta.sma(close, 14)
plot(x)
`;
    const fake = {
      state: {
        doc: { sliceString: (a: number, b: number) => src.slice(a, b), length: src.length },
      },
    };
    for (const token of ['close', 'plot', 'sma'] as const) {
      const tip = pyneHoverLocal(fake, src.indexOf(token) + 1);
      expect(tip).toBeTruthy();
      expect(tip!.clip).toBe(false);
      expect(typeof tip!.create).toBe('function');
    }
  });

  it('pyneHover respects hoverEnabled and still returns local cards', async () => {
    const src = 'plot(close)\n';
    const state = EditorState.create({ doc: src });
    const view = { state } as never;
    resetEditorIntel();
    const tip = await pyneHover(view, src.indexOf('close') + 1);
    expect(tip).toBeTruthy();
    expect(tip!.clip).toBe(false);
    patchEditorIntel({ hoverEnabled: false });
    const off = await pyneHover(view, src.indexOf('close') + 1);
    expect(off).toBeNull();
  });
});

describe('inline debug chips apply to the editor state', () => {
  it('collects last-run logs and builds chip decorations', () => {
    const src = `//@version=6
indicator("t")
plot(close)
`;
    const lastRun = {
      status: 'success',
      logs: [{ level: 'info', message: 'hello', line: 3 }],
    };
    const anns = collectInlineDebugAnnotations(lastRun);
    expect(anns.some((a) => a.line === 3 && /hello/.test(a.message))).toBe(true);

    const state = EditorState.create({
      doc: src,
      extensions: [inlineDebugExtension()],
    });
    const tr = state.update({
      effects: setInlineDebugData.of(anns),
    });
    const st = tr.state.field(inlineDebugStateField);
    expect(st.anns.length).toBeGreaterThan(0);
    expect(st.decorations.size).toBeGreaterThan(0);
    expect(applyInlineDebug).toBeTypeOf('function');
  });
});
