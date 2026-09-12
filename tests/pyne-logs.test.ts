/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Pine Logs normalization: object arrays, tuple arrays, filtering, empty input.
 */

import { describe, expect, it } from 'bun:test';
import {
  normalizePyneLogs,
  filterPyneLogs,
  pyneLogsToText,
  type PyneLogEntry,
  type PyneLogLevel,
} from '../src/results/pyne-logs.ts';

describe('normalizePyneLogs', () => {
  it('returns empty array for empty / missing input', () => {
    expect(normalizePyneLogs(null)).toEqual([]);
    expect(normalizePyneLogs(undefined)).toEqual([]);
    expect(normalizePyneLogs({})).toEqual([]);
    expect(normalizePyneLogs([])).toEqual([]);
    expect(normalizePyneLogs({ meta: {} })).toEqual([]);
  });

  it('normalizes object arrays with level/message', () => {
    const raw = {
      logs: [
        { level: 'info', message: 'hello', barIndex: 3, time: 1_700_000_000_000 },
        { level: 'warning', message: 'slow', bar_index: 10 },
        { severity: 'error', msg: 'boom', bar_time: 99 },
      ],
    };
    const entries = normalizePyneLogs(raw);
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
    const entries = normalizePyneLogs(raw);
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
    const fromMeta = normalizePyneLogs({
      meta: { logs: [{ level: 'info', message: 'from-meta' }] },
    });
    expect(fromMeta).toHaveLength(1);
    expect(fromMeta[0]!.message).toBe('from-meta');

    const fromTop = normalizePyneLogs({
      logs: [{ level: 'error', message: 'from-top' }],
    });
    expect(fromTop[0]!.message).toBe('from-top');
  });

  it('maps warn → warning and preserves explicit ids', () => {
    const entries = normalizePyneLogs({
      logs: [{ id: 'x1', level: 'warn', message: 'w' }],
    });
    expect(entries[0]!.id).toBe('x1');
    expect(entries[0]!.level).toBe('warning');
  });
});

describe('filterPyneLogs', () => {
  const sample: PyneLogEntry[] = [
    { id: '1', level: 'info', message: 'i' },
    { id: '2', level: 'warning', message: 'w' },
    { id: '3', level: 'error', message: 'e' },
    { id: '4', level: 'info', message: 'i2' },
  ];

  it('returns all when levels is "all"', () => {
    expect(filterPyneLogs(sample, 'all')).toHaveLength(4);
  });

  it('returns all when level set is empty', () => {
    expect(filterPyneLogs(sample, new Set())).toHaveLength(4);
  });

  it('filters by level set', () => {
    const levels = new Set<PyneLogLevel>(['error', 'warning']);
    const filtered = filterPyneLogs(sample, levels);
    expect(filtered.map((e) => e.level)).toEqual(['warning', 'error']);
  });

  it('returns empty for empty entries', () => {
    expect(filterPyneLogs([], 'all')).toEqual([]);
    expect(filterPyneLogs([], new Set(['info']))).toEqual([]);
  });
});

describe('pyneLogsToText', () => {
  it('exports TSV with header', () => {
    const text = pyneLogsToText([
      { id: '1', level: 'info', message: 'hello', barIndex: 2, time: 10 },
      { id: '2', level: 'error', message: 'nope', barIndex: null, time: null },
    ]);
    expect(text.startsWith('level\tmessage\tbarIndex\ttime')).toBe(true);
    expect(text).toContain('info\thello\t2\t10');
    expect(text).toContain('error\tnope\t\t');
  });

  it('returns empty string for no entries', () => {
    expect(pyneLogsToText([])).toBe('');
  });

  it('sanitizes tabs and newlines in messages', () => {
    const text = pyneLogsToText([
      { id: '1', level: 'info', message: 'a\tb\nc\nd', barIndex: null, time: null },
    ]);
    expect(text).not.toContain('\n\n');
    expect(text.split('\n')).toHaveLength(2);
    expect(text).toContain('a b c d');
  });
});

