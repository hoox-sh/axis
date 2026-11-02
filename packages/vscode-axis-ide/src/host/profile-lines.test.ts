// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, test } from 'bun:test';
import {
  formatPct,
  hotProfileLineNumbers,
  normalizeProfileLines,
  profileLineTooltip,
  type ProfileLineStat,
} from './profile-lines';

function stat(line: number, ms: number, execs = 1, pct = 0): ProfileLineStat {
  return { line, ms, execs, pct };
}

function throwing(keys: readonly string[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  const row: Record<string, unknown> = { ...extra };
  for (const key of keys) {
    Object.defineProperty(row, key, {
      enumerable: true,
      get() {
        throw new Error(`hostile ${key}`);
      },
    });
  }
  return row;
}

describe('formatPct', () => {
  test('zero, negative, and non-finite are 0%', () => {
    expect(formatPct(0)).toBe('0%');
    expect(formatPct(-1)).toBe('0%');
    expect(formatPct(Number.NaN)).toBe('0%');
    expect(formatPct(Number.POSITIVE_INFINITY)).toBe('0%');
  });

  test('sub-tenth, one decimal under 10, else a rounded integer', () => {
    expect(formatPct(0.05)).toBe('<0.1%');
    expect(formatPct(0.1)).toBe('0.1%');
    expect(formatPct(1)).toBe('1.0%');
    expect(formatPct(9.94)).toBe('9.9%');
    expect(formatPct(9.95)).toBe('10.0%');
    expect(formatPct(10)).toBe('10%');
    expect(formatPct(10.4)).toBe('10%');
    expect(formatPct(10.5)).toBe('11%');
    expect(formatPct(99.6)).toBe('100%');
  });
});

describe('profileLineTooltip', () => {
  test('uses formatPct for the share of script body', () => {
    expect(profileLineTooltip(stat(4.2, 1.5, 2.9, 12))).toBe(
      'Line 4 · 1.5 ms · 2 execs · 12% of script body',
    );
    expect(profileLineTooltip(stat(Number.NaN, Number.POSITIVE_INFINITY, Number.NaN, Number.NaN))).toBe(
      'Line 0 · 0.0 ms · 0 execs · 0% of script body',
    );
  });

  test('hostile getters and null collapse to an empty tooltip', () => {
    const evil = throwing(['line', 'ms', 'execs', 'pct']) as unknown as ProfileLineStat;
    expect(profileLineTooltip(evil)).toBe('Line 0 · 0.0 ms · 0 execs · 0% of script body');
    expect(profileLineTooltip(null as unknown as ProfileLineStat)).toBe(
      'Line 0 · 0.0 ms · 0 execs · 0% of script body',
    );
  });
});

describe('normalizeProfileLines', () => {
  test('rejects non-objects and profiles with no line rows', () => {
    expect(normalizeProfileLines(null)).toEqual([]);
    expect(normalizeProfileLines(1)).toEqual([]);
    expect(normalizeProfileLines('x')).toEqual([]);
    expect(normalizeProfileLines(true)).toEqual([]);
    expect(normalizeProfileLines({})).toEqual([]);
    expect(normalizeProfileLines({ phases: { parse_ms: 1 } })).toEqual([]);
    expect(
      normalizeProfileLines({
        total_ms: 40,
        phases: { parse_ms: 10, eval_ms: 30 },
        lines: [],
      }),
    ).toEqual([]);
  });

  test('reads lines, line_stats, aliases, and fills pct from total or sum', () => {
    expect(
      normalizeProfileLines({
        lines: [
          { line: 10, ms: 25, execs: 1 },
          { line: 2, ms: 75, execs: 2 },
        ],
      }),
    ).toEqual([
      { line: 2, ms: 75, execs: 2, pct: 75 },
      { line: 10, ms: 25, execs: 1, pct: 25 },
    ]);

    expect(
      normalizeProfileLines({
        totalMs: 200,
        lines: [
          { line: 1, ms: 25, execs: 1 },
          { line: 2, ms: 75, execs: 2, pct: 7 },
        ],
      }),
    ).toEqual([
      { line: 1, ms: 25, execs: 1, pct: 12.5 },
      { line: 2, ms: 75, execs: 2, pct: 7 },
    ]);

    expect(
      normalizeProfileLines({
        profile: {
          total_ms: '40',
          phases: { eval_ms: 40 },
          line_stats: [{ lineno: 3, time: 10, count: 2 }],
        },
      }),
    ).toEqual([{ line: 3, ms: 10, execs: 2, pct: 25 }]);

    expect(
      normalizeProfileLines({
        meta: {
          runProfile: {
            total_ms: 80,
            phases: { parse_ms: 5 },
            lines: [{ line: '2', ms: 20, execs: 1 }],
          },
        },
      }),
    ).toEqual([{ line: 2, ms: 20, execs: 1, pct: 25 }]);
  });

  test('prefers nested profile over sibling rows and keeps an explicit zero pct', () => {
    expect(
      normalizeProfileLines({
        meta: {
          profile: { lines: [{ line: 1, ms: 2, execs: 1, pct: 0 }] },
          runProfile: { lines: [{ line: 9, ms: 50, execs: 1 }] },
        },
        profile: { lines: [{ line: 8, ms: 50, execs: 1 }] },
        lines: [{ line: 7, ms: 50, execs: 1 }],
      }),
    ).toEqual([{ line: 1, ms: 2, execs: 1, pct: 0 }]);

    expect(
      normalizeProfileLines({
        meta: { script_name: 'A' },
        profile: 1,
        lines: [{ line: 4, ms: 5, execs: 1 }],
      }),
    ).toEqual([{ line: 4, ms: 5, execs: 1, pct: 100 }]);

    expect(
      normalizeProfileLines({
        profile: [{ line: 4, ms: 1, execs: 2.9, pct: '3' }],
      }),
    ).toEqual([{ line: 4, ms: 1, execs: 2, pct: 3 }]);

    expect(normalizeProfileLines([{ line: '1.8', ms: 1, execs: 1 }])).toEqual([
      { line: 1, ms: 1, execs: 1, pct: 100 },
    ]);
  });

  test('falls through aliases, merges duplicates, and skips junk rows', () => {
    expect(
      normalizeProfileLines({
        totalMs: -3,
        total_ms: 40,
        lines: [
          null,
          1,
          [],
          { ms: 9, execs: 1 },
          { line: '', line_no: '  ', lineno: 'x', ms: 1, execs: 1 },
          { line: 0, line_no: 0, lineno: 6, time: 10, count: 1 },
          { line: '0.2', line_no: '2.9', ms: -1, time_ms: -2, time: 10, execs: -4, count: 4 },
          { line: 2, ms: '  ', time_ms: 'nope', time: '1.25', execs: '2.9', pct: -5 },
          { line: 5, ms: Number.NaN, time_ms: Number.POSITIVE_INFINITY, time: 4, execs: true, count: 1, pct: {} },
          { line: 2, ms: 10, execs: 2, pct: 1 },
          { line: 2, ms: 8.75, execs: 3, pct: 99 },
        ],
      }),
    ).toEqual([
      { line: 2, ms: 30, execs: 11, pct: 75 },
      { line: 5, ms: 4, execs: 1, pct: 10 },
      { line: 6, ms: 10, execs: 1, pct: 25 },
    ]);
  });

  test('empty lines stay empty even when line_stats is present; non-array lines fall through', () => {
    expect(
      normalizeProfileLines({
        lines: [],
        line_stats: [{ line: 1, ms: 1, execs: 1 }],
      }),
    ).toEqual([]);
    expect(
      normalizeProfileLines({
        lines: 'nope',
        line_stats: [{ line: 1, time_ms: 4, count: 2 }],
      }),
    ).toEqual([{ line: 1, ms: 4, execs: 2, pct: 100 }]);
  });

  test('explicit total of 0 does not invent percents', () => {
    expect(
      normalizeProfileLines({
        totalMs: 0,
        lines: [{ line: 1, ms: 10, execs: 0 }],
      }),
    ).toEqual([{ line: 1, ms: 10, execs: 0, pct: 0 }]);
  });

  test('zero-ms lines stay in the list with a zero share', () => {
    expect(
      normalizeProfileLines({
        totalMs: 10,
        lines: [{ line: 3, ms: 0, execs: 4, pct: ' 8 ' }],
      }),
    ).toEqual([{ line: 3, ms: 0, execs: 4, pct: 8 }]);
    expect(
      normalizeProfileLines({
        lines: [{ line: 3, ms: 0, execs: 4 }],
      }),
    ).toEqual([{ line: 3, ms: 0, execs: 4, pct: 0 }]);
    expect(normalizeProfileLines({ lines: [{ line: 7 }] })).toEqual([
      { line: 7, ms: 0, execs: 0, pct: 0 },
    ]);
  });

  test('hostile getters are skipped; later aliases and sibling rows still count', () => {
    const lineAlias = throwing(['line'], { line_no: 8, ms: 2, execs: 1 });
    const msAlias = throwing(['ms'], { line: 9, time_ms: 4, execs: 1 });
    const execAlias = throwing(['execs'], { line: 10, ms: 4, count: 6 });
    const pctHostile = throwing(['pct'], { line: 11, ms: 10, execs: 1 });
    const deadLine = throwing(['line', 'line_no', 'lineno'], { ms: 99, execs: 1 });
    const rows = throwing(['lines'], {
      line_stats: [lineAlias, msAlias, execAlias, pctHostile, deadLine, { line: 12, ms: 0, execs: 1 }],
    });
    expect(normalizeProfileLines(rows)).toEqual([
      { line: 8, ms: 2, execs: 1, pct: 10 },
      { line: 9, ms: 4, execs: 1, pct: 20 },
      { line: 10, ms: 4, execs: 6, pct: 20 },
      { line: 11, ms: 10, execs: 1, pct: 50 },
      { line: 12, ms: 0, execs: 1, pct: 0 },
    ]);

    const meta = throwing(['profile'], {
      runProfile: { lines: [{ line: 3, ms: 6, execs: 1 }] },
    });
    expect(normalizeProfileLines({ meta })).toEqual([{ line: 3, ms: 6, execs: 1, pct: 100 }]);

    const badHas = new Proxy(
      {},
      {
        has() {
          throw new Error('has');
        },
      },
    );
    expect(
      normalizeProfileLines({
        meta: { profile: badHas, runProfile: { totalMs: 10, lines: [{ line: 1, ms: 5, execs: 1 }] } },
      }),
    ).toEqual([{ line: 1, ms: 5, execs: 1, pct: 50 }]);

    const record = throwing(['meta', 'profile', 'runProfile'], {
      lines: [{ line: 1, ms: 2, execs: 1 }],
    });
    expect(normalizeProfileLines(record)).toEqual([{ line: 1, ms: 2, execs: 1, pct: 100 }]);

    const root = new Proxy(
      { lines: [{ line: 1, ms: 1, execs: 1 }] },
      {
        get() {
          throw new Error('root');
        },
      },
    );
    expect(normalizeProfileLines(root)).toEqual([]);

    const total = throwing(['totalMs'], {
      total_ms: 50,
      lines: [{ line: 1, ms: 10, execs: 1 }],
    });
    expect(normalizeProfileLines(total)).toEqual([{ line: 1, ms: 10, execs: 1, pct: 20 }]);
  });

  test('hostile length, bad length, hostile index, and a huge length are bounded', () => {
    const lenThrow = new Proxy([{ line: 1, ms: 1, execs: 1 }], {
      get(target, key, recv) {
        if (key === 'length') throw new Error('len');
        return Reflect.get(target, key, recv);
      },
    });
    expect(normalizeProfileLines({ lines: lenThrow })).toEqual([]);

    const lenBad = new Proxy([{ line: 1, ms: 1, execs: 1 }], {
      get(target, key, recv) {
        if (key === 'length') return 2.5;
        return Reflect.get(target, key, recv);
      },
    });
    expect(normalizeProfileLines(lenBad)).toEqual([]);

    const lenString = new Proxy([], {
      get(target, key, recv) {
        if (key === 'length') return '3';
        return Reflect.get(target, key, recv);
      },
    });
    expect(normalizeProfileLines({ line_stats: lenString })).toEqual([]);

    const lenNeg = new Proxy([], {
      get(target, key, recv) {
        if (key === 'length') return -1;
        return Reflect.get(target, key, recv);
      },
    });
    expect(normalizeProfileLines({ lines: lenNeg })).toEqual([]);

    const idxThrow = new Proxy(
      [
        { line: 1, ms: 9, execs: 1 },
        { line: 2, ms: 1, execs: 1 },
      ],
      {
        get(target, key, recv) {
          if (key === '0') throw new Error('idx');
          return Reflect.get(target, key, recv);
        },
      },
    );
    expect(normalizeProfileLines({ lines: idxThrow })).toEqual([{ line: 2, ms: 1, execs: 1, pct: 100 }]);

    const capped = new Proxy([] as unknown[], {
      get(_target, key) {
        if (key === 'length') return 100_001;
        if (key === '0') return { line: 1, ms: 1, execs: 1 };
        if (key === '100000') return { line: 9, ms: 99, execs: 1 };
        return undefined;
      },
    });
    expect(normalizeProfileLines({ lines: capped })).toEqual([{ line: 1, ms: 1, execs: 1, pct: 100 }]);
  });

  test('meta that is not a profile object falls through to the record', () => {
    expect(
      normalizeProfileLines({
        meta: null,
        runProfile: { lines: [{ line: 2, ms: 3, execs: 1, pct: 12.5 }] },
      }),
    ).toEqual([{ line: 2, ms: 3, execs: 1, pct: 12.5 }]);
    expect(
      normalizeProfileLines({
        meta: ['nope'],
        profile: { foo: 1 },
        lines: [{ line: 1, ms: 0, execs: 1, time: 4 }],
      }),
    ).toEqual([{ line: 1, ms: 0, execs: 1, pct: 0 }]);
  });
});

describe('hotProfileLineNumbers', () => {
  test('top 3 by ms, ms>0 only, ties break to the smaller line', () => {
    expect(hotProfileLineNumbers(null as unknown as ProfileLineStat[])).toEqual([]);
    expect(hotProfileLineNumbers([])).toEqual([]);
    expect(
      hotProfileLineNumbers([
        stat(10, 1),
        stat(3, 4),
        stat(8, 4),
        stat(1, 2),
        stat(5, 0, 9),
        stat(0, 50),
        stat(Number.NaN, 50),
        { line: 2, ms: '3' as unknown as number, execs: 1, pct: 0 },
      ]),
    ).toEqual([3, 8, 1]);
    expect(hotProfileLineNumbers([stat(4.9, 5)])).toEqual([4]);
  });

  test('skips null, non-objects, hostile elements, and hostile length', () => {
    const evil = throwing(['ms'], { line: 1 }) as unknown as ProfileLineStat;
    expect(hotProfileLineNumbers([null as unknown as ProfileLineStat, 1 as unknown as ProfileLineStat, evil, stat(6, 2)])).toEqual([
      6,
    ]);

    const lenThrow = new Proxy([stat(1, 1)], {
      get(target, key, recv) {
        if (key === 'length') throw new Error('len');
        return Reflect.get(target, key, recv);
      },
    });
    expect(hotProfileLineNumbers(lenThrow)).toEqual([]);

    const lenBad = new Proxy([stat(1, 1)], {
      get(target, key, recv) {
        if (key === 'length') return -1;
        return Reflect.get(target, key, recv);
      },
    });
    expect(hotProfileLineNumbers(lenBad)).toEqual([]);

    const idxThrow = new Proxy([stat(1, 9), stat(2, 1)], {
      get(target, key, recv) {
        if (key === '0') throw new Error('idx');
        return Reflect.get(target, key, recv);
      },
    });
    expect(hotProfileLineNumbers(idxThrow)).toEqual([2]);
  });
});
