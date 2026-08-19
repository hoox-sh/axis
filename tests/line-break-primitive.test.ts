/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * LineBreakPrimitive: *br plots split on na (LWC Line would connect).
 */

import './setup';
import { describe, expect, it, beforeAll } from 'bun:test';
import { installLightweightChartsMock } from './helpers/mock-lwc';

beforeAll(() => {
  installLightweightChartsMock();
});

const { LineBreakPrimitive } = await import('../src/chart/line-break-primitive');

describe('LineBreakPrimitive', () => {
  it('segments() splits whitespace / na into separate runs', () => {
    const prim = new LineBreakPrimitive();
    prim.setPoints(
      [
        { time: 1, value: 10 },
        { time: 2, value: 11 },
        { time: 3 },
        { time: 4, value: 14 },
        { time: 5, value: 15 },
      ],
      { color: '#34d399', lineWidth: 2, lineStyle: 'solid' },
    );
    expect(prim.segments()).toEqual([
      [
        { time: 1, value: 10 },
        { time: 2, value: 11 },
      ],
      [
        { time: 4, value: 14 },
        { time: 5, value: 15 },
      ],
    ]);
    expect(prim.options().color).toBe('#34d399');
    expect(prim.options().stepped).toBeUndefined();
  });

  it('keeps steplinebr / areabr flags for the renderer', () => {
    const prim = new LineBreakPrimitive();
    prim.setPoints([{ time: 1, value: 1 }], {
      color: '#fff',
      lineWidth: 1,
      lineStyle: 'dashed',
      stepped: true,
      area: true,
    });
    expect(prim.options()).toMatchObject({
      stepped: true,
      area: true,
      lineStyle: 'dashed',
    });
  });

  it('setPoints is a no-op when length, tip, and opts are unchanged', () => {
    const prim = new LineBreakPrimitive();
    const data = [
      { time: 1, value: 10 },
      { time: 2, value: 11 },
    ];
    prim.setPoints(data, { color: '#fff', lineWidth: 2, lineStyle: 'solid' });
    const first = prim.segments();
    prim.setPoints(data, { color: '#fff', lineWidth: 2, lineStyle: 'solid' });
    expect(prim.segments()).toBe(first);
  });
});
