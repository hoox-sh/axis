/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * On-chain CSV / download export helpers (`src/onchain/export.ts`).
 * Pure serializers — no network.
 */

import { describe, expect, it } from 'bun:test';
import {
  seriesToCsv,
  eventsToCsv,
  downloadTextFile,
} from '../src/onchain/export';

describe('seriesToCsv', () => {
  it('returns header only for empty / non-array input', () => {
    expect(seriesToCsv([])).toBe('series,time,value');
    expect(seriesToCsv(null as unknown as [])).toBe('series,time,value');
    expect(seriesToCsv(undefined as unknown as [])).toBe('series,time,value');
  });

  it('emits long-format rows for one series', () => {
    const csv = seriesToCsv([
      {
        label: 'Aave TVL',
        points: [
          { time: 100, value: 1_000 },
          { time: 200, value: 2_000 },
        ],
      },
    ]);
    expect(csv).toBe(
      ['series,time,value', 'Aave TVL,100,1000', 'Aave TVL,200,2000'].join('\n'),
    );
  });

  it('concatenates multiple series and skips non-finite points', () => {
    const csv = seriesToCsv([
      {
        label: 'A',
        points: [
          { time: 1, value: 10 },
          { time: Number.NaN, value: 1 },
          { time: 2, value: Number.POSITIVE_INFINITY },
        ],
      },
      {
        label: 'B',
        points: [{ time: 3, value: 30 }],
      },
      null as unknown as { label: string; points: [] },
      {
        label: 'C',
        points: null as unknown as [],
      },
    ]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('series,time,value');
    expect(lines).toContain('A,1,10');
    expect(lines).toContain('B,3,30');
    expect(lines).toHaveLength(3);
  });

  it('escapes labels with commas, quotes, and newlines', () => {
    const csv = seriesToCsv([
      {
        label: 'Foo, "Bar"',
        points: [{ time: 1, value: 2 }],
      },
    ]);
    expect(csv.split('\n')[1]).toBe('"Foo, ""Bar""",1,2');
  });
});

describe('eventsToCsv', () => {
  it('returns header only for empty / non-array input', () => {
    expect(eventsToCsv([])).toBe('time,type,title,severity,price');
    expect(eventsToCsv(null as unknown as [])).toBe(
      'time,type,title,severity,price',
    );
  });

  it('serializes event rows with optional empty cells', () => {
    const csv = eventsToCsv([
      {
        time: 100,
        type: 'tvl_spike',
        title: 'Aave +20%',
        severity: 'warn',
        price: 120,
      },
      {
        time: 200,
        type: 'tvl_drop',
      },
    ]);
    expect(csv).toBe(
      [
        'time,type,title,severity,price',
        '100,tvl_spike,Aave +20%,warn,120',
        '200,tvl_drop,,,',
      ].join('\n'),
    );
  });

  it('skips non-finite time, empty type, and non-objects', () => {
    const csv = eventsToCsv([
      null as unknown as { time: number; type: string },
      { time: Number.NaN, type: 'x' },
      { time: 1, type: '' },
      { time: 2, type: 'ok', title: 'a,b', severity: 'info', price: Number.NaN },
    ]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('2,ok,"a,b",info,');
  });

  it('escapes type / title / severity with quotes', () => {
    const csv = eventsToCsv([
      {
        time: 5,
        type: 'a"b',
        title: 'hello\nworld',
        severity: 'crit,ical',
        price: 1.5,
      },
    ]);
    // Full body (do not split on \n — title may contain embedded newlines)
    expect(csv).toBe(
      'time,type,title,severity,price\n5,"a""b","hello\nworld","crit,ical",1.5',
    );
  });
});

describe('downloadTextFile', () => {
  it('does not throw in test environment', () => {
    // Bun may provide document; implementation no-ops or downloads safely
    expect(() =>
      downloadTextFile('tvl.csv', 'series,time,value\n', 'text/csv'),
    ).not.toThrow();
  });
});
