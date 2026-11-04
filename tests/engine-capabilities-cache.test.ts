/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Engine capability cache: a failed `/health` probe must not downgrade the last
 * known-good capabilities. `getEngineCapabilities()` caches every resolved
 * value, and `isEngineOwnedLive()` reads that cache synchronously — overwriting
 * it with defaults flips a live chart from engine-owned paint to the calculator
 * path mid-session.
 */
import './setup';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';
import { registry } from '../src/plugins/registry';
import { ensureBuiltins, _resetBootstrapFlag } from '../src/plugins/bootstrap';
import {
  _setCachedEngineCapabilitiesForTests,
  DEFAULT_ENGINE_CAPABILITIES,
  getCachedEngineCapabilities,
  getEngineCapabilities,
} from '../src/engines/catalog';
import { setStore, setActivePlugin } from '../src/store';
import { isEngineOwnedLive } from '../src/engines/ownership';

const OWNED = {
  ...DEFAULT_ENGINE_CAPABILITIES,
  liveModes: ['every-tick', 'bar-close'] as ('every-tick' | 'bar-close')[],
  ownsData: true,
  dataSession: true,
};

let restore: (() => void) | null = null;

beforeEach(() => {
  registry.clear();
  _resetBootstrapFlag();
  ensureBuiltins();
  setStore('endpoint', 'http://pro.test');
  setStore('live', {
    active: false,
    needsRerun: false,
    lastBarTime: 0,
    streamId: 'eo-stream',
    preferAfterLoad: false,
    rerunOn: 'every-tick',
  });
  setActivePlugin('engine', 'server');
  _setCachedEngineCapabilitiesForTests(OWNED);
});

afterEach(() => {
  restore?.();
  restore = null;
  _setCachedEngineCapabilitiesForTests(null);
});

describe('engine capability cache', () => {
  it('keeps the last known-good capabilities when /health fails', async () => {
    restore = mockFetch(async () => jsonResponse({ status: 'error' }, 404));

    const caps = await getEngineCapabilities();
    // Callers get the documented fallback...
    expect(caps.dataSession).toBe(false);
    // ...but the cache (and therefore engine-owned live) is untouched.
    expect(getCachedEngineCapabilities().dataSession).toBe(true);
    expect(isEngineOwnedLive()).toBe(true);
  });

  it('updates the cache on a successful probe', async () => {
    restore = mockFetch(async () =>
      jsonResponse({
        status: 'ok',
        features: { data_session: false, live_modes: ['bar-close'], live_stream: false },
      }),
    );

    const caps = await getEngineCapabilities();
    expect(caps.dataSession).toBe(false);
    expect(getCachedEngineCapabilities().dataSession).toBe(false);
    expect(isEngineOwnedLive()).toBe(false);
  });

  it('treats a non-JSON /health body as a failed probe', async () => {
    restore = mockFetch(async () => new Response('not json', { status: 502 }));
    const caps = await getEngineCapabilities();
    expect(caps.dataSession).toBe(false);
    expect(getCachedEngineCapabilities().dataSession).toBe(true);
    expect(isEngineOwnedLive()).toBe(true);
  });
});
