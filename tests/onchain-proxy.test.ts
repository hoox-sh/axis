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
  resolveDefiLlamaBaseUrl,
  isWorkerLlamaProxy,
  ONCHAIN_LLAMA_PROXY_PATH,
} from '../src/onchain/proxy';
import { DEFILLAMA_DEFAULT_BASE } from '../src/onchain/defillama';

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

describe('resolveDefiLlamaBaseUrl', () => {
  it('prefers explicit config.baseUrl', () => {
    expect(resolveDefiLlamaBaseUrl({ baseUrl: 'https://api.llama.fi/' })).toBe(
      'https://api.llama.fi',
    );
  });

  it('uses store.endpoint + llama proxy path by default', () => {
    setStore('endpoint', 'https://axis.hoox.sh');
    expect(resolveDefiLlamaBaseUrl()).toBe(
      `https://axis.hoox.sh${ONCHAIN_LLAMA_PROXY_PATH}`,
    );
    expect(isWorkerLlamaProxy(resolveDefiLlamaBaseUrl())).toBe(true);
  });

  it('falls back to public llama API when endpoint empty', () => {
    setStore('endpoint', '');
    expect(resolveDefiLlamaBaseUrl()).toBe(DEFILLAMA_DEFAULT_BASE);
    expect(isWorkerLlamaProxy(DEFILLAMA_DEFAULT_BASE)).toBe(false);
  });
});
