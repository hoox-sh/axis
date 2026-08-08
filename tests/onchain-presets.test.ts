/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * On-chain popular / DEX presets (`src/onchain/presets.ts`).
 * List shape tests are pure; attachPopularTvl uses fetch mock (no live network).
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';
import { setStore } from '../src/store';
import { _clearDefiLlamaProtocolsCache } from '../src/onchain/defillama';
import { _resetOnchainHealthProbeState } from '../src/onchain/health';
import {
  POPULAR_TVL_PROTOCOLS,
  DEX_NETWORK_PRESETS,
  attachPopularTvl,
} from '../src/onchain/presets';
import {
  _resetOnchainManagerState,
  _seedOnchainAttachmentsForTests,
  MAX_ONCHAIN_SERIES,
  type OnchainSeriesRow,
} from '../src/onchain/manager';

let restoreFetch: (() => void) | null = null;
const protocolHits: string[] = [];

function installTvlFetch(opts?: {
  failSlug?: string;
}): void {
  restoreFetch?.();
  protocolHits.length = 0;
  restoreFetch = mockFetch((input) => {
    const url = String(input);
    if (url.includes('/health')) {
      return jsonResponse({ ok: true, service: 'axis-onchain', providers: [] });
    }
    const m = /\/protocol\/([^/?#]+)/.exec(url);
    if (m) {
      const slug = decodeURIComponent(m[1]!);
      protocolHits.push(slug);
      if (opts?.failSlug && slug === opts.failSlug) {
        return jsonResponse({ error: 'fail' }, 500);
      }
      return jsonResponse({
        name: slug,
        slug,
        tvl: [
          { date: 100, totalLiquidityUSD: 1_000 },
          { date: 200, totalLiquidityUSD: 1_100 },
        ],
      });
    }
    if (url.includes('/protocols')) {
      return jsonResponse([]);
    }
    return jsonResponse({});
  });
}

function fakeAttachment(id: string, protocolId: string): OnchainSeriesRow {
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
    points: [{ time: 1, value: 1 }],
    provenance: { provider: 'defillama' },
    finality: 'unknown',
    lastTvl: 1,
  };
}

beforeEach(() => {
  setStore('endpoint', 'https://axis.example.test');
  _resetOnchainHealthProbeState();
  _clearDefiLlamaProtocolsCache();
  _resetOnchainManagerState();
  protocolHits.length = 0;
  restoreFetch?.();
  restoreFetch = null;
});

afterEach(() => {
  _resetOnchainManagerState();
  _resetOnchainHealthProbeState();
  _clearDefiLlamaProtocolsCache();
  restoreFetch?.();
  restoreFetch = null;
  protocolHits.length = 0;
});

describe('POPULAR_TVL_PROTOCOLS', () => {
  it('is a non-empty list of { slug, name } strings', () => {
    expect(Array.isArray(POPULAR_TVL_PROTOCOLS)).toBe(true);
    expect(POPULAR_TVL_PROTOCOLS.length).toBeGreaterThanOrEqual(8);
    for (const p of POPULAR_TVL_PROTOCOLS) {
      expect(typeof p.slug).toBe('string');
      expect(p.slug.length).toBeGreaterThan(0);
      expect(typeof p.name).toBe('string');
      expect(p.name.length).toBeGreaterThan(0);
    }
  });

  it('includes well-known protocols and unique slugs', () => {
    const slugs = POPULAR_TVL_PROTOCOLS.map((p) => p.slug);
    expect(slugs).toContain('aave');
    expect(slugs).toContain('lido');
    expect(slugs).toContain('uniswap');
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe('DEX_NETWORK_PRESETS', () => {
  it('is a non-empty list of { id, label, gecko }', () => {
    expect(Array.isArray(DEX_NETWORK_PRESETS)).toBe(true);
    expect(DEX_NETWORK_PRESETS.length).toBeGreaterThanOrEqual(4);
    for (const n of DEX_NETWORK_PRESETS) {
      expect(typeof n.id).toBe('string');
      expect(n.id.length).toBeGreaterThan(0);
      expect(typeof n.label).toBe('string');
      expect(typeof n.gecko).toBe('string');
      expect(n.gecko.length).toBeGreaterThan(0);
    }
  });

  it('covers eth and solana with matching gecko ids', () => {
    const byId = Object.fromEntries(DEX_NETWORK_PRESETS.map((n) => [n.id, n]));
    expect(byId.eth?.gecko).toBe('eth');
    expect(byId.solana?.gecko).toBe('solana');
    expect(byId.polygon?.gecko).toBe('polygon_pos');
  });
});

describe('attachPopularTvl', () => {
  it('attaches first N presets (mocked DefiLlama fetch)', async () => {
    installTvlFetch();
    const result = await attachPopularTvl(3);
    expect(result.ok).toHaveLength(3);
    expect(result.failed).toEqual([]);
    expect(result.ok[0]).toBe('aave');
    expect(result.ok[1]).toBe('lido');
    expect(result.ok[2]).toBe('uniswap');
    expect(protocolHits).toEqual(['aave', 'lido', 'uniswap']);
  });

  it('records failures without throwing', async () => {
    installTvlFetch({ failSlug: 'lido' });
    const result = await attachPopularTvl(3);
    expect(result.ok).toEqual(['aave', 'uniswap']);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.slug).toBe('lido');
    expect(result.failed[0]!.error).toMatch(/HTTP 500|fail|DefiLlama/i);
  });

  it('stops adding net-new series when MAX_ONCHAIN_SERIES is full', async () => {
    const fillers: OnchainSeriesRow[] = [];
    for (let i = 0; i < MAX_ONCHAIN_SERIES; i++) {
      fillers.push(fakeAttachment(`f${i}`, `filler-${i}`));
    }
    _seedOnchainAttachmentsForTests(fillers);

    installTvlFetch();
    const result = await attachPopularTvl(5);
    expect(result.ok).toEqual([]);
    expect(protocolHits).toEqual([]);
  });
});
