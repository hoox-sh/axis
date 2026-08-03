/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Idempotent SW registration guards (no real browser SW).
 */

import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test';
import {
  registerAxisServiceWorker,
  _resetRegisterAxisServiceWorkerForTests,
} from '../src/pwa/register-sw';

describe('registerAxisServiceWorker', () => {
  const originalNavigator = globalThis.navigator;
  const originalWindow = globalThis.window;
  const originalLocation = globalThis.location;

  beforeEach(() => {
    _resetRegisterAxisServiceWorkerForTests();
  });

  afterEach(() => {
    _resetRegisterAxisServiceWorkerForTests();
    // @ts-expect-error restore
    globalThis.navigator = originalNavigator;
    // @ts-expect-error restore
    globalThis.window = originalWindow;
    // @ts-expect-error restore
    globalThis.location = originalLocation;
  });

  it('no-ops when serviceWorker is missing', async () => {
    // @ts-expect-error test stub
    globalThis.window = { __AXIS_SW_REGISTERED__: false };
    // @ts-expect-error test stub
    globalThis.navigator = {};
    // @ts-expect-error test stub
    globalThis.location = { protocol: 'https:', hostname: 'app.example' };

    const reg = await registerAxisServiceWorker();
    expect(reg).toBeNull();
  });

  it('no-ops on file: protocol', async () => {
    const register = mock(() => Promise.resolve({ waiting: null, addEventListener() {}, update: async () => {} }));
    // @ts-expect-error test stub
    globalThis.window = {};
    // @ts-expect-error test stub
    globalThis.navigator = { serviceWorker: { register } };
    // @ts-expect-error test stub
    globalThis.location = { protocol: 'file:', hostname: '' };

    const reg = await registerAxisServiceWorker();
    expect(reg).toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it('registers once and shares the same promise (no double-register)', async () => {
    const registration = {
      waiting: null as ServiceWorker | null,
      addEventListener: mock(() => {}),
      update: mock(async () => {}),
    };
    const register = mock(() => Promise.resolve(registration));

    // @ts-expect-error test stub
    globalThis.window = {};
    // @ts-expect-error test stub
    globalThis.navigator = { serviceWorker: { register } };
    // @ts-expect-error test stub
    globalThis.location = { protocol: 'https:', hostname: 'example.com' };

    // Force non-DEV: import.meta.env.DEV may be undefined/false under bun test
    const a = registerAxisServiceWorker();
    const b = registerAxisServiceWorker();
    const [ra, rb] = await Promise.all([a, b]);

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith('/sw.js', {
      scope: './',
      updateViaCache: 'none',
    });
    expect(ra).toBe(registration);
    expect(rb).toBe(registration);
  });
});
