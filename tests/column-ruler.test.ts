// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Column ruler helpers + CM6 extension factory.
 */

import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_RULER_COLUMN,
  RULER_STROKE,
  normalizeRulerColumn,
  rulerOffsetFromContent,
  columnRulerExtension,
} from '../src/editor/column-ruler.ts';

describe('DEFAULT_RULER_COLUMN', () => {
  it('is 80', () => {
    expect(DEFAULT_RULER_COLUMN).toBe(80);
  });
});

describe('normalizeRulerColumn', () => {
  it('defaults missing / non-finite to 80', () => {
    expect(normalizeRulerColumn(undefined)).toBe(80);
    expect(normalizeRulerColumn(null)).toBe(80);
    expect(normalizeRulerColumn(NaN)).toBe(80);
    expect(normalizeRulerColumn(Infinity)).toBe(80);
  });

  it('floors and clamps below 1', () => {
    expect(normalizeRulerColumn(80.9)).toBe(80);
    expect(normalizeRulerColumn(1)).toBe(1);
    expect(normalizeRulerColumn(0)).toBe(1);
    expect(normalizeRulerColumn(-5)).toBe(1);
  });
});

describe('rulerOffsetFromContent', () => {
  it('multiplies character width by column', () => {
    expect(rulerOffsetFromContent(8, 80)).toBe(640);
    expect(rulerOffsetFromContent(10, 100)).toBe(1000);
  });

  it('treats non-positive width as zero offset', () => {
    expect(rulerOffsetFromContent(0, 80)).toBe(0);
    expect(rulerOffsetFromContent(-2, 80)).toBe(0);
  });
});

describe('columnRulerExtension', () => {
  it('returns a non-empty extension (array or facet value)', () => {
    const ext = columnRulerExtension();
    expect(ext).toBeDefined();
    // Factory returns a bundle (theme + plugin)
    if (Array.isArray(ext)) {
      expect(ext.length).toBeGreaterThan(0);
    } else {
      expect(ext).toBeTruthy();
    }
  });

  it('accepts custom column and enabled callback', () => {
    const ext = columnRulerExtension({
      column: 100,
      enabled: () => false,
    });
    expect(ext).toBeDefined();
    if (Array.isArray(ext)) {
      expect(ext.length).toBeGreaterThan(0);
    }
  });
});

describe('RULER_STROKE', () => {
  it('is void-indigo at low alpha', () => {
    expect(RULER_STROKE).toBe('rgba(147,159,255,0.25)');
  });
});
