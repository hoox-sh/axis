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

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import {
  buildWorkersCards,
  countsFromWorkerCards,
  displayWorkerEndpoint,
  encodeWorkersInit,
  encodeWorkersProbe,
  encodeWorkersProbeAll,
  encodeWorkersReady,
  encodeWorkersState,
  parseWorkersStudioMessage,
  shortWorkerErrorLabel,
  workersStudioSnapshot,
} from './workers-studio-model';

const CATALOG = [
  {
    id: 'pyne-pro',
    name: 'pyne Pro API',
    summary: 'CPython backend',
    probe: 'http-health',
    defaultEndpoint: 'http://user:s3cret@127.0.0.1:5002/health?token=abc',
  },
  {
    id: 'pyodide',
    name: 'Pyodide',
    summary: 'Wasm calculator',
    probe: 'pyodide',
    defaultEndpoint: '',
  },
  {
    id: 'axis-worker',
    name: 'AXIS Worker',
    summary: 'Edge data plane',
    probe: 'http-health',
    defaultEndpoint: 'https://worker.axis.hoox.sh/health',
  },
];

describe('workers studio model', () => {
  test('pure module does not import vscode or workers.ts', () => {
    const src = readFileSync(new URL('./workers-studio-model.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from\s+['"]vscode['"]/);
    expect(src).not.toMatch(/workers\.ts/);
    expect(src).toContain('AGPL-3.0-only');
    expect(src).not.toContain('or later');
  });

  test('buildWorkersCards is unknown before the first probe', () => {
    const cards = buildWorkersCards(CATALOG, null);
    expect(cards.map((c) => c.status)).toEqual(['unknown', 'unknown', 'unknown']);
    expect(cards.map((c) => c.latencyMs)).toEqual([null, null, null]);
    expect(cards.map((c) => c.detail)).toEqual(['', '', '']);
    expect(cards[0]?.endpoint).toBe('127.0.0.1:5002');
    expect(cards[0]?.endpoint).not.toContain('token');
    expect(cards[0]?.endpoint).not.toContain('s3cret');
    expect(cards[0]?.endpoint).not.toContain('/health');
    expect(cards[1]?.endpoint).toBe('');
    expect(cards[2]?.endpoint).toBe('worker.axis.hoox.sh');
    expect(cards[0]).toMatchObject({
      id: 'pyne-pro',
      name: 'pyne Pro API',
      summary: 'CPython backend',
      probe: 'http-health',
    });
    const view = workersStudioSnapshot(CATALOG, null);
    expect(view.probed).toBe(false);
    expect(view.counts).toEqual({ healthy: 0, degraded: 0, down: 0, unknown: 3 });
    const init = encodeWorkersInit(CATALOG, undefined);
    expect(init.type).toBe('workers.init');
    expect(init.probed).toBe(false);
    expect(init.cards.every((c) => c.status === 'unknown')).toBe(true);
  });

  test('buildWorkersCards maps probe results and drops bodies', () => {
    const snap = {
      results: [
        {
          id: 'pyne-pro',
          status: 'healthy',
          latencyMs: 12,
          detail: '{"ok":true,"token":"sekrit-body"}',
          endpoint: 'http://127.0.0.1:5002/?access_token=zzz',
          error: null,
        },
        {
          id: 'pyodide',
          status: 'skipped',
          latencyMs: null,
          detail: 'Pyodide probe is webview-only',
          endpoint: '',
          error: null,
        },
        {
          id: 'axis-worker',
          status: 'down',
          latencyMs: 40,
          detail: '{"error":"boom","authorization":"Bearer abc"}',
          endpoint: 'https://worker.axis.hoox.sh',
          error: 'ECONNREFUSED',
        },
      ],
      healthy: 99,
      degraded: 99,
      down: 99,
      unknown: 99,
    };
    const cards = buildWorkersCards(CATALOG, snap);
    expect(cards[0]).toMatchObject({
      status: 'healthy',
      latencyMs: 12,
      detail: '',
      endpoint: '127.0.0.1:5002',
    });
    expect(JSON.stringify(cards[0])).not.toContain('sekrit');
    expect(JSON.stringify(cards[0])).not.toContain('access_token');
    expect(cards[1]).toMatchObject({ status: 'skipped', detail: '', latencyMs: null });
    expect(cards[2]).toMatchObject({
      status: 'down',
      latencyMs: 40,
      detail: 'ECONNREFUSED',
      endpoint: 'worker.axis.hoox.sh',
    });
    expect(JSON.stringify(cards)).not.toContain('Bearer');
    const state = encodeWorkersState(CATALOG, snap);
    expect(state.type).toBe('workers.state');
    expect(state.probed).toBe(true);
    expect(state.counts).toEqual({ healthy: 1, degraded: 0, down: 1, unknown: 1 });
    expect(countsFromWorkerCards(cards)).toEqual(state.counts);
  });

  test('degraded short label, json and secret errors collapse', () => {
    expect(shortWorkerErrorLabel('healthy', '{"token":"x"}', null)).toBe('');
    expect(shortWorkerErrorLabel('down', 'ignored', 'HTTP 503')).toBe('HTTP 503');
    expect(shortWorkerErrorLabel('degraded', '', 'slow')).toBe('slow');
    expect(shortWorkerErrorLabel('down', '{"nope":1}', null)).toBe('down');
    expect(shortWorkerErrorLabel('down', '', 'token=abc')).toBe('down');
    expect(shortWorkerErrorLabel('degraded', '', '')).toBe('degraded');
    expect(displayWorkerEndpoint('not a url')).toBe('not a url');
    expect(displayWorkerEndpoint(12)).toBe('');
    const cards = buildWorkersCards(
      [{ id: 'edge', name: '', summary: 's', probe: 'http-health', defaultEndpoint: '' }],
      {
        results: [
          {
            id: 'edge',
            status: 'degraded',
            latencyMs: Number.NaN,
            detail: 'slow path',
            endpoint: '',
            error: null,
          },
        ],
      },
    );
    expect(cards[0]).toMatchObject({
      name: 'edge',
      status: 'degraded',
      latencyMs: null,
      detail: 'slow path',
    });
  });

  test('skips hostile catalog rows and never throws', () => {
    expect(buildWorkersCards(null, null)).toEqual([]);
    expect(buildWorkersCards({ id: 'x' }, null)).toEqual([]);
    expect(
      buildWorkersCards(
        [null, { id: 'bad id' }, { id: 'ok', name: 'Ok', probe: 'none' }, { probe: 'http-health' }],
        null,
      ).map((c) => c.id),
    ).toEqual(['ok']);
    const boom = new Proxy(
      { results: [] },
      {
        get() {
          throw new Error('snap');
        },
      },
    );
    expect(buildWorkersCards(CATALOG, boom).every((c) => c.status === 'unknown')).toBe(true);
    const hostileCatalog = new Proxy([CATALOG[0]], {
      get(target, prop) {
        if (prop === Symbol.iterator) {
          throw new Error('iter');
        }
        return Reflect.get(target, prop);
      },
    });
    expect(buildWorkersCards(hostileCatalog, null)).toEqual([]);
    expect(() => encodeWorkersInit(hostileCatalog, boom)).not.toThrow();
    expect(encodeWorkersState(null, null).cards).toEqual([]);
    expect(workersStudioSnapshot(CATALOG, []).probed).toBe(false);
  });

  test('parseWorkersStudioMessage never throws', () => {
    expect(parseWorkersStudioMessage({ type: 'workers.ready' })).toEqual({
      type: 'workers.ready',
    });
    expect(parseWorkersStudioMessage(encodeWorkersProbeAll())).toEqual({
      type: 'workers.probeAll',
    });
    expect(parseWorkersStudioMessage(encodeWorkersReady())).toEqual({ type: 'workers.ready' });
    expect(parseWorkersStudioMessage({ type: 'workers.probe', id: 'pyne-pro' })).toEqual({
      type: 'workers.probe',
      id: 'pyne-pro',
    });
    expect(
      parseWorkersStudioMessage({ type: 'workers.probe', payload: { id: 'axis-worker' } }),
    ).toEqual({ type: 'workers.probe', id: 'axis-worker' });
    expect(parseWorkersStudioMessage({ type: 'workers.probe' })).toBeNull();
    expect(parseWorkersStudioMessage({ type: 'workers.probe', id: '' })).toBeNull();
    expect(parseWorkersStudioMessage({ type: 'workers.probe', id: 'has space' })).toBeNull();
    expect(encodeWorkersProbe('')).toBeNull();
    expect(encodeWorkersProbe('nope/id')).toBeNull();
    expect(parseWorkersStudioMessage(null)).toBeNull();
    expect(parseWorkersStudioMessage([])).toBeNull();
    expect(parseWorkersStudioMessage({ type: '' })).toBeNull();
    expect(parseWorkersStudioMessage({ type: 'workers.other' })).toBeNull();
    expect(parseWorkersStudioMessage({ type: 'workers.init' })).toBeNull();
    expect(parseWorkersStudioMessage({ type: 'workers.state', cards: 'nope' })).toBeNull();

    const parsed = parseWorkersStudioMessage({
      type: 'workers.init',
      probed: true,
      counts: { healthy: 50, degraded: 0, down: 0, unknown: 0 },
      cards: [
        {
          id: 'pyne-pro',
          name: 'pyne Pro API',
          summary: 'CPython',
          probe: 'http-health',
          endpoint: 'https://user:pw@worker.axis.hoox.sh/x?token=abc',
          status: 'healthy',
          latencyMs: 3,
          detail: 'raw body token=hide-me',
        },
        { id: '../x', name: 'nope', status: 'down' },
      ],
    });
    expect(parsed?.type).toBe('workers.init');
    if (parsed && parsed.type === 'workers.init') {
      expect(parsed.probed).toBe(true);
      expect(parsed.counts).toEqual({ healthy: 1, degraded: 0, down: 0, unknown: 0 });
      expect(parsed.cards).toHaveLength(1);
      expect(parsed.cards[0]?.endpoint).toBe('worker.axis.hoox.sh');
      expect(parsed.cards[0]?.detail).toBe('');
      expect(JSON.stringify(parsed)).not.toContain('hide-me');
      expect(JSON.stringify(parsed)).not.toContain('token');
    }

    const down = parseWorkersStudioMessage({
      type: 'workers.state',
      cards: [
        {
          id: 'axis-worker',
          name: 'AXIS Worker',
          summary: '',
          probe: 'http-health',
          endpoint: 'https://worker.axis.hoox.sh',
          status: 'down',
          latencyMs: -1,
          detail: 'HTTP 500',
        },
      ],
    });
    if (down && down.type === 'workers.state') {
      expect(down.probed).toBe(false);
      expect(down.cards[0]).toMatchObject({
        status: 'down',
        latencyMs: null,
        detail: 'HTTP 500',
      });
      expect(down.counts.down).toBe(1);
    } else {
      throw new Error('expected workers.state');
    }

    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('decode');
        },
      },
    );
    expect(parseWorkersStudioMessage(hostile)).toBeNull();
    expect(() => parseWorkersStudioMessage(hostile)).not.toThrow();

    const badStatus = buildWorkersCards(
      [{ id: 'axis-worker', name: 'AXIS', summary: '', probe: 'none', defaultEndpoint: '' }],
      { results: [{ id: 'axis-worker', status: 'nope', latencyMs: Number.NaN }] },
    );
    expect(badStatus[0]).toMatchObject({ status: 'unknown', latencyMs: null, detail: '' });

    const throwingRow = buildWorkersCards(
      [{ id: 'pyne-pro', name: 'pyne', summary: '', probe: 'none', defaultEndpoint: 'http://127.0.0.1:5002' }],
      {
        results: [
          { get id() { throw new Error('row'); } },
          { id: 'pyne-pro', status: 'idle' },
        ],
      },
    );
    expect(throwingRow[0]?.status).toBe('idle');

    expect(
      buildWorkersCards(CATALOG, { get results() { throw new Error('results'); } }).length,
    ).toBe(CATALOG.length);

    const throwingEntry = [{ get id() { throw new Error('entry'); } }, { id: 'ok', name: 'Ok' }];
    expect(buildWorkersCards(throwingEntry, null).map((c) => c.id)).toEqual(['ok']);

    const cards = [
      {
        id: 'a',
        name: 'A',
        summary: '',
        probe: '',
        endpoint: '',
        status: 'healthy' as const,
        latencyMs: null,
        detail: '',
      },
    ];
    const throwingCards = new Proxy(cards, {
      get(target, prop) {
        if (prop === Symbol.iterator) throw new Error('cards');
        return Reflect.get(target, prop);
      },
    });
    expect(countsFromWorkerCards(throwingCards)).toEqual({
      healthy: 0,
      degraded: 0,
      down: 0,
      unknown: 0,
    });

    const throwingCardList = new Proxy([{ get id() { throw new Error('card'); } }], {
      get(target, prop, receiver) {
        if (prop === Symbol.iterator) return Reflect.get(target, prop, receiver);
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(
      parseWorkersStudioMessage({ type: 'workers.init', cards: throwingCardList, probed: false }),
    ).toMatchObject({ type: 'workers.init', cards: [] });

    const badList = new Proxy([] as unknown[], {
      get(target, prop) {
        if (prop === Symbol.iterator) throw new Error('list');
        return Reflect.get(target, prop);
      },
    });
    expect(parseWorkersStudioMessage({ type: 'workers.state', cards: badList })).toBeNull();

    expect(
      parseWorkersStudioMessage({
        type: 'workers.probe',
        get id() {
          throw new Error('id');
        },
      }),
    ).toBeNull();
  });
});
