// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `resolveSessionPayload` contract: full adoption, minimal reuse, tail merge,
 * and mismatch fallback (caller recreates — never apply partial data).
 */

import { describe, expect, it } from 'bun:test';
import { resolveSessionPayload } from '../src/engines/session-delta.ts';

const full = (n: number, keys = ['a']) => ({
  status: 'success',
  count: n,
  plots: Array.from({ length: n }, (_, i) => i + 1),
  series: Object.fromEntries(keys.map((k) => [k, Array.from({ length: n }, (_, i) => i * 10)])),
  events: [],
  meta: { mode: 'interpret' },
});

const delta = (base: number, count: number, tail: number[]) => ({
  status: 'success',
  count,
  plots: tail,
  series: { a: tail.map((v) => v * 10) },
  events: [],
  meta: { mode: 'interpret' },
  appended: tail.length,
  forming: true,
  unchanged: false,
  delta: { base_index: base, count, tail_len: tail.length },
});

describe('resolveSessionPayload', () => {
  it('adopts a full envelope without a delta block', () => {
    const f = full(5);
    const out = resolveSessionPayload(full(4), f);
    expect(out).toEqual(f);
    expect(out).not.toBe(f);
  });

  it('reuses the cache for a minimal unchanged update', () => {
    const cached = full(5);
    const out = resolveSessionPayload(cached, {
      status: 'success',
      count: 5,
      plots: [],
      series: {},
      unchanged: true,
    });
    expect(out).toEqual(cached);
  });

  it('returns null for a minimal update without a cache', () => {
    expect(
      resolveSessionPayload(undefined, {
        status: 'success',
        count: 5,
        plots: [],
        series: {},
        unchanged: true,
      }),
    ).toBeNull();
  });

  it('appends tail cells onto the cached arrays', () => {
    const out = resolveSessionPayload(full(5), delta(5, 7, [6, 7]))!;
    expect(out).not.toBeNull();
    expect(out!.count).toBe(7);
    expect(out!.plots).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect((out!.series as Record<string, number[]>).a).toEqual([0, 10, 20, 30, 40, 60, 70]);
  });

  it('splices the bar-time axis with the tail', () => {
    // The engine ships the evaluated window's axis; a delta carries the
    // tail's times. The merged payload must describe the *whole* window, or
    // the apply path falls back to an index join (displaced plot).
    const cached = { ...full(5), times: [10, 20, 30, 40, 50] };
    const update = { ...delta(5, 7, [6, 7]), times: [60, 70] };
    const out = resolveSessionPayload(cached, update)!;
    expect(out!.times).toEqual([10, 20, 30, 40, 50, 60, 70]);
  });

  it('rejects a delta whose axis is missing on one side', () => {
    const cached = { ...full(5), times: [10, 20, 30, 40, 50] };
    expect(resolveSessionPayload(cached, delta(5, 7, [6, 7]))).toBeNull();
  });

  it('replaces the revised tip on a retick-only delta', () => {
    const out = resolveSessionPayload(full(5), delta(4, 5, [50]))!;
    expect(out!.plots).toEqual([1, 2, 3, 4, 50]);
    expect((out!.series as Record<string, number[]>).a).toEqual([0, 10, 20, 30, 500]);
  });

  it('keeps fresh small fields from the update', () => {
    const u = { ...delta(5, 6, [6]), events: [{ i: 1 }], session_id: 's1' };
    const out = resolveSessionPayload(full(5), u)!;
    expect(out!.events).toEqual([{ i: 1 }]);
    expect(out!.session_id).toBe('s1');
    expect(out).not.toHaveProperty('delta');
  });

  it('returns null on a shrunk count (rebase)', () => {
    expect(resolveSessionPayload(full(7), delta(3, 5, [4, 5]))).toBeNull();
  });

  it('returns null on a gap (base beyond cache)', () => {
    expect(resolveSessionPayload(full(5), delta(6, 8, [7, 8]))).toBeNull();
  });

  it('returns null on series key drift', () => {
    const cached = full(5, ['a']);
    const u = delta(5, 6, [6]);
    (u.series as Record<string, unknown[]>).b = [60];
    delete (u.series as Record<string, unknown[]>).a;
    expect(resolveSessionPayload(cached, u)).toBeNull();
  });

  it('returns null on tail length mismatch', () => {
    const u = delta(5, 7, [6, 7]);
    (u.delta as Record<string, unknown>).tail_len = 3;
    expect(resolveSessionPayload(full(5), u)).toBeNull();
  });

  it('returns null for non-object payloads', () => {
    expect(resolveSessionPayload(full(5), null)).toBeNull();
    expect(resolveSessionPayload(full(5), 'x')).toBeNull();
  });

  it('merges empty/empty columns (plotless strategies)', () => {
    const cached = { status: 'success', count: 5, plots: [], series: {}, meta: {} };
    const u = {
      status: 'success',
      count: 6,
      plots: [],
      series: {},
      meta: {},
      appended: 1,
      delta: { base_index: 5, count: 6, tail_len: 1 },
    };
    const out = resolveSessionPayload(cached, u)!;
    expect(out).not.toBeNull();
    expect(out!.count).toBe(6);
  });
});
