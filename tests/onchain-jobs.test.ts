/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * On-chain background TVL refresh jobs (`src/onchain/jobs.ts`).
 * Mocks attach via {@link _setAttachTvlForTests} — no network for TVL.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';
import { setStore } from '../src/store';
import { _resetOnchainHealthProbeState } from '../src/onchain/health';
import {
  listOnchainJobs,
  refreshAttachment,
  refreshAllAttachedTvl,
  cancelOnchainJob,
  dismissOnchainJob,
  onchainJobsState,
  _resetOnchainJobsForTests,
  _setAttachTvlForTests,
  _resetOnchainManagerState,
  _seedOnchainAttachmentsForTests,
  type OnchainSeriesRow,
} from '../src/onchain/manager';

let restoreFetch: (() => void) | null = null;
const attachCalls: Array<{ arg: unknown; name?: string }> = [];

function fakeAttachment(
  id: string,
  protocolId: string,
  extras?: Partial<OnchainSeriesRow>,
): OnchainSeriesRow {
  return {
    id,
    datasetId: 'defillama-tvl',
    providerId: 'defillama',
    provider: 'defillama',
    key: protocolId,
    instrument: {
      chainId: 'all',
      protocolId,
      metric: 'tvl',
      symbol: `${protocolId} TVL`,
    },
    label: `${protocolId} TVL`,
    color: '#939fff',
    visible: true,
    scale: 'left',
    points: [
      { time: 100, value: 1_000 },
      { time: 200, value: 1_100 },
    ],
    provenance: { provider: 'defillama' },
    finality: 'unknown',
    lastTvl: 1_100,
    ...extras,
  };
}

function mockAttachment(slug: string, name?: string) {
  return {
    id: `att-${slug}`,
    datasetId: 'defillama-tvl',
    providerId: 'defillama',
    instrument: {
      chainId: 'all',
      protocolId: slug,
      metric: 'tvl',
      symbol: `${name || slug} TVL`,
    },
    label: `${name || slug} TVL`,
    color: '#939fff',
    visible: true,
    scale: 'left' as const,
    points: [{ time: 1, value: 1 }],
    provenance: { provider: 'defillama' },
    finality: 'unknown' as const,
  };
}

beforeEach(() => {
  setStore('endpoint', 'https://axis.example.test');
  _resetOnchainHealthProbeState();
  _resetOnchainJobsForTests();
  _resetOnchainManagerState();
  attachCalls.length = 0;

  // Health probe may fire; keep it off the wire.
  restoreFetch?.();
  restoreFetch = mockFetch(() =>
    jsonResponse({ ok: true, service: 'axis-onchain', providers: [] }),
  );

  _setAttachTvlForTests(
    mock(async (slugOrHit: unknown, name?: string) => {
      const slug =
        typeof slugOrHit === 'string'
          ? slugOrHit
          : (slugOrHit as { slug?: string })?.slug || '';
      attachCalls.push({ arg: slugOrHit, name });
      await Promise.resolve();
      return mockAttachment(slug, name);
    }) as never,
  );
});

afterEach(() => {
  _resetOnchainJobsForTests();
  _resetOnchainManagerState();
  _resetOnchainHealthProbeState();
  restoreFetch?.();
  restoreFetch = null;
  attachCalls.length = 0;
});

describe('onchain jobs API', () => {
  it('exposes public surface', () => {
    expect(typeof listOnchainJobs).toBe('function');
    expect(typeof refreshAttachment).toBe('function');
    expect(typeof refreshAllAttachedTvl).toBe('function');
    expect(typeof cancelOnchainJob).toBe('function');
    expect(typeof dismissOnchainJob).toBe('function');
    expect(Array.isArray(onchainJobsState.jobs)).toBe(true);
    expect(listOnchainJobs()).toEqual([]);
  });

  it('refreshAllAttachedTvl is a no-op with no attachments', async () => {
    await refreshAllAttachedTvl();
    expect(listOnchainJobs()).toEqual([]);
    expect(attachCalls).toEqual([]);
  });

  it('refreshAttachment rejects unknown id', async () => {
    await expect(refreshAttachment('missing')).rejects.toThrow(/not found/i);
    expect(attachCalls).toEqual([]);
  });

  it('refreshAttachment rejects empty protocol id', async () => {
    _seedOnchainAttachmentsForTests([
      fakeAttachment('att-empty', '', {
        instrument: {
          chainId: 'all',
          protocolId: '',
          metric: 'tvl',
          symbol: 'TVL',
        },
        key: '',
      }),
    ]);
    await expect(refreshAttachment('att-empty')).rejects.toThrow(
      /no protocol id/i,
    );
    expect(attachCalls).toEqual([]);
  });

  it('queues refresh_tvl and calls mocked attachDefiLlamaTvl', async () => {
    _seedOnchainAttachmentsForTests([fakeAttachment('att-1', 'aave')]);

    await refreshAttachment('att-1');

    expect(attachCalls).toHaveLength(1);
    expect(attachCalls[0]!.arg).toBe('aave');
    expect(attachCalls[0]!.name).toBe('aave'); // stripped trailing " TVL"

    const jobs = listOnchainJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.kind).toBe('refresh_tvl');
    expect(jobs[0]!.status).toBe('complete');
    expect(jobs[0]!.progress).toBe(1);
    expect(jobs[0]!.error).toBeNull();
    expect(jobs[0]!.id).toMatch(/^ocj_/);
  });

  it('refreshAllAttachedTvl queues one job per series', async () => {
    _seedOnchainAttachmentsForTests([
      fakeAttachment('att-1', 'aave'),
      fakeAttachment('att-2', 'lido'),
      fakeAttachment('att-3', 'uniswap'),
    ]);

    await refreshAllAttachedTvl();

    expect(attachCalls.map((c) => c.arg).sort()).toEqual([
      'aave',
      'lido',
      'uniswap',
    ]);
    const jobs = listOnchainJobs().filter((j) => j.kind === 'refresh_tvl');
    expect(jobs).toHaveLength(3);
    expect(jobs.every((j) => j.status === 'complete')).toBe(true);
  });

  it('throws when every child refresh fails', async () => {
    _setAttachTvlForTests(
      mock(async () => {
        throw new Error('network down');
      }) as never,
    );
    _seedOnchainAttachmentsForTests([fakeAttachment('att-1', 'aave')]);

    await expect(refreshAllAttachedTvl()).rejects.toThrow(/network down/i);
    expect(listOnchainJobs().some((j) => j.status === 'error')).toBe(true);
  });

  it('cancelOnchainJob is a no-op for unknown ids', () => {
    cancelOnchainJob('nope');
    expect(listOnchainJobs()).toEqual([]);
  });

  it('dismissOnchainJob removes a completed job', async () => {
    _seedOnchainAttachmentsForTests([fakeAttachment('att-1', 'aave')]);
    await refreshAttachment('att-1');
    const id = listOnchainJobs()[0]!.id;
    dismissOnchainJob(id);
    expect(listOnchainJobs().find((j) => j.id === id)).toBeUndefined();
  });

  it('caps retained job history at 20', async () => {
    _seedOnchainAttachmentsForTests([fakeAttachment('att-1', 'aave')]);
    for (let i = 0; i < 25; i++) {
      await refreshAttachment('att-1');
    }
    expect(listOnchainJobs().length).toBeLessThanOrEqual(20);
  });
});
