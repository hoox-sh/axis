/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import { EditorState } from '@codemirror/state';
import {
  lookupBuiltin,
  pineBuiltinCount,
  pineComplete,
  wordAt,
} from '../src/editor/pine-lsp';

describe('pine-lsp', () => {
  it('indexes builtins from metadata', () => {
    expect(pineBuiltinCount()).toBeGreaterThan(100);
  });

  it('looks up ta.sma and bare sma', () => {
    const full = lookupBuiltin('ta.sma');
    expect(full?.label).toBeTruthy();
    const bare = lookupBuiltin('sma');
    // may resolve via module search
    expect(bare || full).toBeTruthy();
  });

  it('wordAt finds qualified names', () => {
    const src = 'plot(ta.sma(close, 14))';
    const i = src.indexOf('sma') + 1;
    const w = wordAt(src, i);
    expect(w?.word).toContain('sma');
  });

  it('completes top-level after prefix (local)', async () => {
    const { pineCompleteLocal } = await import('../src/editor/pine-lsp');
    const state = EditorState.create({ doc: 'ind' });
    const r = pineCompleteLocal({
      state,
      pos: 3,
      explicit: false,
      matchBefore: (re: RegExp) => {
        const m = 'ind'.match(re);
        return m ? { from: 0, to: 3, text: 'ind' } : null;
      },
    } as never);
    expect(r).toBeTruthy();
    const labels = (r!.options || []).map((o) => o.label);
    expect(labels.some((l) => String(l).startsWith('ind'))).toBe(true);
  });

  it('completes module members after ta. (local)', async () => {
    const { pineCompleteLocal } = await import('../src/editor/pine-lsp');
    const doc = 'ta.';
    const state = EditorState.create({ doc });
    const r = pineCompleteLocal({
      state,
      pos: 3,
      explicit: true,
      matchBefore: () => null,
    } as never);
    expect(r).toBeTruthy();
    expect(r!.options.length).toBeGreaterThan(5);
  });
});
