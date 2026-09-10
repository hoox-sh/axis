/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Editor chrome: indent folding, indent grid math, minimap scroll mapping,
 * and the minimap store toggle.
 */

import './setup';
import { describe, expect, it } from 'bun:test';
import { EditorState } from '@codemirror/state';
import {
  PINE_INDENT_WIDTH,
  indentColumn,
  pineFoldRange,
} from '../src/editor/code-folding';
import {
  MINIMAP_MAX_LINES,
  MINIMAP_MIN_CONTAINER_WIDTH,
  MINIMAP_ROW_HEIGHT,
  MINIMAP_WIDTH,
  scrollFraction,
  scrollTopForFraction,
  viewportFraction,
} from '../src/editor/minimap';
import {
  setEditorMinimapEnabled,
  store,
  toggleEditorMinimapEnabled,
} from '../src/store';

const stateFor = (doc: string) => EditorState.create({ doc });

describe('indentColumn', () => {
  it('counts spaces, tabs as 4-stop, stops at first non-space', () => {
    expect(indentColumn('')).toBe(0);
    expect(indentColumn('close')).toBe(0);
    expect(indentColumn('    x')).toBe(4);
    expect(indentColumn('\tx')).toBe(4);
    expect(indentColumn('  \tx')).toBe(4);
    expect(indentColumn('   \tx')).toBe(4);
    expect(PINE_INDENT_WIDTH).toBe(4);
  });
});

describe('pineFoldRange', () => {
  it('folds an indented block, keeping the header line visible', () => {
    const st = stateFor('if a\n    x := 1\n    y := 2\nz := 3\n');
    const head = st.doc.line(1);
    const range = pineFoldRange(st, head.from);
    expect(range).not.toBeNull();
    expect(range?.from).toBe(head.to);
    expect(range?.to).toBe(st.doc.line(3).to);
  });

  it('returns null for flat documents and blank lines', () => {
    const flat = stateFor('a := 1\nb := 2\n');
    expect(pineFoldRange(flat, 0)).toBeNull();
    const withBlank = stateFor('if a\n\n    x := 1\n');
    const range = pineFoldRange(withBlank, 0);
    expect(range).not.toBeNull();
    expect(range?.to).toBe(withBlank.doc.line(3).to);
  });

  it('stops at dedent, folds nested outer block to its end', () => {
    const st = stateFor('if a\n    if b\n        x := 1\n    y := 2\nz := 3\n');
    const outer = pineFoldRange(st, 0);
    expect(outer).not.toBeNull();
    expect(outer?.to).toBe(st.doc.line(4).to);
    const inner = pineFoldRange(st, st.doc.line(2).from);
    expect(inner).not.toBeNull();
    expect(inner?.to).toBe(st.doc.line(3).to);
  });
});

describe('minimap scroll mapping', () => {
  it('fraction helpers clamp and invert', () => {
    expect(scrollFraction(0, 1000, 200)).toBe(0);
    expect(scrollFraction(800, 1000, 200)).toBe(1);
    expect(scrollFraction(-5, 1000, 200)).toBe(0);
    expect(scrollFraction(400, 1000, 200)).toBeCloseTo(0.5);
    expect(scrollTopForFraction(0.5, 1000, 200)).toBeCloseTo(400);
    expect(scrollTopForFraction(2, 1000, 200)).toBe(800);
    expect(scrollTopForFraction(0, 500, 500)).toBe(0);
  });

  it('viewport fraction clamps to [0, 1]', () => {
    expect(viewportFraction(0, 100, 1000)).toEqual({ from: 0, to: 0.1 });
    expect(viewportFraction(-10, 2000, 1000)).toEqual({ from: 0, to: 1 });
  });

  it('layout constants are sane', () => {
    expect(MINIMAP_WIDTH).toBeGreaterThan(0);
    expect(MINIMAP_ROW_HEIGHT).toBeGreaterThan(0);
    expect(MINIMAP_MAX_LINES).toBeGreaterThan(100);
    expect(MINIMAP_MIN_CONTAINER_WIDTH).toBeGreaterThan(MINIMAP_WIDTH);
  });
});

describe('editor minimap store flag', () => {
  it('defaults on and toggles', () => {
    setEditorMinimapEnabled(true);
    expect(store.editorMinimapEnabled).toBe(true);
    toggleEditorMinimapEnabled();
    expect(store.editorMinimapEnabled).toBe(false);
    toggleEditorMinimapEnabled();
    expect(store.editorMinimapEnabled).toBe(true);
  });
});
