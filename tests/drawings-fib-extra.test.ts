/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Fib extra tools: fibArc, fibWedge, fibCircles — registration + create.
 */

import { describe, expect, it } from 'bun:test';
import '../src/chart/drawings/tools/fib-extra.ts';
import { getToolHandler } from '../src/chart/drawings/tools/registry.ts';

const p1 = { time: 1, price: 100 };
const p2 = { time: 2, price: 50 };
const p3 = { time: 3, price: 80 };

describe('fib-extra tool handlers', () => {
  it('registers fibArc, fibWedge, fibCircles', () => {
    expect(getToolHandler('fibArc')).toBeTruthy();
    expect(getToolHandler('fibWedge')).toBeTruthy();
    expect(getToolHandler('fibCircles')).toBeTruthy();
  });

  it('fibArc arity 2 and create works', () => {
    const h = getToolHandler('fibArc')!;
    expect(h.arity).toBe(2);
    expect(h.create?.([p1], '#abc')).toBeNull();
    const d = h.create?.([p1, p2], '#abc');
    expect(d).toBeTruthy();
    expect(d!.kind).toBe('fibArc');
    expect(d!.color).toBe('#abc');
    if (d && 'p1' in d && 'p2' in d) {
      expect(d.p1).toEqual(p1);
      expect(d.p2).toEqual(p2);
    }
  });

  it('fibWedge arity 3 and create works', () => {
    const h = getToolHandler('fibWedge')!;
    expect(h.arity).toBe(3);
    expect(h.create?.([p1, p2], '#def')).toBeNull();
    const d = h.create?.([p1, p2, p3], '#def');
    expect(d).toBeTruthy();
    expect(d!.kind).toBe('fibWedge');
    expect(d!.color).toBe('#def');
    if (d && 'points' in d) {
      expect(d.points).toHaveLength(3);
    }
  });

  it('fibCircles arity 2 and create works', () => {
    const h = getToolHandler('fibCircles')!;
    expect(h.arity).toBe(2);
    expect(h.create?.([p1], '#123')).toBeNull();
    const d = h.create?.([p1, p2], '#123');
    expect(d).toBeTruthy();
    expect(d!.kind).toBe('fibCircles');
    expect(d!.color).toBe('#123');
    if (d && 'p1' in d && 'p2' in d) {
      expect(d.p1).toEqual(p1);
      expect(d.p2).toEqual(p2);
    }
  });

  it('handlers expose paint and hit', () => {
    for (const id of ['fibArc', 'fibWedge', 'fibCircles'] as const) {
      const h = getToolHandler(id)!;
      expect(typeof h.paint).toBe('function');
      expect(typeof h.hit).toBe('function');
    }
  });
});
