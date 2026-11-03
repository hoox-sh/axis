/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Integration: active engine path → runScript with mocked `/run`.
 * Guards end-to-end store bars + engine selection without network.
 */

import '../setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mockFetch, jsonResponse } from '../helpers/mock-fetch';
import { registry } from '../../src/plugins/registry';
import { ensureBuiltins, _resetBootstrapFlag } from '../../src/plugins/bootstrap';
import { _resetSourceRegistrationFlag } from '../../src/sources/catalog';
import { _resetStreamRegistrationFlag } from '../../src/streams/catalog';
import { _resetEngineRegistrationFlag } from '../../src/engines/catalog';
import { _resetStorageRegistrationFlag } from '../../src/storage/catalog';
import { setStore, setActivePlugin, clearLogs } from '../../src/store';
import { runScript } from '../../src/indicators/runner';
import { buildStrategyReport } from '../../src/results/strategy';
import { windowAxisFromMeta } from '../../src/results/window-axis';
import { SAMPLE_BARS } from '../fixtures/bars';

let restoreFetch: (() => void) | null = null;

beforeEach(() => {
  registry.clear();
  _resetSourceRegistrationFlag();
  _resetStreamRegistrationFlag();
  _resetEngineRegistrationFlag();
  _resetStorageRegistrationFlag();
  _resetBootstrapFlag();
  ensureBuiltins();
  clearLogs();
  setStore('bars', SAMPLE_BARS);
  setStore('endpoint', 'http://run.test:5002');
  // This suite mocks REST /run; keep the WS-first default from hijacking it.
  setStore('pluginsConfig', { 'engine:server': { preferWs: false } });
  setActivePlugin('engine', 'server');
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
});

describe('run pipeline', () => {
  it('server engine success via runScript', async () => {
    restoreFetch = mockFetch(async (input) => {
      expect(String(input)).toContain('run.test:5002');
      return jsonResponse({
        status: 'success',
        plots: SAMPLE_BARS.map((_, i) => i),
        series: {},
        events: [],
        meta: { script_name: 'demo', overlay: true },
      });
    });
    const r = await runScript('//@version=5\nindicator("t")\nplot(close)', { silent: true });
    expect(r.status).toBe('success');
    expect(r.plots.length).toBe(SAMPLE_BARS.length);
  });

  it('server engine error path', async () => {
    restoreFetch = mockFetch(async () =>
      jsonResponse({ status: 'error', message: 'parse error' }, 400),
    );
    const r = await runScript('bad', { silent: true });
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/parse error|HTTP/);
  });

  it('stamps the evaluated window axis on the result meta', async () => {
    restoreFetch = mockFetch(async () =>
      jsonResponse({
        status: 'success',
        plots: [],
        series: {},
        events: [],
        meta: { script_name: 'demo', overlay: true },
      }),
    );
    const r = await runScript('//@version=6\nindicator("t")\nplot(close)', { silent: true });
    // `bar_index` in the payload is relative to *this* window — the stamp is
    // what lets every consumer resolve it after the chart window slides.
    const axis = windowAxisFromMeta(r.meta);
    expect(axis).not.toBeNull();
    expect(axis!.t0).toBe(SAMPLE_BARS[0]!.time);
    expect(axis!.count).toBe(SAMPLE_BARS.length);
    expect(axis!.span).toBe(86_400);
  });

  it('resolves bar_index-only strategy events through the stamped axis', async () => {
    restoreFetch = mockFetch(async () =>
      jsonResponse({
        status: 'success',
        plots: [],
        series: {},
        events: [
          { kind: 'entry', id: 'L', direction: 'long', qty: 2, bar_index: 1 },
          { kind: 'close', id: 'L', direction: 'long', qty: 2, bar_index: 2 },
        ],
        meta: { script_name: 'strat', script_type: 'strategy', overlay: false },
      }),
    );
    const r = await runScript('//@version=6\nstrategy("s")', { silent: true });
    const axis = windowAxisFromMeta(r.meta);
    const rep = buildStrategyReport(r.events as never[], SAMPLE_BARS as never, {
      fillMode: 'close',
      axis,
    });
    // Both events carry no time at all — only the window index. The axis is
    // the sole thing that maps index 1/2 onto the bars the engine evaluated.
    expect(rep.trades).toHaveLength(1);
    expect(rep.trades[0]!.entry).toBe(SAMPLE_BARS[1]!.close);
    expect(rep.trades[0]!.exit).toBe(SAMPLE_BARS[2]!.close);
  });
});