describe('normalizePyneLogs edge shapes', () => {
  it('maps numeric severities and aliases', () => {
    const entries = normalizePyneLogs({
      logs: [
        { level: '2', message: 'bad' },
        { level: '3', message: 'bad3' },
        { level: '1', message: 'warn1' },
        { level: 'err', message: 'e' },
        { level: 'fatal', message: 'f' },
        { level: 'critical', message: 'c' },
        { level: 'debug', message: 'd' },
        { level: 'trace', message: 't' },
        { level: 'log', message: 'l' },
        { level: '???', message: 'q' },
      ],
    });
    expect(entries.map((e) => e.level)).toEqual([
      'error',
      'error',
      'warning',
      'error',
      'error',
      'error',
      'info',
      'info',
      'info',
      'info',
    ]);
  });

  it('reads pine_logs / messages / result / data nestings', () => {
    expect(
      normalizePyneLogs({ pine_logs: [{ message: 'a' }] })[0]!.message,
    ).toBe('a');
    expect(
      normalizePyneLogs({ pineLogs: [{ message: 'b' }] })[0]!.message,
    ).toBe('b');
    expect(
      normalizePyneLogs({ messages: [{ message: 'c' }] })[0]!.message,
    ).toBe('c');
    expect(
      normalizePyneLogs({ result: { logs: [{ message: 'd' }] } })[0]!.message,
    ).toBe('d');
    expect(
      normalizePyneLogs({ data: { pineLogs: [{ message: 'e' }] } })[0]!.message,
    ).toBe('e');
    expect(
      normalizePyneLogs({ result: { meta: { logs: [{ message: 'f' }] } } })[0]!
        .message,
    ).toBe('f');
    expect(normalizePyneLogs({ result: 42 })).toEqual([]);
    expect(normalizePyneLogs(42)).toEqual([]);
  });

  it('handles single-item tuples and empty tuples', () => {
    expect(normalizePyneLogs([[]])).toEqual([]);
    expect(normalizePyneLogs([['only']])[0]).toMatchObject({
      level: 'info',
      message: 'only',
    });
    expect(normalizePyneLogs([['']])).toEqual([]);
  });

  it('handles message-first tuples and numeric levels', () => {
    const entries = normalizePyneLogs([
      ['hello', 'error'],
      ['msg', '1', 7, 99],
      ['2', 'oops'],
    ]);
    expect(entries[0]).toMatchObject({ level: 'error', message: 'hello' });
    expect(entries[1]).toMatchObject({ level: 'warning', barIndex: 7, time: 99 });
    expect(entries[2]).toMatchObject({ level: 'error' });
  });

  it('handles primitive items with level prefixes', () => {
    const entries = normalizePyneLogs([
      'warn: careful',
      'ERROR: boom',
      '  info  :  hi  ',
      'plain message',
      '   ',
      42,
      true,
      null,
    ]);
    expect(entries[0]).toMatchObject({ level: 'warning', message: 'careful' });
    expect(entries[1]).toMatchObject({ level: 'error', message: 'boom' });
    expect(entries[3]).toMatchObject({ level: 'info', message: 'plain message' });
    expect(entries.find((e) => e.message === '42')).toMatchObject({ level: 'info' });
    expect(entries.find((e) => e.message === 'true')).toBeDefined();
  });

  it('skips empty objects and stringifies object messages', () => {
    expect(normalizePyneLogs({ logs: [{}] })).toEqual([]);
    expect(normalizePyneLogs({ logs: [{ level: 'error' }] })).toHaveLength(1);
    const entries = normalizePyneLogs({
      logs: [{ message: { a: 1 }, line: '3', bar: 'x', time: 'bad', id: '' }],
    });
    expect(entries[0]!.message).toBe('{"a":1}');
    expect(entries[0]!.line).toBe(3);
    expect(entries[0]!.barIndex).toBeNull();
    const floored = normalizePyneLogs({ logs: [{ message: 'm', line: 2.9 }] });
    expect(floored[0]!.line).toBe(2);
    const zeroLine = normalizePyneLogs({ logs: [{ message: 'm', line: 0 }] });
    expect(zeroLine[0]!.line).toBeNull();
  });

  it('filterPyneLogs tolerates non-Set levels', () => {
    const sample: PyneLogEntry[] = [{ id: '1', level: 'info', message: 'i' }];
    expect(filterPyneLogs(sample, 'all')).toHaveLength(1);
    // @ts-expect-error runtime tolerance
    expect(filterPyneLogs(sample, null)).toHaveLength(1);
    expect(filterPyneLogs(null as unknown as PyneLogEntry[], 'all')).toEqual([]);
  });
});
