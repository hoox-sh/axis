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

/**
 * Normative §7.1 Results focus table (mirror tests/run-results-focus.test.ts).
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import {
  ResultsFocusStore,
  copyRunRecord,
  pickStrategyReport,
  type ResultsFocusSnapshot,
} from './results-store';

function base(partial?: Partial<Parameters<ResultsFocusStore['publish']>[0]>) {
  return {
    status: 'success' as const,
    focus: true,
    seriesKey: 'binance|spot|BTCUSDT|1m',
    engineId: 'server',
    meta: { ms: 1, script_name: 'A' },
    ...partial,
  };
}

describe('ResultsFocusStore §7.1', () => {
  let store: ResultsFocusStore;

  beforeEach(() => {
    store = new ResultsFocusStore();
  });

  it('focus:true publishes lastRun + resultsFocusId and newestRunId', () => {
    const id = store.publish(base({ focus: true, meta: { ms: 10, script_name: 'A' } }));
    expect(id).toBe('run-1');
    expect(store.getNewestRunId()).toBe(id);
    expect(store.getLastRunId()).toBe(id);
    expect(store.getResultsFocusId()).toBe(id);
    expect(store.getLastRun()?.meta?.script_name).toBe('A');
    expect(store.get(id)?.status).toBe('success');
  });

  it('focus:false does not steal focus when already focused (silent / live)', () => {
    const a = store.publish(base({ focus: true, meta: { ms: 1, script_name: 'A' } }));
    const b = store.publish(
      base({ focus: false, meta: { ms: 2, script_name: 'B' }, seriesKey: 'other' }),
    );
    expect(store.getNewestRunId()).toBe(b);
    expect(store.getResultsFocusId()).toBe(a);
    expect(store.getLastRunId()).toBe(a);
    expect(store.getLastRun()?.meta?.script_name).toBe('A');
    expect(store.getLastRun()?.meta?.ms).toBe(1);
    expect(store.get(b)?.meta?.script_name).toBe('B');
  });

  it('silent re-run leaves lastRun snapshot unchanged even for a new cache entry', () => {
    const a = store.publish(base({ focus: true, meta: { ms: 1, script_name: 'A1' } }));
    store.publish(base({ focus: false, meta: { ms: 99, script_name: 'A2' } }));
    expect(store.getResultsFocusId()).toBe(a);
    expect(store.getLastRun()?.meta?.script_name).toBe('A1');
    expect(store.getLastRun()?.meta?.ms).toBe(1);
  });

  it('first run ever publishes regardless of focus:false', () => {
    const id = store.publish(base({ focus: false, meta: { ms: 5, script_name: 'First' } }));
    expect(store.getResultsFocusId()).toBe(id);
    expect(store.getLastRunId()).toBe(id);
    expect(store.getLastRun()?.meta?.script_name).toBe('First');
    expect(store.getNewestRunId()).toBe(id);
  });

  it('focus:true after a silent-focused state switches Results to the new run', () => {
    store.publish(base({ focus: true, meta: { script_name: 'A' } }));
    const b = store.publish(base({ focus: true, meta: { script_name: 'B' } }));
    expect(store.getResultsFocusId()).toBe(b);
    expect(store.getLastRun()?.meta?.script_name).toBe('B');
  });

  it('focusResults(runId) retargets lastRun from cache', () => {
    const a = store.publish(base({ focus: true, meta: { script_name: 'A' } }));
    const b = store.publish(base({ focus: false, meta: { script_name: 'B' } }));
    expect(store.getResultsFocusId()).toBe(a);
    expect(store.focusResults(b)).toBe(true);
    expect(store.getResultsFocusId()).toBe(b);
    expect(store.getLastRunId()).toBe(b);
    expect(store.getLastRun()?.meta?.script_name).toBe('B');
    const payload = store.getResultsSetPayload();
    expect(payload.focusId).toBe(b);
    expect((payload.lastRun as { meta?: { script_name?: string } })?.meta?.script_name).toBe(
      'B',
    );
  });

  it('focusResults on unknown id still sets focus (lastRun null until cached)', () => {
    store.publish(base({ focus: true }));
    expect(store.focusResults('run-missing')).toBe(true);
    expect(store.getResultsFocusId()).toBe('run-missing');
    expect(store.getLastRun()).toBeNull();
    expect(store.getResultsSetPayload().lastRun).toBeNull();
  });

  it('focusResults rejects empty runId', () => {
    expect(store.focusResults('')).toBe(false);
    expect(store.focusResults('   ')).toBe(false);
    expect(store.getResultsFocusId()).toBeNull();
  });

  it('subscribe fires on publish focus change and focusResults; silent skips', () => {
    const events: Array<{ reason: string; focusChanged: boolean; focusId: unknown }> = [];
    const unsub = store.subscribe((snap: ResultsFocusSnapshot, reason) => {
      events.push({ reason, focusChanged: snap.focusChanged, focusId: snap.focusId });
    });
    const a = store.publish(base({ focus: true }));
    store.publish(base({ focus: false, meta: { script_name: 'silent' } }));
    store.focusResults(a);
    store.notifyReady();
    unsub();
    store.publish(base({ focus: true, meta: { script_name: 'after-unsub' } }));
    expect(events.map((e) => e.reason)).toEqual(['publish', 'focus', 'ready']);
    expect(events[0]?.focusChanged).toBe(true);
    expect(events[1]?.focusChanged).toBe(true);
    expect(events[2]?.focusChanged).toBe(false);
  });

  it('getResultsSetPayload includes strategyReport from record / meta', () => {
    store.publish(
      base({
        focus: true,
        strategyReport: { trades: 2 },
        meta: { ms: 1 },
      }),
    );
    expect(store.getResultsSetPayload().strategyReport).toEqual({ trades: 2 });
    store.clear();
    store.publish(base({ focus: true, meta: { strategyReport: { net: 1 } } }));
    expect(store.getResultsSetPayload().strategyReport).toEqual({ net: 1 });
  });

  it('hostile listener cannot break publish', () => {
    store.subscribe(() => {
      throw new Error('boom');
    });
    expect(() => store.publish(base({ focus: true }))).not.toThrow();
    expect(store.getResultsFocusId()).toBe('run-1');
  });
});

describe('pickStrategyReport / copyRunRecord', () => {
  it('prefers record.strategyReport then meta.strategyReport then meta.strategy', () => {
    expect(pickStrategyReport(undefined)).toBeNull();
    expect(
      pickStrategyReport({
        id: 'x',
        status: 'success',
        focus: true,
        seriesKey: '',
        engineId: 'server',
        createdAt: 1,
        strategyReport: { a: 1 },
        meta: { strategyReport: { b: 2 } },
      }),
    ).toEqual({ a: 1 });
    expect(
      pickStrategyReport({
        id: 'x',
        status: 'success',
        focus: true,
        seriesKey: '',
        engineId: 'server',
        createdAt: 1,
        meta: { strategy: { c: 3 } },
      }),
    ).toEqual({ c: 3 });
  });

  it('copyRunRecord shallow-copies series/meta', () => {
    const src = {
      id: 'r',
      status: 'success' as const,
      focus: true,
      seriesKey: 'k',
      engineId: 'server',
      createdAt: 1,
      series: { close: [1] },
      meta: { ms: 1 },
    };
    const copy = copyRunRecord(src);
    expect(copy).toEqual(src);
    expect(copy.series).not.toBe(src.series);
    expect(copy.meta).not.toBe(src.meta);
  });
});
