/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Regression: `runAndApply` live ticks must reach the PYNE session endpoint.
 *
 * `runAndApplyInner` always forwards the bars it evaluated, so the runner
 * must forward `liveTick` to the engine when those bars ARE the chart series
 * (same reference) and withhold it for private windows (HPO slices).
 * A reference-identity bug here silently downgraded every live tick to a
 * full WS/REST re-run (the session client never saw a call).
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';
import { registry } from '../src/plugins/registry';
import { ensureBuiltins, _resetBootstrapFlag } from '../src/plugins/bootstrap';
import { _resetSourceRegistrationFlag } from '../src/sources/catalog';
import { _resetStreamRegistrationFlag } from '../src/streams/catalog';
import { _resetEngineRegistrationFlag } from '../src/engines/catalog';
import { _resetStorageRegistrationFlag } from '../src/storage/catalog';
import { _resetLiveSessionsForTests } from '../src/engines/live-sessions';
import { setStore, setActivePlugin, clearLogs, store } from '../src/store';
import { runAndApply, _resetRunEpochForTests } from '../src/indicators/runner';
import { SAMPLE_BARS } from './fixtures/bars';
import type { Bar } from '../src/store/types';

const ENDPOINT = 'http://run.test:5002';
const SCRIPT = 'indicator("sess")\nplot(close)';

let restoreFetch: (() => void) | null = null;
let calls: string[] = [];
const counts = new Map<string, number>();

function envelope(sessionId: string, count: number) {
  return {
    status: 'success',
    session_id: sessionId,
    plots: [],
    series: {},
    plot_meta: {},
    events: [],
    drawings: [],
    alerts: [],
    inputs: [],
    count,
    mode: 'interpret',
    overlay: false,
    script_name: 'sess',
    logs: [],
    meta: {},
  };
}

beforeEach(() => {
  registry.clear();
  _resetSourceRegistrationFlag();
  _resetStreamRegistrationFlag();
  _resetEngineRegistrationFlag();
  _resetStorageRegistrationFlag();
  _resetBootstrapFlag();
  ensureBuiltins();
  clearLogs();
  _resetRunEpochForTests();
  _resetLiveSessionsForTests();
  calls = [];
  counts.clear();
  setStore('bars', SAMPLE_BARS.map((b) => ({ ...b })));
  setStore('endpoint', ENDPOINT);
  setStore('pluginsConfig', { 'engine:server': { mode: 'interpret', preferWs: false } });
  setStore('scripts', []);
  setStore('resultsPanel', { open: false, height: 220 });
  setStore('resultsFocusId', null);
  setStore('runResults', {});
  setStore('lastRun', null);
  setActivePlugin('engine', 'server');

  let nextId = 1;
  restoreFetch = mockFetch(async (input, init) => {
    const url = String(input);
    const path = url.slice(ENDPOINT.length);
    const method = String(init?.method || 'GET').toUpperCase();
    calls.push(`${method} ${path}`);
    if (method === 'POST' && path === '/session') {
      const body = JSON.parse(String(init?.body)) as { data?: unknown[] };
      const id = `s${nextId++}`;
      counts.set(id, body.data?.length || 0);
      return jsonResponse(envelope(id, body.data?.length || 0));
    }
    const tick = /^\/session\/([^/]+)\/tick$/.exec(path);
    if (method === 'POST' && tick) {
      return jsonResponse(envelope(tick[1]!, counts.get(tick[1]!) ?? 0));
    }
    const append = /^\/session\/([^/]+)\/append$/.exec(path);
    if (method === 'POST' && append) {
      const body = JSON.parse(String(init?.body)) as { bars?: unknown[] };
      const n = (counts.get(append[1]!) ?? 0) + (body.bars?.length || 0);
      counts.set(append[1]!, n);
      return jsonResponse(envelope(append[1]!, n));
    }
    if (method === 'POST' && path.startsWith('/run')) {
      return jsonResponse({
        status: 'success',
        plots: [],
        events: [],
        series: {},
        meta: { script_name: 'sess' },
      });
    }
    return jsonResponse({ status: 'error', code: 'NOT_FOUND' }, 404);
  });
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
  _resetLiveSessionsForTests();
});

describe('runAndApply liveTick session routing', () => {
  it('sends chart-bars live ticks to the session endpoint, never /run', async () => {
    const first = await runAndApply(SCRIPT, undefined, {
      silent: true,
      openResults: false,
      liveTick: true,
    });
    expect(first.status).toBe('success');
    expect(calls).toEqual(['POST /session']);

    // New bar closes in: previous tip finalized (tick) + tail appended.
    const prev = store.bars;
    const last = prev[prev.length - 1]!;
    const closed: Bar = { ...last, close: last.close + 2, high: last.high + 2 };
    const extra: Bar = {
      time: last.time + 86_400,
      open: closed.close,
      high: closed.close + 1,
      low: closed.close - 1,
      close: closed.close + 0.5,
      volume: 7,
    };
    setStore('bars', [...prev.slice(0, -1), closed, extra]);
    const second = await runAndApply(SCRIPT, undefined, {
      silent: true,
      openResults: false,
      liveTick: true,
    });
    expect(second.status).toBe('success');
    expect(calls).toEqual([
      'POST /session',
      'POST /session/s1/tick',
      'POST /session/s1/append',
    ]);
    expect(calls.some((c) => c.includes('/run'))).toBe(false);
  });

  it('withholds liveTick for private bar windows (HPO slices use /run)', async () => {
    const slice = store.bars.slice(-3);
    const r = await runAndApply(SCRIPT, undefined, {
      silent: true,
      openResults: false,
      liveTick: true,
      bars: slice,
    });
    expect(r.status).toBe('success');
    expect(calls.some((c) => c.includes('/session'))).toBe(false);
    expect(calls.some((c) => c.startsWith('POST /run'))).toBe(true);
  });
});
