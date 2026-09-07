/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Durable saveResult is for user-initiated runs only.
 * Silent / live-tick re-runs must update in-memory lastRun without
 * appending a Saved-runs row every tick.
 */

import './setup';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { reconcile } from 'solid-js/store';
import { registry } from '../src/plugins/registry';
import { ensureBuiltins, _resetBootstrapFlag } from '../src/plugins/bootstrap';
import { _resetStorageRegistrationFlag } from '../src/storage/catalog';
import { _resetSourceRegistrationFlag } from '../src/sources/catalog';
import { _resetStreamRegistrationFlag } from '../src/streams/catalog';
import { _resetEngineRegistrationFlag } from '../src/engines/catalog';
import {
  localStoragePlugin,
  _clearLocalLibraryForTests,
  _resetLocalMigrationFlag,
} from '../src/storage/local';
import { listRunResults } from '../src/storage/service';
import {
  EDITOR_RUN_KEY,
  _flushRunResultPersistForTests,
  setActivePlugin,
  setLastRun,
  setStore,
  store,
} from '../src/store';
import { runAndApply, _resetRunEpochForTests } from '../src/indicators/runner';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';
import { SAMPLE_BARS } from './fixtures/bars';

const okResult = (name: string) => ({
  status: 'success' as const,
  plots: [1, 2, 3],
  series: {},
  events: [],
  meta: { script_name: name, ms: 4, startedAt: 1_700_000_000_000 },
});

let restoreFetch: (() => void) | null = null;

beforeEach(async () => {
  registry.clear();
  _resetSourceRegistrationFlag();
  _resetStreamRegistrationFlag();
  _resetEngineRegistrationFlag();
  _resetStorageRegistrationFlag();
  _resetBootstrapFlag();
  _resetLocalMigrationFlag();
  await _clearLocalLibraryForTests();
  ensureBuiltins();
  setActivePlugin('storage', 'local');
  setActivePlugin('engine', 'server');
  _resetRunEpochForTests();
  setStore('bars', SAMPLE_BARS);
  setStore('endpoint', 'http://run.test:5002');
  setStore('scripts', []);
  setStore('runResults', reconcile({}));
  setStore('resultsFocusId', null);
  setStore('lastRun', null);
  setStore('lastRunMs', null);
  setStore('resultsPanel', { open: false, height: 220 });
  setLastRun(null);
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
  setActivePlugin('storage', 'local');
});

describe('setLastRun persistence', () => {
  it('skips durable save when persistence is skip', async () => {
    const runId = setLastRun(okResult('skip'), {
      scriptId: 'ind-a',
      persistence: 'skip',
    });
    await _flushRunResultPersistForTests();
    expect(runId).toBeNull();
    expect(store.lastRun).toBeTruthy();
    expect(await listRunResults('ind-a')).toEqual([]);
  });

  it('skips durable save for deferred / skipped / superseded payloads', async () => {
    for (const meta of [
      { deferred: true },
      { skipped: 'hidden' },
      { superseded: true },
    ]) {
      setLastRun(
        { status: 'success', plots: [], series: {}, events: [], meta },
        { scriptId: 'ind-ephemeral' },
      );
    }
    await _flushRunResultPersistForTests();
    expect(await listRunResults('ind-ephemeral')).toEqual([]);
  });

  it('persists a user-initiated run once', async () => {
    const runId = setLastRun(okResult('keep'), { scriptId: 'ind-a', focus: true });
    await _flushRunResultPersistForTests();
    expect(runId).toBeTruthy();
    const list = await listRunResults('ind-a');
    expect(list).toHaveLength(1);
    expect(list[0]?.runId).toBe(runId);
  });

  it('persists a rich strategy stats snapshot in meta (Saved tab)', async () => {
    setLastRun(
      {
        status: 'success',
        plots: [],
        series: {},
        events: [
          { time: 1, type: 'entry', id: 'L', dir: 'long', price: 100 },
          { time: 2, type: 'close', id: 'L', price: 120 },
        ],
        meta: { script_name: 'strat', ms: 5 },
      },
      { scriptId: 'strat-x', focus: true },
    );
    await _flushRunResultPersistForTests();
    const list = await listRunResults('strat-x');
    expect(list).toHaveLength(1);
    const stats = list[0]?.stats as Record<string, unknown> | undefined;
    expect(stats).toBeTruthy();
    expect(stats?.trades).toBe(1);
    expect(stats?.wins).toBe(1);
    expect(stats?.losses).toBe(0);
    expect(stats?.winRate).toBe(100);
    expect(stats?.profitFactor).toBeNull(); // ∞ (no losses) — JSON-safe
    expect(stats?.totalPnl).toBeCloseTo(20);
    expect(stats?.returnPct).toBeCloseTo(0.2);
  });

  it('does not grow Saved runs on repeated skip (live-tick shape)', async () => {
    setLastRun(okResult('user'), { scriptId: 'ind-a', focus: true });
    await _flushRunResultPersistForTests();
    for (let i = 0; i < 5; i++) {
      setLastRun(okResult(`tick-${i}`), {
        scriptId: 'ind-a',
        focus: false,
        persistence: 'skip',
      });
    }
    await _flushRunResultPersistForTests();
    expect(await listRunResults('ind-a')).toHaveLength(1);
    expect(typeof localStoragePlugin.saveResult).toBe('function');
  });
});

describe('runAndApply live ticks do not auto-save', () => {
  function stubEngine() {
    restoreFetch = mockFetch(async () =>
      jsonResponse({
        status: 'success',
        plots: SAMPLE_BARS.map(() => 1),
        series: { close: SAMPLE_BARS.map(() => 1) },
        events: [{ kind: 'entry', id: 'L', direction: 'long', bar_time: 1 }],
        meta: { script_name: 'strat', overlay: true, ms: 3 },
      }),
    );
  }

  it('silent liveTick re-runs do not write Saved runs', async () => {
    stubEngine();
    const src = '//@version=6\nstrategy("s")\nplot(close)';
    for (let i = 0; i < 3; i++) {
      await runAndApply(src, EDITOR_RUN_KEY, {
        silent: true,
        openResults: false,
        liveTick: true,
      });
    }
    await _flushRunResultPersistForTests();
    expect(await listRunResults(EDITOR_RUN_KEY)).toEqual([]);
    expect(store.runResults[EDITOR_RUN_KEY]).toBeTruthy();
  });

  it('interactive Run persists once; later live ticks do not append', async () => {
    stubEngine();
    const src = '//@version=6\nstrategy("s")\nplot(close)';
    await runAndApply(src, EDITOR_RUN_KEY, { silent: false, openResults: false });
    await _flushRunResultPersistForTests();
    expect(await listRunResults(EDITOR_RUN_KEY)).toHaveLength(1);

    for (let i = 0; i < 3; i++) {
      await runAndApply(src, EDITOR_RUN_KEY, {
        silent: true,
        openResults: false,
        liveTick: true,
      });
    }
    await _flushRunResultPersistForTests();
    expect(await listRunResults(EDITOR_RUN_KEY)).toHaveLength(1);
  });
});
