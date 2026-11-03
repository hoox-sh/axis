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

import { beforeEach, describe, expect, it } from 'bun:test';
import { ResultsFocusStore } from './results-store';
import {
  ProfilerStore,
  attachProfiler,
  countPlots,
  countSeries,
  encodeProfilerSet,
  pickPhases,
  profileLineCount,
  snapshotFromRun,
  topHotLines,
  type ProfilerListener,
  type ProfilerSnapshot,
} from './profiler-store';

function run(
  partial?: Partial<{
    id: string;
    status: string;
    engineId: string;
    seriesKey: string;
    plots: unknown;
    series: unknown;
    meta: unknown;
    error: unknown;
    createdAt: unknown;
  }>,
) {
  return {
    id: 'run-1',
    status: 'success',
    engineId: 'server',
    seriesKey: 'binance|spot|BTCUSDT|1m',
    ...partial,
  };
}

describe('countPlots / countSeries', () => {
  it('counts array length, object keys, and zeros everything else', () => {
    expect(countPlots(null)).toBe(0);
    expect(countPlots(undefined)).toBe(0);
    expect(countPlots([1, 2, 3])).toBe(3);
    expect(countPlots([])).toBe(0);
    expect(countPlots({ a: 1, b: 2 })).toBe(2);
    expect(countPlots({})).toBe(0);
    expect(countPlots(42)).toBe(0);
    expect(countPlots('plots')).toBe(0);
    expect(countPlots(true)).toBe(0);
    expect(countSeries({ close: [1], SMA: [2] })).toBe(2);
    expect(countSeries([0, 1])).toBe(2);
    expect(countSeries(null)).toBe(0);
  });

  it('does not cap object-key counts (unlike LM plotKeys slice)', () => {
    const plots: Record<string, number> = {};
    for (let i = 0; i < 50; i += 1) plots[`p${i}`] = i;
    expect(countPlots(plots)).toBe(50);
  });

  it('swallows hostile Object.keys', () => {
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
    expect(countPlots(plots)).toBe(0);
  });
});

