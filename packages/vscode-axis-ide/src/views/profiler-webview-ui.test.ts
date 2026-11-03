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
  PROTOCOL_VERSION,
  barWidthPct,
  decodeHostMessage,
  encodeProfilerCopy,
  encodeProfilerReady,
  encodeProfilerReveal,
  formatPctChip,
  snapshotFromPayload,
} from '../../webview/profiler/src/protocol';

describe('profiler webview protocol', () => {
  test('encodeProfilerReady is a local envelope', () => {
    expect(PROTOCOL_VERSION).toBe(1);
    const msg = encodeProfilerReady(7);
    expect(msg.type).toBe('profiler.ready');
    expect(msg.payload).toEqual({});
    expect(msg.ts).toBe(7);
    expect(encodeProfilerReady().type).toBe('profiler.ready');
  });

  test('encodeProfilerReveal / encodeProfilerCopy are local (not axis.webview.v1)', () => {
    expect(encodeProfilerReveal(4)).toEqual({ type: 'profiler.reveal', line: 4 });
    expect(encodeProfilerCopy('run-1')).toEqual({ type: 'profiler.copy', runId: 'run-1' });
    expect('v' in encodeProfilerReveal(1)).toBe(false);
  });

  test('decodeHostMessage accepts profiler.set and results.set', () => {
    expect(decodeHostMessage({ type: 'profiler.set', payload: { runId: 'r' } })).toEqual({
      ok: true,
      type: 'profiler.set',
      payload: { runId: 'r' },
    });
    expect(decodeHostMessage({ type: 'profiler.set' }).ok).toBe(true);
    expect(decodeHostMessage({ type: 'profiler.set', payload: null }).ok).toBe(true);
    expect(decodeHostMessage({ type: 'results.set', payload: { lastRun: { id: 'x' } } }).ok).toBe(
      true,
    );
    expect(decodeHostMessage(null).ok).toBe(false);
    expect(decodeHostMessage([]).ok).toBe(false);
    expect(decodeHostMessage({ type: '' }).ok).toBe(false);
    expect(decodeHostMessage({ type: 1 }).ok).toBe(false);
    expect(decodeHostMessage({ type: 'host.error' }).ok).toBe(false);
    expect(decodeHostMessage({ type: 'profiler.set', payload: [] }).ok).toBe(false);
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('decode');
        },
      },
    );
    const failed = decodeHostMessage(hostile);
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error).toContain('decode failed');
  });

  test('snapshotFromPayload reads profiler.set and derives results.set lastRun', () => {
    expect(snapshotFromPayload(null)).toBeNull();
    expect(snapshotFromPayload([])).toBeNull();
    expect(snapshotFromPayload({})).toBeNull();
    expect(
      snapshotFromPayload({
        runId: 'run-1',
        status: 'success',
        ms: 12.4,
        engineId: 'server',
        seriesKey: 'k',
        plotCount: 3,
        seriesCount: 2,
        createdAt: 9,
        error: '  ',
        topLines: [
          { line: 4, ms: 8, execs: 2, pct: 40 },
          { line: 0, ms: 1, execs: 1, pct: 1 },
        ],
        lineCount: 5,
        phases: [
          { name: 'parse_ms', ms: 2 },
          { name: '', ms: 1 },
          { name: 'eval_ms', ms: 10 },
        ],
      }),
    ).toEqual({
      runId: 'run-1',
      status: 'success',
      ms: 12.4,
      engineId: 'server',
      seriesKey: 'k',
      plotCount: 3,
      seriesCount: 2,
      createdAt: 9,
      topLines: [{ line: 4, ms: 8, execs: 2, pct: 40 }],
      lineCount: 5,
      phases: [
        { name: 'parse_ms', ms: 2 },
        { name: 'eval_ms', ms: 10 },
      ],
    });
    const derived = snapshotFromPayload({
      lastRun: {
        id: 'run-9',
        status: 'error',
        engineId: 'server',
        seriesKey: 'k',
        plots: [1, 2, 3, 4],
        series: { a: 1 },
        meta: { ms: 40 },
        error: 'nope',
      },
    });
    expect(derived).toMatchObject({
      runId: 'run-9',
      status: 'error',
      ms: 40,
      plotCount: 4,
      seriesCount: 1,
      error: 'nope',
      topLines: [],
      lineCount: 0,
    });
    expect(snapshotFromPayload({ plots: { x: 1 } })).toBeNull();
    expect(snapshotFromPayload({ lastRun: 'nope' })).toBeNull();
    expect(
      snapshotFromPayload({
        get lastRun(): unknown {
          throw new Error('lastRun');
        },
      }),
    ).toBeNull();
    expect(countThroughProxy()).toBe(0);
    expect(
      snapshotFromPayload({
        id: 'run-x',
        plots: 1,
        series: 's',
        meta: { ms: 'nope' },
      })?.plotCount,
    ).toBe(0);
  });

  test('barWidthPct is min(100%, ms/1000*100); formatPctChip matches chips', () => {
    expect(barWidthPct(undefined)).toBe(0);
    expect(barWidthPct(-10)).toBe(0);
    expect(barWidthPct(Number.NaN)).toBe(0);
    expect(barWidthPct(0)).toBe(0);
    expect(barWidthPct(500)).toBe(50);
    expect(barWidthPct(1000)).toBe(100);
    expect(barWidthPct(2500)).toBe(100);
    expect(formatPctChip(0)).toBe('0%');
    expect(formatPctChip(0.05)).toBe('<0.1%');
    expect(formatPctChip(1.2)).toBe('1.2%');
    expect(formatPctChip(12.4)).toBe('12%');
  });
});

function countThroughProxy(): number {
  const plots = new Proxy(
    {},
    {
      ownKeys() {
        throw new Error('keys');
      },
      getOwnPropertyDescriptor() {
        return { enumerable: true, configurable: true };
      },
    },
  );
  return snapshotFromPayload({
    lastRun: { id: 'p', plots },
  })?.plotCount ?? -1;
}
