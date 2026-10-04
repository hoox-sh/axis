/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Pine function / type / enum outline scanner + right-rail store mode.
 */

import './setup';
import { describe, expect, it } from 'bun:test';
import {
  collectFunctionOutline,
  groupOutlineEntries,
} from '../src/editor/function-outline';
import {
  hydrateEditorRightRail,
  normalizeEditorRightRail,
  setEditorMinimapEnabled,
  setEditorOutlineEnabled,
  setEditorRightRail,
  store,
  toggleEditorMinimapEnabled,
  toggleEditorOutlineEnabled,
} from '../src/store';

const SAMPLE = `//@version=6
indicator("Demo")

export type Point
    float x
    float y
    method length(Point this) =>
        math.sqrt(this.x * this.x + this.y * this.y)

enum Side
    long
    short

foo(x, y) =>
    x + y

export bar(
     a,
     b) =>
    a * b

// not a definition
plot(close)
`;

describe('collectFunctionOutline', () => {
  it('finds functions, methods, types, and enums with line numbers', () => {
    const entries = collectFunctionOutline(SAMPLE);
    const byName = Object.fromEntries(entries.map((e) => [e.name, e]));

    expect(byName.Point?.kind).toBe('type');
    expect(byName.Point?.line).toBe(4);
    expect(byName.Point?.exported).toBe(true);

    expect(byName.length?.kind).toBe('method');
    expect(byName.length?.parent).toBe('Point');
    expect(byName.length?.line).toBe(7);

    expect(byName.Side?.kind).toBe('enum');
    expect(byName.Side?.line).toBe(10);

    expect(byName.foo?.kind).toBe('function');
    expect(byName.foo?.line).toBe(14);

    expect(byName.bar?.kind).toBe('function');
    expect(byName.bar?.exported).toBe(true);
    expect(byName.bar?.line).toBe(17);
  });

  it('ignores comments, strings, and bare calls', () => {
    const src = `
// foo() =>
plot(close)
f = "bar() =>"
real(x) => x
`;
    const entries = collectFunctionOutline(src);
    expect(entries.map((e) => e.name)).toEqual(['real']);
  });

  it('groups in stable section order', () => {
    const groups = groupOutlineEntries(collectFunctionOutline(SAMPLE));
    expect(groups.map((g) => g.kind)).toEqual([
      'function',
      'method',
      'type',
      'enum',
    ]);
  });
});

describe('editor right rail store', () => {
  it('normalizes and hydrates modes', () => {
    expect(normalizeEditorRightRail('outline')).toBe('outline');
    expect(normalizeEditorRightRail('nope')).toBe('off');
    expect(hydrateEditorRightRail({ editorRightRail: 'outline' })).toBe('outline');
    expect(hydrateEditorRightRail({ editorMinimapEnabled: true })).toBe('minimap');
    expect(hydrateEditorRightRail({ editorMinimapEnabled: false })).toBe('off');
  });

  it('keeps minimap and outline mutually exclusive', () => {
    setEditorRightRail('off');
    expect(store.editorRightRail).toBe('off');
    expect(store.editorMinimapEnabled).toBe(false);

    toggleEditorMinimapEnabled();
    expect(store.editorRightRail).toBe('minimap');
    expect(store.editorMinimapEnabled).toBe(true);

    toggleEditorOutlineEnabled();
    expect(store.editorRightRail).toBe('outline');
    expect(store.editorMinimapEnabled).toBe(false);

    setEditorMinimapEnabled(true);
    expect(store.editorRightRail).toBe('minimap');

    setEditorOutlineEnabled(false);
    expect(store.editorRightRail).toBe('off');
  });
});
