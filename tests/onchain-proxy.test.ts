/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * On-chain Worker proxy base URL resolution (`src/onchain/proxy.ts`).
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import { setStore } from '../src/store';
import {
  normalizeEndpointBase,
  looksLikeOnchainWorkerEndpoint,
  resolveDefiLlamaBaseUrl,
  resolveGeckoTerminalBaseUrl,
  isWorkerLlamaProxy,
  ONCHAIN_LLAMA_PROXY_PATH,
  ONCHAIN_GECKO_PROXY_PATH,
} from '../src/onchain/proxy';
import { DEFILLAMA_DEFAULT_BASE } from '../src/onchain/defillama';
import { GECKOTERMINAL_DEFAULT_BASE } from '../src/onchain/geckoterminal';

beforeEach(() => {
  setStore('endpoint', 'https://axis.hoox.sh');
});

describe('normalizeEndpointBase', () => {
  it('strips trailing slashes and /api/run', () => {
    expect(normalizeEndpointBase('https://axis.hoox.sh/')).toBe('https://axis.hoox.sh');
    expect(normalizeEndpointBase('https://axis.hoox.sh/api/run')).toBe('https://axis.hoox.sh');
    expect(normalizeEndpointBase('http://127.0.0.1:8787/api/')).toBe('http://127.0.0.1:8787');
  });

  it('rejects non-http schemes', () => {
    expect(normalizeEndpointBase('ftp://x')).toBe('');
    expect(normalizeEndpointBase('')).toBe('');
    expect(normalizeEndpointBase(null)).toBe('');
  });
});

describe('looksLikeOnchainWorkerEndpoint', () => {
  it('matches workers.dev and wrangler local', () => {
    expect(
      looksLikeOnchainWorkerEndpoint('https://pynescript-axis.cryptolinx.workers.dev'),
    ).toBe(true);
    expect(looksLikeOnchainWorkerEndpoint('http://127.0.0.1:8787')).toBe(true);
    expect(looksLikeOnchainWorkerEndpoint('http://localhost:8787')).toBe(true);
  });

  it('rejects VPS / Pro API hosts that serve SPA HTML for /api/onchain', () => {
    expect(looksLikeOnchainWorkerEndpoint('https://axis.hoox.sh')).toBe(false);
    expect(looksLikeOnchainWorkerEndpoint('http://127.0.0.1:5002')).toBe(false);
    expect(looksLikeOnchainWorkerEndpoint('http://localhost:3000')).toBe(false);
    expect(looksLikeOnchainWorkerEndpoint('')).toBe(false);
  });
});

describe('resolveDefiLlamaBaseUrl', () => {
  it('prefers explicit config.baseUrl', () => {
    expect(resolveDefiLlamaBaseUrl({ baseUrl: 'https://api.llama.fi/' })).toBe(
      'https://api.llama.fi',
    );
  });

  it('uses direct llama API when endpoint is axis.hoox.sh (no Worker routes)', () => {
    setStore('endpoint', 'https://axis.hoox.sh');
    expect(resolveDefiLlamaBaseUrl()).toBe(DEFILLAMA_DEFAULT_BASE);
    expect(isWorkerLlamaProxy(resolveDefiLlamaBaseUrl())).toBe(false);
  });

  it('uses Worker llama proxy when endpoint is workers.dev', () => {
    setStore('endpoint', 'https://pynescript-axis.cryptolinx.workers.dev');
    expect(resolveDefiLlamaBaseUrl()).toBe(
      `https://pynescript-axis.cryptolinx.workers.dev${ONCHAIN_LLAMA_PROXY_PATH}`,
    );
    expect(isWorkerLlamaProxy(resolveDefiLlamaBaseUrl())).toBe(true);
  });

  it('uses Worker proxy for local wrangler :8787', () => {
    setStore('endpoint', 'http://127.0.0.1:8787');
    expect(resolveDefiLlamaBaseUrl()).toBe(
      `http://127.0.0.1:8787${ONCHAIN_LLAMA_PROXY_PATH}`,
    );
  });

  it('falls back to public llama API when endpoint empty', () => {
    setStore('endpoint', '');
    expect(resolveDefiLlamaBaseUrl()).toBe(DEFILLAMA_DEFAULT_BASE);
  });
});

describe('resolveGeckoTerminalBaseUrl', () => {
  it('uses direct gecko API for VPS endpoint', () => {
    setStore('endpoint', 'https://axis.hoox.sh');
    expect(resolveGeckoTerminalBaseUrl()).toBe(GECKOTERMINAL_DEFAULT_BASE);
  });

  it('uses Worker gecko proxy for workers.dev', () => {
    setStore('endpoint', 'https://pynescript-axis.cryptolinx.workers.dev');
    expect(resolveGeckoTerminalBaseUrl()).toBe(
      `https://pynescript-axis.cryptolinx.workers.dev${ONCHAIN_GECKO_PROXY_PATH}`,
    );
  });
});
