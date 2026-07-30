/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Pine Logs normalization: object arrays, tuple arrays, filtering, empty input.
 */

import { describe, expect, it } from 'bun:test';
import {
  normalizePineLogs,
  filterPineLogs,
  pineLogsToText,
  type PineLogEntry,
  type PineLogLevel,
} from '../src/results/pine-logs.ts';

describe('normalizePineLogs', () => {
  it('returns empty array for empty / missing input', () => {
    expect(normalizePineLogs(null)).toEqual([]);
    expect(normalizePineLogs(undefined)).toEqual([]);
    expect(normalizePineLogs({})).toEqual([]);
    expect(normalizePineLogs([])).toEqual([]);
    expect(normalizePineLogs({ meta: {} })).toEqual([]);
  });

  it('normalizes object arrays with level/message', () => {
    const raw = {
      logs: [
        { level: 'info', message: 'hello', barIndex: 3, time: 1_700_000_000_000 },
        { level: 'warning', message: 'slow', bar_index: 10 },
        { severity: 'error', msg: 'boom', bar_time: 99 },
      ],
    };
    const entries = normalizePineLogs(raw);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      level: 'info',
      message: 'hello',
      barIndex: 3,
      time: 1_700_000_000_000,
    });
    expect(entries[1]).toMatchObject({ level: 'warning', message: 'slow', barIndex: 10 });
    expect(entries[2]).toMatchObject({ level: 'error', message: 'boom', time: 99 });
    expect(entries.every((e) => typeof e.id === 'string' && e.id.length > 0)).toBe(true);
  });

  it('normalizes tuple arrays [level, msg]', () => {
    const raw = [
      ['info', 'a'],
      ['warn', 'b'],
      ['error', 'c', 5, 1234],
    ];
    const entries = normalizePineLogs(raw);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ level: 'info', message: 'a' });
    expect(entries[1]).toMatchObject({ level: 'warning', message: 'b' });
    expect(entries[2]).toMatchObject({
      level: 'error',
      message: 'c',
      barIndex: 5,
      time: 1234,
    });
  });

  it('reads meta.logs and top-level logs', () => {
    const fromMeta = normalizePineLogs({
      meta: { logs: [{ level: 'info', message: 'from-meta' }] },
    });
    expect(fromMeta).toHaveLength(1);
    expect(fromMeta[0]!.message).toBe('from-meta');

    const fromTop = normalizePineLogs({
      logs: [{ level: 'error', message: 'from-top' }],
    });
    expect(fromTop[0]!.message).toBe('from-top');
  });

  it('maps warn → warning and preserves explicit ids', () => {
    const entries = normalizePineLogs({
      logs: [{ id: 'x1', level: 'warn', message: 'w' }],
    });
    expect(entries[0]!.id).toBe('x1');
    expect(entries[0]!.level).toBe('warning');
  });
});

describe('filterPineLogs', () => {
  const sample: PineLogEntry[] = [
    { id: '1', level: 'info', message: 'i' },
    { id: '2', level: 'warning', message: 'w' },
    { id: '3', level: 'error', message: 'e' },
    { id: '4', level: 'info', message: 'i2' },
  ];

  it('returns all when levels is "all"', () => {
    expect(filterPineLogs(sample, 'all')).toHaveLength(4);
  });

  it('returns all when level set is empty', () => {
    expect(filterPineLogs(sample, new Set())).toHaveLength(4);
  });

  it('filters by level set', () => {
    const levels = new Set<PineLogLevel>(['error', 'warning']);
    const filtered = filterPineLogs(sample, levels);
    expect(filtered.map((e) => e.level)).toEqual(['warning', 'error']);
  });

  it('returns empty for empty entries', () => {
    expect(filterPineLogs([], 'all')).toEqual([]);
    expect(filterPineLogs([], new Set(['info']))).toEqual([]);
  });
});

describe('pineLogsToText', () => {
  it('exports TSV with header', () => {
    const text = pineLogsToText([
      { id: '1', level: 'info', message: 'hello', barIndex: 2, time: 10 },
      { id: '2', level: 'error', message: 'nope', barIndex: null, time: null },
    ]);
    expect(text.startsWith('level\tmessage\tbarIndex\ttime')).toBe(true);
    expect(text).toContain('info\thello\t2\t10');
    expect(text).toContain('error\tnope\t\t');
  });

  it('returns empty string for no entries', () => {
    expect(pineLogsToText([])).toBe('');
  });
});
