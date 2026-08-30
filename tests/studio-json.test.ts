/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import {
  JSON_EXPAND_MAX,
  JSON_PAGE,
  childCount,
  childEntries,
  childPath,
  collectOpenPaths,
  formatPrimitive,
  isContainer,
  jsonKind,
  jsonStats,
  keyMatches,
  previewLabel,
  primitiveMatches,
  subtreeMatches,
} from '../src/ui/studio/json-tree';

const sample = {
  status: 'success',
  plots: [1, 2, 3],
  series: { close: [10, 11, 12], rsi: [40, 50] },
  events: [{ type: 'entry' }],
  meta: { script_name: 'RSI', ms: 12 },
  empty: {},
  none: null,
};

describe('jsonKind / containers', () => {
  it('classifies primitives and containers', () => {
    expect(jsonKind(null)).toBe('null');
    expect(jsonKind(true)).toBe('bool');
    expect(jsonKind(1.5)).toBe('number');
    expect(jsonKind('ok')).toBe('string');
    expect(jsonKind([])).toBe('empty');
    expect(jsonKind({})).toBe('empty');
    expect(jsonKind([1])).toBe('array');
    expect(jsonKind({ a: 1 })).toBe('object');
  });

  it('empty containers are not expandable', () => {
    expect(isContainer([])).toBe(false);
    expect(isContainer({})).toBe(false);
    expect(isContainer([1])).toBe(true);
    expect(isContainer({ a: 1 })).toBe(true);
  });
});

describe('preview / primitive format', () => {
  it('labels collapsed containers by size', () => {
    expect(previewLabel([1, 2, 3])).toBe('[3]');
    expect(previewLabel({ a: 1, b: 2 })).toBe('{2}');
    expect(previewLabel([])).toBe('[]');
    expect(previewLabel({})).toBe('{}');
  });

  it('quotes strings and keeps JSON tokens', () => {
    expect(formatPrimitive('hi')).toEqual({ kind: 'string', text: '"hi"' });
    expect(formatPrimitive(null)).toEqual({ kind: 'null', text: 'null' });
    expect(formatPrimitive(false)).toEqual({ kind: 'bool', text: 'false' });
    expect(formatPrimitive(3)).toEqual({ kind: 'number', text: '3' });
  });
});

describe('walk / stats', () => {
  it('counts keys, arrays, and leaf values', () => {
    const s = jsonStats(sample);
    expect(s.arrays).toBe(4); // plots, close, rsi, events
    expect(s.keys).toBeGreaterThan(6);
    expect(s.values).toBeGreaterThan(8);
  });

  it('pages children without flattening', () => {
    expect(childCount(sample.plots)).toBe(3);
    expect(childEntries(sample.series).map(([k]) => k)).toEqual(['close', 'rsi']);
    expect(childPath('$', 'meta')).toBe('$.meta');
    expect(childPath('$.meta', 'ms')).toBe('$.meta.ms');
    expect(JSON_PAGE).toBe(32);
  });
});

describe('expand paths', () => {
  it('opens objects and skips huge arrays', () => {
    const huge = { meta: { a: 1 }, plots: Array.from({ length: JSON_EXPAND_MAX + 1 }, (_, i) => i) };
    const paths = collectOpenPaths(huge);
    expect(paths).toContain('$');
    expect(paths).toContain('$.meta');
    expect(paths).not.toContain('$.plots');
  });
});

describe('filter', () => {
  it('matches keys and primitive text', () => {
    expect(keyMatches('script_name', 'script')).toBe(true);
    expect(keyMatches('ms', 'rsi')).toBe(false);
    expect(primitiveMatches('RSI', 'rsi')).toBe(true);
    expect(primitiveMatches(12, '12')).toBe(true);
  });

  it('finds nested keys without walking huge arrays', () => {
    expect(subtreeMatches(sample, 'script_name')).toBe(true);
    expect(subtreeMatches(sample, 'nope-xyz')).toBe(false);
    const huge = { plots: Array.from({ length: 200 }, (_, i) => i), name: 'ok' };
    expect(subtreeMatches(huge, 'name')).toBe(true);
    expect(subtreeMatches(huge, '199')).toBe(false);
  });
});
