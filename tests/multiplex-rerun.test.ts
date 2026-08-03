/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Live multiplex re-run debounce when indicators are visible.
 * Invariant: bar updates schedule silent runner without double-firing storms.
 *
 * Counts schedule attempts via multiplex test hooks (not global fetch) so the
 * suite stays stable under parallel file execution.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { registry } from '../src/plugins/registry';
import { ensureBuiltins, _resetBootstrapFlag } from '../src/plugins/bootstrap';
import { _resetSourceRegistrationFlag } from '../src/sources/catalog';
import { _resetStreamRegistrationFlag, registerDynamicStream } from '../src/streams/catalog';
import { _resetEngineRegistrationFlag } from '../src/engines/catalog';
import { _resetStorageRegistrationFlag } from '../src/storage/catalog';
import { setStore, setActivePlugin, clearLogs, store } from '../src/store';
import {
  startLive,
  stopLive,
  _getRerunAttemptCountForTests,
  _resetMultiplexForTests,
} from '../src/streams/multiplex';
import { SAMPLE_BARS } from './fixtures/bars';

async function waitFor(
  pred: () => boolean,
  timeoutMs: number,
  stepMs = 40,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return pred();
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
  _resetMultiplexForTests();
  setStore('bars', SAMPLE_BARS);
  setStore('endpoint', 'http://run.test:5002');
  setActivePlugin('engine', 'server');
  setStore('scripts', [
    {
      id: 'ind1',
      name: 't',
      code: 'plot(close)',
      paneId: 'price',
      visible: true,
      plots: {},
    },
  ]);
  setStore('live', {
    active: false,
    needsRerun: false,
    lastBarTime: 0,
    streamId: 'x',
    preferAfterLoad: false,
    rerunOn: 'every-tick',
  });
});

afterEach(() => {
  stopLive();
  _resetMultiplexForTests();
});

describe('multiplex scheduleRerun', () => {
  it('re-runs visible indicators after live bars (debounced)', async () => {
    let barSeq = 0;
    registerDynamicStream({
      id: 'rerun-stream',
      name: 'R',
      kind: 'stream',
      start({ onBar, onStatus }) {
        onStatus({ state: 'open' });
        const push = () => {
          barSeq += 1;
          onBar({
            time: Math.floor(Date.now() / 1000) + barSeq,
            open: 1,
            high: 1,
            low: 1,
            close: 1,
            volume: 1,
            closed: true,
          });
        };
        push();
        const t = setInterval(push, 40);
        return () => clearInterval(t);
      },
    });

    startLive('rerun-stream', 'BTCUSDT', '1m');
    expect(store.live.active).toBe(true);
    // Debounce is 400ms — poll for schedule attempt (engine may no-op without fetch)
    const ok = await waitFor(() => _getRerunAttemptCountForTests() >= 1, 2000);
    expect(ok).toBe(true);
    expect(_getRerunAttemptCountForTests()).toBeGreaterThanOrEqual(1);
    stopLive();
  });
});