describe('topHotLines / pickPhases / profileLineCount', () => {
  it('returns [] when profile lines are missing or empty (no invented pct)', () => {
    expect(topHotLines(null)).toEqual([]);
    expect(topHotLines(undefined)).toEqual([]);
    expect(topHotLines({})).toEqual([]);
    expect(topHotLines({ profile: { phases: { parse_ms: 1 } } })).toEqual([]);
    expect(topHotLines({ profile: { lines: [] } })).toEqual([]);
    expect(topHotLines({ profile: { total_ms: 40, lines: [] } })).toEqual([]);
    expect(profileLineCount({ profile: { lines: [] } })).toBe(0);
    expect(profileLineCount(null)).toBe(0);
  });

  it('ranks top-N by ms, fills pct from sum or total_ms, prefers lines over line_stats', () => {
    expect(
      topHotLines(
        {
          profile: {
            lines: [
              { line: 10, ms: 25, execs: 1 },
              { line: 2, ms: 75, execs: 2 },
              { line: 4, ms: 5, execs: 1 },
            ],
          },
        },
        2,
      ),
    ).toEqual([
      { line: 2, ms: 75, execs: 2, pct: (75 / 105) * 100 },
      { line: 10, ms: 25, execs: 1, pct: (25 / 105) * 100 },
    ]);

    expect(
      topHotLines({
        profile: {
          lines: [
            { line: 10, ms: 25, execs: 1 },
            { line: 2, ms: 75, execs: 2 },
          ],
        },
      }),
    ).toEqual([
      { line: 2, ms: 75, execs: 2, pct: 75 },
      { line: 10, ms: 25, execs: 1, pct: 25 },
    ]);

    expect(
      topHotLines({
        profile: {
          total_ms: 200,
          line_stats: [
            { lineno: 3, time: 10, count: 2 },
            { line_no: 1, time_ms: 40, execs: 1, pct: 7 },
          ],
        },
      }),
    ).toEqual([
      { line: 1, ms: 40, execs: 1, pct: 7 },
      { line: 3, ms: 10, execs: 2, pct: 5 },
    ]);

    expect(
      profileLineCount({
        profile: {
          lines: [
            { line: 1, ms: 1 },
            { line: 1, ms: 2 },
            { line: 2, ms: 3 },
          ],
        },
      }),
    ).toBe(2);
  });

  it('merges duplicate lines, zeros ms-less pct, and swallows hostile rows', () => {
    expect(
      topHotLines({
        profile: {
          lines: [
            { line: 5, ms: 10, execs: 1 },
            { line: 5, ms: 5, execs: 2 },
            { line: 0, ms: 99 },
            null,
            { line: 'x' },
            { line: 8, ms: 0, execs: 1 },
          ],
        },
      }),
    ).toEqual([
      { line: 5, ms: 15, execs: 3, pct: 100 },
      { line: 8, ms: 0, execs: 1, pct: 0 },
    ]);

    const hostileProfile = new Proxy(
      {},
      {
        get() {
          throw new Error('profile');
        },
      },
    );
    expect(topHotLines({ profile: hostileProfile })).toEqual([]);
    expect(topHotLines({ get profile() { throw new Error('meta'); } })).toEqual([]);

    const throwingLen = new Proxy([] as unknown[], {
      get(target, prop, receiver) {
        if (prop === 'length') throw new Error('len');
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(topHotLines({ profile: { lines: throwingLen } })).toEqual([]);
    expect(profileLineCount({ profile: { lines: throwingLen } })).toBe(0);
    expect(topHotLines({ profile: { lines: [{ line: 1, ms: 1 }] } }, 0)).toEqual([
      { line: 1, ms: 1, execs: 0, pct: 100 },
    ]);
    expect(profileLineCount({ get profile() { throw new Error('p'); } })).toBe(0);

    expect(
      topHotLines({
        profile: {
          get lines() {
            throw new Error('lines');
          },
          line_stats: [{ line: 9, ms: 3, execs: 1 }],
        },
      }),
    ).toEqual([{ line: 9, ms: 3, execs: 1, pct: 100 }]);

    expect(topHotLines({ profile: { lines: 'nope', line_stats: { x: 1 } } })).toEqual([]);
    expect(topHotLines({ profile: { lines: [null, { line: 0 }] } })).toEqual([]);

    const hostileMs = {
      line: 2,
      get ms() {
        throw new Error('ms');
      },
      get time_ms() {
        throw new Error('time_ms');
      },
      get time() {
        throw new Error('time');
      },
      get execs() {
        throw new Error('execs');
      },
      get count() {
        throw new Error('count');
      },
      get pct() {
        throw new Error('pct');
      },
    };
    expect(topHotLines({ profile: { lines: [hostileMs] } })).toEqual([
      { line: 2, ms: 0, execs: 0, pct: 0 },
    ]);

    const hostileLine = {
      get line() {
        throw new Error('line');
      },
      get line_no() {
        throw new Error('line_no');
      },
      get lineno() {
        throw new Error('lineno');
      },
      ms: 9,
    };
    expect(topHotLines({ profile: { lines: [hostileLine] } })).toEqual([]);

    const hostileTotal = {
      get totalMs() {
        throw new Error('totalMs');
      },
      get total_ms() {
        throw new Error('total_ms');
      },
      lines: [{ line: 1, ms: 4, execs: 1 }],
    };
    expect(topHotLines({ profile: hostileTotal })).toEqual([
      { line: 1, ms: 4, execs: 1, pct: 100 },
    ]);

    const throwingIndex = new Proxy([{ line: 1, ms: 1 }], {
      get(target, prop, receiver) {
        if (prop === '0' || prop === 0) throw new Error('idx');
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(topHotLines({ profile: { lines: throwingIndex } })).toEqual([]);
    expect(profileLineCount({ profile: { lines: throwingIndex } })).toBe(0);
  });

  it('pickPhases reads numeric phase entries and omits empty/hostile', () => {
    expect(pickPhases({ profile: { phases: { parse_ms: 10, eval_ms: 30 } } })).toEqual([
      { name: 'parse_ms', ms: 10 },
      { name: 'eval_ms', ms: 30 },
    ]);
    expect(pickPhases({ profile: { phases: { parse_ms: '4', bad: -1, empty: '' } } })).toEqual([
      { name: 'parse_ms', ms: 4 },
    ]);
    expect(pickPhases({ profile: { phases: { '  ': 3, eval_ms: 1 } } })).toEqual([
      { name: 'eval_ms', ms: 1 },
    ]);
    expect(pickPhases({ profile: { phases: {} } })).toBeUndefined();
    expect(pickPhases({ profile: { phases: null } })).toBeUndefined();
    expect(pickPhases({ profile: {} })).toBeUndefined();
    expect(pickPhases(null)).toBeUndefined();
    expect(
      pickPhases({
        profile: {
          get phases() {
            throw new Error('phases');
          },
        },
      }),
    ).toBeUndefined();

    const keysThrow = new Proxy(
      { eval_ms: 1 },
      {
        ownKeys() {
          throw new Error('keys');
        },
        getOwnPropertyDescriptor() {
          return { enumerable: true, configurable: true };
        },
      },
    );
    expect(pickPhases({ profile: { phases: keysThrow } })).toBeUndefined();

    const entryThrow = {
      get parse_ms() {
        throw new Error('parse');
      },
      eval_ms: 5,
    };
    expect(pickPhases({ profile: { phases: entryThrow } })).toEqual([
      { name: 'eval_ms', ms: 5 },
    ]);
  });
});

describe('snapshotFromRun', () => {
  it('maps a success run with meta.ms and counts', () => {
    const snap = snapshotFromRun(
      run({
        plots: [1, 2, 3],
        series: { close: [1], ema: [2] },
        meta: { ms: 12.5, script_name: 'A' },
        createdAt: 1_700_000_000_000,
      }),
    );
    expect(snap).toEqual({
      runId: 'run-1',
      status: 'success',
      ms: 12.5,
      engineId: 'server',
      seriesKey: 'binance|spot|BTCUSDT|1m',
      plotCount: 3,
      seriesCount: 2,
      createdAt: 1_700_000_000_000,
      topLines: [],
      lineCount: 0,
    });
  });

  it('fills topLines, lineCount, and phases from meta.profile', () => {
    const snap = snapshotFromRun(
      run({
        meta: {
          ms: 100,
          profile: {
            total_ms: 100,
            phases: { parse_ms: 8, eval_ms: 92 },
            lines: [
              { line: 3, ms: 60, execs: 2 },
              { line: 1, ms: 40, execs: 1 },
            ],
          },
        },
      }),
    );
    expect(snap?.topLines).toEqual([
      { line: 3, ms: 60, execs: 2, pct: 60 },
      { line: 1, ms: 40, execs: 1, pct: 40 },
    ]);
    expect(snap?.lineCount).toBe(2);
    expect(snap?.phases).toEqual([
      { name: 'parse_ms', ms: 8 },
      { name: 'eval_ms', ms: 92 },
    ]);
  });

  it('includes trimmed error on error status', () => {
    const snap = snapshotFromRun(
      run({ status: 'error', error: '  boom  ', meta: { ms: 3 } }),
    );
    expect(snap?.status).toBe('error');
    expect(snap?.error).toBe('boom');
  });

  it('returns null for unusable records', () => {
    expect(snapshotFromRun(null)).toBeNull();
    expect(snapshotFromRun(undefined)).toBeNull();
    expect(snapshotFromRun([])).toBeNull();
    expect(snapshotFromRun('run')).toBeNull();
    expect(snapshotFromRun({ status: 'success' })).toBeNull();
    expect(snapshotFromRun(run({ id: '   ' }))).toBeNull();
    expect(snapshotFromRun(run({ id: '' }))).toBeNull();
  });

  it('coerces numeric id, defaults unknown status to success, zeros bad ms', () => {
    const snap = snapshotFromRun({
      id: 9,
      status: 'ok',
      engineId: 1,
      seriesKey: 2,
      meta: { ms: 'slow' },
    });
    expect(snap?.runId).toBe('9');
    expect(snap?.status).toBe('success');
    expect(snap?.engineId).toBe('1');
    expect(snap?.seriesKey).toBe('2');
    expect(snap?.ms).toBe(0);
  });

  it('zeros negative / non-finite ms and ignores empty error', () => {
    expect(snapshotFromRun(run({ meta: { ms: -4 } }))?.ms).toBe(0);
    expect(snapshotFromRun(run({ meta: { ms: Number.NaN } }))?.ms).toBe(0);
    expect(snapshotFromRun(run({ meta: { ms: Number.POSITIVE_INFINITY } }))?.ms).toBe(0);
    expect(snapshotFromRun(run({ meta: [1] }))?.ms).toBe(0);
    expect(snapshotFromRun(run({ meta: null }))?.ms).toBe(0);
    expect(snapshotFromRun(run({ error: '' }))?.error).toBeUndefined();
    expect(snapshotFromRun(run({ error: '   ' }))?.error).toBeUndefined();
    expect(snapshotFromRun(run({ error: 12 }))?.error).toBeUndefined();
    const throwingMs = new Proxy(
      {},
      {
        get() {
          throw new Error('ms');
        },
      },
    );
    expect(snapshotFromRun(run({ meta: throwingMs }))?.ms).toBe(0);
  });

  it('uses Date.now when createdAt is missing or invalid', () => {
    const before = Date.now();
    const snap = snapshotFromRun(run({ createdAt: 'nope' }));
    expect(snap?.createdAt).toBeGreaterThanOrEqual(before);
    expect(snapshotFromRun(run({ createdAt: 0 }))?.createdAt).toBeGreaterThanOrEqual(before);
    expect(snapshotFromRun(run({ createdAt: -1 }))?.createdAt).toBeGreaterThanOrEqual(before);
  });

  it('swallows throwing getters on the record', () => {
    const hostile = {
      get id(): string {
        throw new Error('id');
      },
    };
    expect(snapshotFromRun(hostile)).toBeNull();
  });
});

describe('encodeProfilerSet', () => {
  it('posts a local profiler.set envelope (not axis.webview.v1)', () => {
    const snap: ProfilerSnapshot = {
      runId: 'run-1',
      status: 'success',
      ms: 10,
      engineId: 'server',
      seriesKey: 'k',
      plotCount: 0,
      seriesCount: 0,
      createdAt: 1,
      topLines: [],
      lineCount: 0,
    };
    const env = encodeProfilerSet(snap);
    expect(env.type).toBe('profiler.set');
    expect(env.payload).toBe(snap);
    expect(typeof env.ts).toBe('number');
    expect(encodeProfilerSet(null).payload).toBeNull();
    expect('v' in env).toBe(false);
  });
});

describe('ProfilerStore', () => {
  let store: ProfilerStore;

  beforeEach(() => {
    store = new ProfilerStore();
  });

  it('starts empty and records a run', () => {
    expect(store.getSnapshot()).toBeNull();
    const snap = store.recordFromRun(
      run({ plots: { ema: [1] }, series: { close: 1 }, meta: { ms: 8 } }),
    );
    expect(snap?.runId).toBe('run-1');
    expect(snap?.plotCount).toBe(1);
    expect(snap?.seriesCount).toBe(1);
    expect(store.getSnapshot()?.ms).toBe(8);
  });

  it('ignores unusable input and keeps the previous snapshot', () => {
    store.recordFromRun(run({ meta: { ms: 5 } }));
    expect(store.recordFromRun(null)).toEqual(store.getSnapshot());
    expect(store.recordFromRun(undefined)).not.toBeNull();
    expect(store.recordFromRun([])).not.toBeNull();
    expect(store.getSnapshot()?.ms).toBe(5);
  });

  it('notifies subscribers and swallows hostile listeners', () => {
    const seen: Array<ProfilerSnapshot | null> = [];
    const unsub = store.subscribe((snap) => {
      seen.push(snap);
    });
    store.subscribe(() => {
      throw new Error('boom');
    });
    expect(() => store.recordFromRun(run({ id: 'run-h', meta: { ms: 1 } }))).not.toThrow();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.runId).toBe('run-h');
    unsub();
    store.recordFromRun(run({ id: 'run-after' }));
    expect(seen).toHaveLength(1);
  });

  it('unsubscribe is idempotent; clear resets', () => {
    const unsub = store.subscribe(() => {});
    unsub();
    unsub();
    store.recordFromRun(run());
    expect(store.getSnapshot()?.runId).toBe('run-1');
    store.clear();
    expect(store.getSnapshot()).toBeNull();
  });

  it('never throws when recordFromRun hits a throwing listener plus bad record', () => {
    store.subscribe(() => {
      throw new Error('listener');
    });
    expect(() => store.recordFromRun(run())).not.toThrow();
    expect(() => store.recordFromRun({ get id() { throw new Error('x'); } })).not.toThrow();
  });

  it('recordFromRun catch keeps the previous snapshot when emit iteration throws', () => {
    store.recordFromRun(run({ id: 'kept', meta: { ms: 3 } }));
    const bag = store as unknown as { listeners: Set<ProfilerListener> };
    bag.listeners = {
      [Symbol.iterator]() {
        throw new Error('iter');
      },
      add() {
        return this;
      },
      delete() {
        return false;
      },
    } as unknown as Set<ProfilerListener>;
    expect(() => store.recordFromRun(run({ id: 'next', meta: { ms: 9 } }))).not.toThrow();
    expect(store.getSnapshot()?.runId).toBe('next');
  });
});

describe('attachProfiler', () => {
  it('records current lastRun and subsequent ResultsFocusStore publishes', () => {
    const results = new ResultsFocusStore();
    const first = results.publish({
      status: 'success',
      focus: true,
      seriesKey: 'k',
      engineId: 'server',
      plots: [1, 2],
      series: { close: [1] },
      meta: { ms: 11 },
    });
    const profiler = new ProfilerStore();
    const detach = attachProfiler(results, profiler);
    expect(profiler.getSnapshot()?.runId).toBe(first);
    expect(profiler.getSnapshot()?.plotCount).toBe(2);
    expect(profiler.getSnapshot()?.ms).toBe(11);

    const second = results.publish({
      status: 'error',
      focus: true,
      seriesKey: 'k2',
      engineId: 'server',
      error: 'nope',
      meta: { ms: 4 },
    });
    expect(profiler.getSnapshot()?.runId).toBe(second);
    expect(profiler.getSnapshot()?.status).toBe('error');
    expect(profiler.getSnapshot()?.error).toBe('nope');

    detach();
    results.publish({
      status: 'success',
      focus: true,
      seriesKey: 'k3',
      engineId: 'server',
      meta: { ms: 99 },
    });
    expect(profiler.getSnapshot()?.runId).toBe(second);
  });

  it('does not steal on silent Results publish (lastRun unchanged)', () => {
    const results = new ResultsFocusStore();
    results.publish({
      status: 'success',
      focus: true,
      seriesKey: 'k',
      engineId: 'server',
      meta: { ms: 1, script_name: 'A' },
    });
    const profiler = new ProfilerStore();
    attachProfiler(results, profiler);
    results.publish({
      status: 'success',
      focus: false,
      seriesKey: 'k',
      engineId: 'server',
      meta: { ms: 50, script_name: 'silent' },
    });
    expect(profiler.getSnapshot()?.ms).toBe(1);
  });

  it('never throws on hostile store / profiler / snapshots', () => {
    const profiler = new ProfilerStore();
    expect(attachProfiler(null, profiler)).toBeTypeOf('function');
    expect(attachProfiler(undefined, profiler)).toBeTypeOf('function');
    expect(attachProfiler([], profiler)).toBeTypeOf('function');
    expect(attachProfiler({ subscribe: 1 }, profiler)).toBeTypeOf('function');
    expect(attachProfiler({ subscribe() {} }, null)).toBeTypeOf('function');
    expect(attachProfiler({ subscribe() {} }, [])).toBeTypeOf('function');
    expect(attachProfiler({ subscribe() {} }, {})).toBeTypeOf('function');

    const throwingGet = {
      getLastRun() {
        throw new Error('last');
      },
      subscribe(listener: (snap: unknown) => void) {
        listener({ lastRun: run({ id: 'from-sub', meta: { ms: 2 } }) });
        return () => {};
      },
    };
    expect(() => attachProfiler(throwingGet, profiler)).not.toThrow();
    expect(profiler.getSnapshot()?.runId).toBe('from-sub');

    const badSnap = {
      subscribe(listener: (snap: unknown) => void) {
        listener(null);
        listener([]);
        listener({ lastRun: null });
        return 'not-a-fn';
      },
    };
    const unsub = attachProfiler(badSnap, profiler);
    expect(unsub).toBeTypeOf('function');
    expect(() => unsub()).not.toThrow();

    const subscribeThrows = {
      subscribe() {
        throw new Error('sub');
      },
    };
    expect(() => attachProfiler(subscribeThrows, profiler)()).not.toThrow();

    const listenerThrows = {
      recordFromRun() {
        throw new Error('rec');
      },
    };
    const emitting = {
      subscribe(listener: (snap: unknown) => void) {
        listener({ lastRun: run() });
        return () => {};
      },
    };
    expect(() => attachProfiler(emitting, listenerThrows)).not.toThrow();

    const throwingProfilerFn = {
      get recordFromRun(): () => void {
        throw new Error('getter');
      },
    };
    expect(() => attachProfiler({ subscribe() {} }, throwingProfilerFn)()).not.toThrow();
  });

  it('returns noop when subscribe is missing after getLastRun', () => {
    const profiler = new ProfilerStore();
    const unsub = attachProfiler({ getLastRun: () => run({ id: 'only-get' }) }, profiler);
    expect(profiler.getSnapshot()?.runId).toBe('only-get');
    expect(() => unsub()).not.toThrow();
  });
});
