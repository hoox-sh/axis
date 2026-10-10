/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * F11: rows detached mid-fetch must not be resurrected when the fetch lands.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { setStore } from '../src/store';
import {
  attachDefiLlamaTvl,
  detachOnchainSeries,
  getOnchainManagerState,
  _resetOnchainManagerState,
} from '../src/onchain/manager';
import { _resetOnchainHealthProbeState } from '../src/onchain/health';

const realFetch = globalThis.fetch;
let releaseTvl: ((res: Response) => void) | null = null;

function tvlBody(): Response {
  return new Response(
    JSON.stringify({
      slug: 'aave',
      name: 'Aave',
      tvl: [
        { date: 1_700_000_000, totalLiquidityUSD: 100 },
        { date: 1_700_086_400, totalLiquidityUSD: 110 },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

beforeEach(() => {
  setStore('endpoint', 'http://127.0.0.1:8787');
  _resetOnchainManagerState();
  _resetOnchainHealthProbeState();
  releaseTvl = null;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/onchain/health')) {
      return new Response(JSON.stringify({ status: 'ok', providers: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/protocol/aave')) {
      return new Promise<Response>((resolve) => {
        releaseTvl = resolve;
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  _resetOnchainManagerState();
  _resetOnchainHealthProbeState();
});

describe('attachDefiLlamaTvl detach mid-fetch (F11)', () => {
  it('does not resurrect a row detached while its fetch is in flight', async () => {
    const pending = attachDefiLlamaTvl('aave');
    await new Promise((r) => setTimeout(r, 10));
    const placeholder = getOnchainManagerState().attachments;
    expect(placeholder).toHaveLength(1);
    const row = placeholder[0];
    if (!row) throw new Error('expected a placeholder row');
    detachOnchainSeries(row.id);
    expect(getOnchainManagerState().attachments).toHaveLength(0);

    const release = releaseTvl;
    if (!release) throw new Error('expected a gated fetch');
    release(tvlBody());
    const attachment = await pending;
    expect(attachment.instrument.protocolId).toBe('aave');
    // Fresh data returned + cached, but the detached row stays gone.
    expect(getOnchainManagerState().attachments).toHaveLength(0);
    expect(getOnchainManagerState().series).toHaveLength(0);
  });

  it('still attaches normally when nothing is detached', async () => {
    const pending = attachDefiLlamaTvl('aave');
    await new Promise((r) => setTimeout(r, 10));
    const release = releaseTvl;
    if (!release) throw new Error('expected a gated fetch');
    release(tvlBody());
    const attachment = await pending;
    expect(getOnchainManagerState().attachments).toHaveLength(1);
    expect(getOnchainManagerState().attachments[0]?.id).toBe(attachment.id);
  });
});
