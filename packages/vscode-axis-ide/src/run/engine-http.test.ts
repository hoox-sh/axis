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
import type { OhlcvBar } from '../host/mock-bars';
import {
  DEFAULT_ENGINE_ENDPOINT,
  MISSING_ENDPOINT_ERROR,
  barsForPine,
  mapEngineResponse,
  postEngineRun,
  type FetchLike,
} from './engine-http';

const SAMPLE_BARS: OhlcvBar[] = [
  { time: 1_700_000_000, open: 100, high: 101, low: 99, close: 100.5, volume: 10 },
  { time: 1_700_000_060, open: 100.5, high: 102, low: 100, close: 101, volume: 12 },
];

function mockFetch(
  handler: (url: string, init?: Parameters<FetchLike>[1]) => {
    ok: boolean;
    status: number;
    body: string;
  },
): FetchLike {
  return async (url, init) => {
    const res = handler(url, init);
    return {
      ok: res.ok,
      status: res.status,
      text: async () => res.body,
    };
  };
}

describe('barsForPine', () => {
  test('converts unix-seconds time to milliseconds', () => {
    const out = barsForPine(SAMPLE_BARS);
    expect(out).toHaveLength(2);
    expect(out[0]?.time).toBe(1_700_000_000_000);
    expect(out[1]?.close).toBe(101);
  });

  test('passes through already-ms timestamps', () => {
    const out = barsForPine([
      { time: 1_700_000_000_000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ]);
    expect(out[0]?.time).toBe(1_700_000_000_000);
  });
});

describe('mapEngineResponse', () => {
  test('maps success with plots/series', () => {
    const r = mapEngineResponse({
      status: 'success',
      plots: [1, 2, null],
      series: { close: [1, 2, 3], __skip: [9] },
      events: [{ type: 'x' }],
      drawings: [{ id: 'd1' }],
    });
    expect(r.status).toBe('success');
    expect(r.plots).toEqual([1, 2, null]);
    expect(r.series.close).toEqual([1, 2, 3]);
    expect(r.series.__skip).toBeUndefined();
    expect(r.diagnostics).toEqual([]);
    expect(r.drawings).toEqual([{ id: 'd1' }]);
  });

  test('maps error + diagnostics from errors array', () => {
    const r = mapEngineResponse({
      status: 'error',
      message: 'compile failed',
      code: 'COMPILE',
      errors: [{ message: 'unexpected token', line: 3, column: 5 }],
    });
    expect(r.status).toBe('error');
    expect(r.error).toBe('compile failed');
    expect(r.code).toBe('COMPILE');
    expect(r.diagnostics).toEqual([
      { message: 'unexpected token', line: 3, column: 5, severity: 'error' },
    ]);
  });

  test('coerces string diagnostics and warning/info severities', () => {
    const r = mapEngineResponse({
      status: 'error',
      message: 'failed',
      errors: [
        'plain string err',
        { msg: 'warn me', lineno: 2, col: 4, level: 'warn' },
        { error: 'hint me', row: 9, character: 1, severity: 'hint' },
        { message: 'no coords', line: 'x', column: 'y' }, // non-numeric → undefined
        { message: '  ', line: 'x' }, // skipped — empty message
        42, // skipped — non-object
      ],
    });
    expect(r.diagnostics).toEqual([
      { message: 'plain string err', severity: 'error' },
      { message: 'warn me', line: 2, column: 4, severity: 'warning' },
      { message: 'hint me', line: 9, column: 1, severity: 'info' },
      { message: 'no coords', line: undefined, column: undefined, severity: 'error' },
    ]);
  });

  test('infers error from message when status missing; ok:false; status ok', () => {
    expect(mapEngineResponse({ message: 'nope' }).status).toBe('error');
    expect(mapEngineResponse({ ok: false, error: 'x' }).status).toBe('error');
    expect(mapEngineResponse({ status: 'ok', plots: [] }).status).toBe('success');
    expect(mapEngineResponse({ status: 'failed' }).error).toBeTruthy();
    // Non-string error coerced via String(...)
    expect(mapEngineResponse({ status: 'error', error: 404 }).error).toBe('404');
    // No status / no message → success
    expect(mapEngineResponse({ plots: [1] }).status).toBe('success');
  });

  test('never throws on hostile input', () => {
    const r = mapEngineResponse(null);
    expect(r.status).toBe('error');
    expect(r.error).toContain('invalid');
  });

  test('never throws when status getter throws', () => {
    const raw: Record<string, unknown> = {};
    Object.defineProperty(raw, 'status', {
      get() {
        throw new Error('hostile status');
      },
    });
    const r = mapEngineResponse(raw);
    expect(r.status).toBe('error');
    expect(r.error).toContain('hostile');
  });
});

describe('postEngineRun', () => {
  test('POSTs /run with Bearer and pine-ms bars', async () => {
    let seenUrl = '';
    let seenAuth = '';
    let seenBody: Record<string, unknown> = {};
    const fetchImpl = mockFetch((url, init) => {
      seenUrl = url;
      seenAuth = init?.headers?.Authorization ?? '';
      seenBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({ status: 'success', plots: [1], series: {} }),
      };
    });

    const result = await postEngineRun({
      endpoint: DEFAULT_ENGINE_ENDPOINT,
      script: '//@version=5\nindicator("t")\nplot(close)',
      bars: SAMPLE_BARS,
      mode: 'auto',
      apiKey: 'pyn_abcdefghijklmnopqrstuvwxyz0123456789',
      fetchImpl,
    });

    expect(seenUrl).toBe('http://127.0.0.1:5002/run');
    expect(seenAuth).toBe('Bearer pyn_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(seenBody.mode).toBe('auto');
    expect(seenBody.symbol).toBe('CHART');
    const data = seenBody.data as Array<{ time: number }>;
    expect(data[0]?.time).toBe(1_700_000_000_000);
    expect(result.status).toBe('success');
    expect(result.plots).toEqual([1]);
    expect(result.meta.transport).toBe('rest');
  });

  test('maps HTTP error body', async () => {
    const fetchImpl = mockFetch(() => ({
      ok: false,
      status: 401,
      body: JSON.stringify({
        status: 'error',
        code: 'UNAUTHORIZED',
        message: 'invalid key',
      }),
    }));
    const result = await postEngineRun({
      endpoint: 'https://api.example.test',
      script: 'x',
      bars: SAMPLE_BARS,
      mode: 'auto',
      apiKey: 'pyn_abcdefghijklmnopqrstuvwxyz0123456789',
      fetchImpl,
    });
    expect(result.status).toBe('error');
    expect(result.httpStatus).toBe(401);
    expect(result.error).toContain('invalid key');
  });

  test('empty endpoint returns clear error without fetch', async () => {
    let called = false;
    const fetchImpl: FetchLike = async () => {
      called = true;
      return { ok: true, status: 200, text: async () => '{}' };
    };
    const result = await postEngineRun({
      endpoint: '  ',
      script: 'x',
      bars: [],
      mode: 'auto',
      apiKey: 'pyn_abcdefghijklmnopqrstuvwxyz0123456789',
      fetchImpl,
    });
    expect(called).toBe(false);
    expect(result.status).toBe('error');
    expect(result.error).toBe(MISSING_ENDPOINT_ERROR);
  });

  test('missing apiKey fails closed without fetch', async () => {
    let called = false;
    const fetchImpl: FetchLike = async () => {
      called = true;
      return { ok: true, status: 200, text: async () => '{}' };
    };
    const result = await postEngineRun({
      endpoint: DEFAULT_ENGINE_ENDPOINT,
      script: 'x',
      bars: SAMPLE_BARS,
      mode: 'auto',
      fetchImpl,
    });
    expect(called).toBe(false);
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/API key required/i);
  });

  test('network failure becomes error result', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('ECONNREFUSED');
    };
    const result = await postEngineRun({
      endpoint: DEFAULT_ENGINE_ENDPOINT,
      script: 'x',
      bars: SAMPLE_BARS,
      mode: 'auto',
      apiKey: 'pyn_abcdefghijklmnopqrstuvwxyz0123456789',
      fetchImpl,
    });
    expect(result.status).toBe('error');
    expect(result.error).toContain('ECONNREFUSED');
  });

  test('AbortError maps to Aborted', async () => {
    const fetchImpl: FetchLike = async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    };
    const result = await postEngineRun({
      endpoint: DEFAULT_ENGINE_ENDPOINT,
      script: 'x',
      bars: SAMPLE_BARS,
      mode: 'auto',
      apiKey: 'pyn_abcdefghijklmnopqrstuvwxyz0123456789',
      fetchImpl,
    });
    expect(result.error).toBe('Aborted');
  });

  test('non-JSON body becomes INVALID_RESPONSE error', async () => {
    const fetchImpl = mockFetch(() => ({
      ok: false,
      status: 502,
      body: '<html>bad gateway</html>',
    }));
    const result = await postEngineRun({
      endpoint: DEFAULT_ENGINE_ENDPOINT,
      script: 'x',
      bars: SAMPLE_BARS,
      mode: 'auto',
      apiKey: 'pyn_abcdefghijklmnopqrstuvwxyz0123456789',
      fetchImpl,
    });
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/non-JSON|HTTP 502/i);
  });

  test('HTTP error with success-shaped body is still an error', async () => {
    const fetchImpl = mockFetch(() => ({
      ok: false,
      status: 500,
      body: JSON.stringify({ status: 'success', plots: [1] }),
    }));
    const result = await postEngineRun({
      endpoint: DEFAULT_ENGINE_ENDPOINT,
      script: 'x',
      bars: SAMPLE_BARS,
      mode: 'auto',
      apiKey: 'pyn_abcdefghijklmnopqrstuvwxyz0123456789',
      fetchImpl,
    });
    expect(result.status).toBe('error');
    expect(result.error).toContain('HTTP 500');
  });

  test('trims trailing slash on endpoint', async () => {
    let seen = '';
    const fetchImpl = mockFetch((url) => {
      seen = url;
      return { ok: true, status: 200, body: JSON.stringify({ status: 'ok' }) };
    });
    await postEngineRun({
      endpoint: 'http://127.0.0.1:5002/',
      script: 'x',
      bars: [],
      mode: 'compile',
      apiKey: 'pyn_abcdefghijklmnopqrstuvwxyz0123456789',
      fetchImpl,
    });
    expect(seen).toBe('http://127.0.0.1:5002/run');
  });

  test('empty body maps to invalid engine response', async () => {
    const fetchImpl = mockFetch(() => ({ ok: true, status: 200, body: '   ' }));
    const result = await postEngineRun({
      endpoint: DEFAULT_ENGINE_ENDPOINT,
      script: 'x',
      bars: SAMPLE_BARS,
      mode: 'auto',
      apiKey: 'pyn_abcdefghijklmnopqrstuvwxyz0123456789',
      fetchImpl,
    });
    expect(result.status).toBe('error');
  });

  test('HTTP error success-shaped body prefers parsed.message', async () => {
    const fetchImpl = mockFetch(() => ({
      ok: false,
      status: 503,
      body: JSON.stringify({ status: 'ok', message: 'upstream down' }),
    }));
    const result = await postEngineRun({
      endpoint: DEFAULT_ENGINE_ENDPOINT,
      script: 'x',
      bars: SAMPLE_BARS,
      mode: 'auto',
      apiKey: 'pyn_abcdefghijklmnopqrstuvwxyz0123456789',
      fetchImpl,
    });
    expect(result.status).toBe('error');
    expect(result.error).toBe('upstream down');
  });

  test('HTTP error success-shaped body with empty diagnostics uses fallback', async () => {
    const fetchImpl = mockFetch(() => ({
      ok: false,
      status: 502,
      // success status, no message → mapped.diagnostics empty; msg falls to HTTP 502
      body: JSON.stringify({ status: 'success', plots: [] }),
    }));
    const result = await postEngineRun({
      endpoint: DEFAULT_ENGINE_ENDPOINT,
      script: 'x',
      bars: SAMPLE_BARS,
      mode: 'auto',
      apiKey: 'pyn_abcdefghijklmnopqrstuvwxyz0123456789',
      fetchImpl,
    });
    expect(result.status).toBe('error');
    expect(result.diagnostics).toEqual([
      { message: 'HTTP 502', severity: 'error' },
    ]);
  });

  test('HTTP error success-shaped body keeps existing diagnostics', async () => {
    const fetchImpl = mockFetch(() => ({
      ok: false,
      status: 502,
      body: JSON.stringify({
        status: 'success',
        plots: [],
        errors: ['kept'],
      }),
    }));
    const result = await postEngineRun({
      endpoint: DEFAULT_ENGINE_ENDPOINT,
      script: 'x',
      bars: SAMPLE_BARS,
      mode: 'auto',
      apiKey: 'pyn_abcdefghijklmnopqrstuvwxyz0123456789',
      fetchImpl,
    });
    expect(result.status).toBe('error');
    expect(result.diagnostics[0]?.message).toBe('kept');
  });

  test('barsForPine returns [] for non-array', () => {
    expect(barsForPine(null as unknown as OhlcvBar[])).toEqual([]);
  });
});
