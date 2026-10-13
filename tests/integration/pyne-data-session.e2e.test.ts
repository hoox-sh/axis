/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Cross-repo check: AXIS engine-owned data-session client against a running
 * PYNE Pro API that has the `/data/*` store and a feed (CCXT or a fake).
 *
 * Skipped unless `AXIS_PYNE_E2E_URL` is set, e.g.
 *   AXIS_PYNE_E2E_URL=http://127.0.0.1:5055 bun test tests/integration/pyne-data-session.e2e.test.ts
 */

import './../setup';
import { describe, expect, it, beforeAll } from 'bun:test';
import {
  ensureDataSession,
  runDataSession,
  getDataSeriesStatus,
  tickDataSession,
  _resetDataSessionMemo,
} from '../../src/engines/data-sessions';
import { serverEngine, capabilitiesFromHealth } from '../../src/engines/catalog';
import { setStore } from '../../src/store';
import type { Bar } from '../../src/store/types';

const URL_ = process.env.AXIS_PYNE_E2E_URL ?? '';
const e2e = URL_ ? describe : describe.skip;

const SCRIPT = '//@version=6\nindicator("e2e", overlay=true)\nplot(close)\n';
const HOUR = 3600;
/** Unique pair per run so a persisted PYNE store never pre-warms a case. */
const RUN = `E2E${Date.now().toString(36).toUpperCase()}`;
const PAIR_FETCH = `${RUN}A/USDT`;
const PAIR_LOCAL = `${RUN}B/USDT`;
const PAIR_TICK = `${RUN}C/USDT`;

/** Hour-aligned local bars ending at the last closed hour (oldest → newest). */
function localHourly(count: number): Bar[] {
  const newest = Math.floor(Date.now() / 1000 / HOUR) * HOUR - HOUR;
  return Array.from({ length: count }, (_, i) => {
    const t = newest - (count - 1 - i) * HOUR;
    const base = 50 + (i % 7);
    return { time: t, open: base, high: base + 1, low: base - 1, close: base + 0.5, volume: 3 };
  });
}

e2e('AXIS ↔ PYNE Pro engine-owned data sessions', () => {
  beforeAll(() => {
    _resetDataSessionMemo();
    setStore('endpoint', URL_);
  });

  it('advertises every-tick only when the live engine owns the data', async () => {
    const res = await fetch(`${URL_}/health`);
    const caps = capabilitiesFromHealth(await res.json());
    expect(caps.liveModes).toEqual(['every-tick', 'bar-close']);
    expect(caps.ownsData).toBe(true);
    expect(await serverEngine.getCapabilities?.()).toMatchObject({ ownsData: true });
  });

  it('fetches a missing series from the engine feed (no local data)', async () => {
    const key = { exchange: 'binance', symbol: PAIR_FETCH, interval: '1h' };
    const h = await ensureDataSession({
      endpoint: URL_,
      apiKey: '',
      key,
      historyBars: 40,
      script: SCRIPT,
      localBars: async () => [],
    });
    expect(h.provisioned).toBe('fetch');
    expect(h.sessionId).toBeTruthy();
    const st = await getDataSeriesStatus(URL_, '', key);
    expect(st.count).toBeGreaterThanOrEqual(40);
  });

  it('uploads matching local Data Manager bars before asking the engine to fetch', async () => {
    const key = { exchange: 'binance', symbol: PAIR_LOCAL, interval: '1h' };
    const h = await ensureDataSession({
      endpoint: URL_,
      apiKey: '',
      key,
      historyBars: 20,
      script: SCRIPT,
      localBars: async () => localHourly(30),
    });
    expect(h.provisioned).toBe('local');
    // Broker uploads only the newest history window, not the whole local dataset.
    const st = await getDataSeriesStatus(URL_, '', key);
    expect(st.count).toBe(20);
  });

  it('live ticks send identity only and the engine advances its own session', async () => {
    const key = { exchange: 'binance', symbol: PAIR_TICK, interval: '1h' };
    const first = await runDataSession({
      endpoint: URL_,
      apiKey: '',
      owner: 'ind-e2e',
      request: { ...key, historyBars: 40 },
      script: SCRIPT,
      localBars: async () => [],
    });
    expect(first.ok).toBe(true);
    const tick = await runDataSession({
      endpoint: URL_,
      apiKey: '',
      owner: 'ind-e2e',
      request: { ...key, historyBars: 40 },
      script: SCRIPT,
      tick: true,
      localBars: async () => [],
    });
    expect(tick).toMatchObject({ ok: true, via: 'data-session-tick' });
    if (first.ok) {
      const direct = await tickDataSession(URL_, '', first.sessionId, { exchange: 'binance', symbol: PAIR_TICK });
      expect(direct.ok).toBe(true);
    }
  });

  it('serverEngine evaluates the engine-owned series end to end', async () => {
    const r = await serverEngine.run({
      script: SCRIPT,
      bars: [],
      config: { endpoint: URL_, preferWs: false, mode: 'interpret' },
      dataSession: { exchange: 'binance', symbol: PAIR_LOCAL, interval: '1h', historyBars: 20 },
    });
    expect(r.status).toBe('success');
    expect(r.meta).toMatchObject({ sessionVia: 'data-session-create' });
  });

  it('reports an unknown session as gone so the broker can recreate it', async () => {
    const r = await tickDataSession(URL_, '', 'ses-does-not-exist', { exchange: 'binance', symbol: 'BTC/USDT' });
    expect(r).toMatchObject({ ok: false, gone: true });
  });
});
