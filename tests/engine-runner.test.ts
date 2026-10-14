// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * PYNE hosted-runner client: route gating on `features.script_runner`, cron job
 * listing / enable / run-now, and the "not offered" contract (404
 * `RUNNER_DISABLED` is unavailable, not an error).
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';
import {
  deployHostedScript,
  listHostedJobs,
  runHostedJobNow,
  runnerAvailable,
  setHostedJobEnabled,
} from '../src/engines/runner';
import { _setCachedEngineHealthForTests } from '../src/engines/catalog';
import { healthFromBody } from '../src/engines/health';
import { setActivePlugin, setStore } from '../src/store';

const ENDPOINT = 'http://runner.test:5002';

interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

let restore: (() => void) | null = null;
let calls: Call[] = [];

function install(handler: (call: Call) => Response | Promise<Response>): void {
  restore = mockFetch(async (input, init) => {
    const url = new URL(String(input));
    const call: Call = {
      method: String(init?.method || 'GET').toUpperCase(),
      path: url.pathname,
      headers: (init?.headers as Record<string, string>) || {},
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    };
    calls.push(call);
    return handler(call);
  });
}

const JOBS = {
  status: 'success',
  jobs: [
    {
      id: 'rsi-alerts',
      name: 'RSI alerts',
      symbol: 'BTCUSDT',
      timeframe: '1h',
      enabled: true,
      cron: { enabled: true, last_run: 1_770_000_000, next_run: 1_770_003_600 },
    },
  ],
  count: 1,
};

beforeEach(() => {
  calls = [];
  setStore('endpoint', ENDPOINT);
  setStore('pluginsConfig', { 'engine:server': { mode: 'auto' } });
  setActivePlugin('engine', 'server');
  _setCachedEngineHealthForTests(null);
});

afterEach(() => {
  restore?.();
  restore = null;
  _setCachedEngineHealthForTests(null);
});

describe('runnerAvailable', () => {
  it('is false until /health advertises features.script_runner', () => {
    expect(runnerAvailable()).toBe(false);
    _setCachedEngineHealthForTests(healthFromBody({ features: { script_runner: false } }));
    expect(runnerAvailable()).toBe(false);
    _setCachedEngineHealthForTests(healthFromBody({ features: { script_runner: true } }));
    expect(runnerAvailable()).toBe(true);
  });
});

describe('listHostedJobs', () => {
  it('reads jobs with their cron state', async () => {
    install(() => jsonResponse(JOBS));
    const r = await listHostedJobs();
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.path).toBe('/cron/jobs');
    expect(r.ok).toBe(true);
    expect(r.data?.length).toBe(1);
    expect(r.data?.[0]?.id).toBe('rsi-alerts');
    expect(r.data?.[0]?.cron?.next_run).toBe(1_770_003_600);
  });

  it('reports a disabled runner as unavailable, not an error', async () => {
    install(() =>
      jsonResponse(
        { status: 'error', code: 'RUNNER_DISABLED', message: 'Set PYNE_RUNNER=1' },
        404,
      ),
    );
    const r = await listHostedJobs();
    expect(r.ok).toBe(false);
    expect(r.unavailable).toBe(true);
    expect(r.error).toContain('PYNE_RUNNER');
  });

  it('reports denied access distinctly', async () => {
    install(() => jsonResponse({ status: 'error' }, 403));
    const r = await listHostedJobs();
    expect(r.ok).toBe(false);
    expect(r.unavailable).toBe(false);
    expect(r.error).toBe('Runner access denied');
  });

  it('never throws on transport failure', async () => {
    install(() => {
      throw new Error('offline');
    });
    const r = await listHostedJobs();
    expect(r.ok).toBe(false);
    expect(r.error).toBe('offline');
  });
});

describe('setHostedJobEnabled', () => {
  it('PUTs the job list and counts the update', async () => {
    install(() => jsonResponse({ status: 'success', updated: [{ script_id: 'x', enabled: false }], count: 1 }));
    const r = await setHostedJobEnabled('x', false);
    expect(calls[0]!.method).toBe('PUT');
    expect(calls[0]!.path).toBe('/cron/jobs');
    expect(calls[0]!.body).toEqual({ jobs: [{ script_id: 'x', enabled: false }] });
    expect(r.ok).toBe(true);
    expect(r.data).toBe(1);
  });

  it('sends the admin token when provided', async () => {
    install(() => jsonResponse({ status: 'success', count: 1 }));
    await setHostedJobEnabled('x', true, { adminToken: 'adm_secret' });
    expect(calls[0]!.headers['X-Admin-Token']).toBe('adm_secret');
  });
});

describe('runHostedJobNow', () => {
  it('POSTs a single script tick', async () => {
    install(() => jsonResponse({ status: 'success', ran: ['x'], count: 1 }));
    const r = await runHostedJobNow('x');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.path).toBe('/cron/run');
    expect(calls[0]!.body).toEqual({ script_id: 'x' });
    expect(r.ok).toBe(true);
    expect(r.data?.count).toBe(1);
  });

  it('ticks every due script when no id is given', async () => {
    install(() => jsonResponse({ status: 'success', ran: [], count: 0 }));
    await runHostedJobNow(undefined, { force: true });
    expect(calls[0]!.body).toEqual({ force: true });
  });

  it('surfaces a backend error message', async () => {
    install(() => jsonResponse({ status: 'error', message: 'script not found' }, 400));
    const r = await runHostedJobNow('missing');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('script not found');
  });
});

describe('deployHostedScript', () => {
  it('POSTs the snake_case body and returns the created job', async () => {
    install(() =>
      jsonResponse({ status: 'success', script: { id: 'rsi-1', name: 'RSI', enabled: true } }, 201),
    );
    const r = await deployHostedScript({
      id: 'rsi-1',
      script: 'indicator("rsi")',
      name: 'RSI',
      symbol: 'BTCUSDT',
      timeframe: '1h',
      dataSource: 'binance',
      enabled: true,
    });
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.path).toBe('/scripts');
    expect(calls[0]!.body).toEqual({
      id: 'rsi-1',
      script: 'indicator("rsi")',
      name: 'RSI',
      symbol: 'BTCUSDT',
      timeframe: '1h',
      data_source: 'binance',
      enabled: true,
    });
    expect(r.ok).toBe(true);
    expect(r.data?.id).toBe('rsi-1');
  });

  it('requires an id and script without a request', async () => {
    install(() => jsonResponse({ status: 'success', script: { id: 'x' } }, 201));
    expect((await deployHostedScript({ id: '', script: 'x' })).error).toContain('required');
    expect((await deployHostedScript({ id: 'x', script: '  ' })).error).toContain('required');
    expect(calls.length).toBe(0);
  });

  it('maps a disabled runner to unavailable', async () => {
    install(() => jsonResponse({ status: 'error', code: 'RUNNER_DISABLED' }, 404));
    const r = await deployHostedScript({ id: 'x', script: 'indicator("x")' });
    expect(r.ok).toBe(false);
    expect(r.unavailable).toBe(true);
  });
});
