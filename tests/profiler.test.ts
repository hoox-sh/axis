/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Run profiler normalization: pct math, line map, missing fields.
 */

import { describe, expect, it } from 'bun:test';
import {
  normalizeRunProfile,
  profileLineMap,
  type RunProfile,
} from '../src/results/profiler.ts';

describe('normalizeRunProfile', () => {
  it('returns null for empty / missing input', () => {
    expect(normalizeRunProfile(null)).toBeNull();
    expect(normalizeRunProfile(undefined)).toBeNull();
    expect(normalizeRunProfile({})).toBeNull();
    expect(normalizeRunProfile({ meta: {} })).toBeNull();
    expect(normalizeRunProfile({ profile: {} })).toBeNull();
  });

  it('normalizes object line arrays and computes pct from totalMs', () => {
    const raw = {
      profile: {
        totalMs: 100,
        lines: [
          { line: 1, ms: 10, execs: 50 },
          { line: 5, ms: 40, execs: 50 },
          { line: 10, ms: 50, execs: 25 },
        ],
      },
    };
    const p = normalizeRunProfile(raw);
    expect(p).not.toBeNull();
    expect(p!.totalMs).toBe(100);
    expect(p!.lines).toHaveLength(3);

    const byLine = Object.fromEntries(p!.lines.map((l) => [l.line, l]));
    expect(byLine[1]!.pct).toBeCloseTo(10, 5);
    expect(byLine[5]!.pct).toBeCloseTo(40, 5);
    expect(byLine[10]!.pct).toBeCloseTo(50, 5);
    expect(byLine[1]!.execs).toBe(50);
  });

  it('accepts meta.profile and executions alias', () => {
    const raw = {
      meta: {
        profile: {
          total_ms: 200,
          lines: [
            { line: 2, ms: 20, executions: 3 },
            { line: 8, ms: 180, count: 1 },
          ],
        },
      },
    };
    const p = normalizeRunProfile(raw)!;
    expect(p.totalMs).toBe(200);
    expect(p.lines).toHaveLength(2);
    expect(p.lines.find((l) => l.line === 2)).toMatchObject({ ms: 20, execs: 3, pct: 10 });
    expect(p.lines.find((l) => l.line === 8)!.pct).toBeCloseTo(90, 5);
  });

  it('accepts bare line arrays and top-level profile', () => {
    const bare = normalizeRunProfile([
      { line: 1, ms: 10, execs: 2 },
      { line: 2, ms: 30, execs: 4 },
    ])!;
    expect(bare.lines).toHaveLength(2);
    expect(bare.totalMs).toBe(40);
    expect(bare.lines[0]).toMatchObject({ line: 1, ms: 10, execs: 2, pct: 25 });
    expect(bare.lines[1]).toMatchObject({ line: 2, ms: 30, execs: 4, pct: 75 });
  });

  it('derives totalMs from line sum when no total provided', () => {
    const p = normalizeRunProfile({
      profile: {
        lines: [
          { line: 1, ms: 25, execs: 1 },
          { line: 2, ms: 75, execs: 1 },
        ],
      },
    })!;
    expect(p.totalMs).toBe(100);
    expect(p.lines.find((l) => l.line === 1)!.pct).toBeCloseTo(25, 5);
    expect(p.lines.find((l) => l.line === 2)!.pct).toBeCloseTo(75, 5);
  });

  it('tolerates line map objects and snake_case fields', () => {
    const p = normalizeRunProfile({
      profile: {
        total_ms: 10,
        line_stats: {
          '1': { ms: 3, execs: 3 },
          '7': { time_ms: 7, count: 1 },
        },
      },
    })!;
    expect(p.totalMs).toBe(10);
    expect(p.lines.map((l) => l.line).sort((a, b) => a - b)).toEqual([1, 7]);
    expect(p.lines.find((l) => l.line === 1)!.pct).toBeCloseTo(30, 5);
  });

  it('merges duplicate lines by summing ms/execs', () => {
    const p = normalizeRunProfile({
      lines: [
        { line: 4, ms: 10, execs: 1 },
        { line: 4, ms: 15, execs: 2 },
      ],
    })!;
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0]).toMatchObject({ line: 4, ms: 25, execs: 3 });
  });
});

describe('profileLineMap', () => {
  it('returns empty map for null/undefined/empty', () => {
    expect(profileLineMap(null).size).toBe(0);
    expect(profileLineMap(undefined).size).toBe(0);
    expect(profileLineMap({ lines: [] }).size).toBe(0);
  });

  it('maps line number → ProfileLineStat', () => {
    const profile: RunProfile = {
      totalMs: 100,
      lines: [
        { line: 4, ms: 40, execs: 1, pct: 40 },
        { line: 9, ms: 60, execs: 2, pct: 60 },
      ],
    };
    const map = profileLineMap(profile);
    expect(map.size).toBe(2);
    expect(map.get(4)?.pct).toBe(40);
    expect(map.get(9)?.ms).toBe(60);
    expect(map.get(1)).toBeUndefined();
  });
});
