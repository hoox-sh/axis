/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Idempotent SW registration guards + update/reload helpers (no real browser SW).
 */

import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test';
import {
  registerAxisServiceWorker,
  _resetRegisterAxisServiceWorkerForTests,
  shouldSoftReloadOnControllerChange,
  postSkipWaiting,
  requestWaitingWorkerActivation,
  onWorkerInstalled,
  SKIP_WAITING_MESSAGE,
} from '../src/pwa/register-sw';

describe('shouldSoftReloadOnControllerChange', () => {
  it('never reloads while already refreshing', () => {
    expect(
      shouldSoftReloadOnControllerChange({
        refreshing: true,
        hadControllerAtRegister: true,
        updateActivationRequested: true,
      }),
    ).toBe(false);
  });

  it('skips first-time claim when no prior controller and no update request', () => {
    expect(
      shouldSoftReloadOnControllerChange({
        refreshing: false,
        hadControllerAtRegister: false,
        updateActivationRequested: false,
      }),
    ).toBe(false);
  });

  it('reloads when page was already controlled (update via SW skipWaiting)', () => {
    expect(
      shouldSoftReloadOnControllerChange({
        refreshing: false,
        hadControllerAtRegister: true,
        updateActivationRequested: false,
      }),
    ).toBe(true);
  });

  it('reloads when page requested waiting activation', () => {
    expect(
      shouldSoftReloadOnControllerChange({
        refreshing: false,
        hadControllerAtRegister: false,
        updateActivationRequested: true,
      }),
    ).toBe(true);
  });
});

describe('postSkipWaiting / requestWaitingWorkerActivation', () => {
  it('posts SKIP_WAITING_MESSAGE', () => {
    const postMessage = mock(() => {});
    postSkipWaiting({ postMessage });
    expect(postMessage).toHaveBeenCalledWith(SKIP_WAITING_MESSAGE);
  });

  it('requestWaitingWorkerActivation posts and enables update path', () => {
    _resetRegisterAxisServiceWorkerForTests();
    const postMessage = mock(() => {});
    requestWaitingWorkerActivation({ postMessage });
    expect(postMessage).toHaveBeenCalledWith(SKIP_WAITING_MESSAGE);
    // After request, soft-reload condition should pass even without prior controller
    expect(
      shouldSoftReloadOnControllerChange({
        refreshing: false,
        hadControllerAtRegister: false,
        updateActivationRequested: true,
      }),
    ).toBe(true);
  });
});

describe('onWorkerInstalled', () => {
  it('activates only when state is installed and registration.waiting exists', () => {
    const waiting = { postMessage: mock(() => {}) };
    const worker = { state: 'installed', postMessage: mock(() => {}) };
    expect(onWorkerInstalled(worker, { waiting })).toBe(true);
    expect(waiting.postMessage).toHaveBeenCalledWith(SKIP_WAITING_MESSAGE);
  });

  it('no-ops when not installed or nothing waiting', () => {
    const waiting = { postMessage: mock(() => {}) };
    expect(
      onWorkerInstalled({ state: 'installing', postMessage: mock(() => {}) }, { waiting }),
    ).toBe(false);
    expect(waiting.postMessage).not.toHaveBeenCalled();

    expect(
      onWorkerInstalled(
        { state: 'installed', postMessage: mock(() => {}) },
        { waiting: null },
      ),
    ).toBe(false);
  });
});

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
    const register = mock(() =>
      Promise.resolve({ waiting: null, addEventListener() {}, update: async () => {} }),
    );
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

  it('no-ops inside Tauri desktop shell', async () => {
    const register = mock(() =>
      Promise.resolve({ waiting: null, addEventListener() {}, update: async () => {} }),
    );
    // @ts-expect-error test stub
    globalThis.window = { __TAURI_INTERNALS__: {} };
    // @ts-expect-error test stub
    globalThis.navigator = { serviceWorker: { register } };
    // @ts-expect-error test stub
    globalThis.location = { protocol: 'https:', hostname: 'tauri.localhost' };

    const reg = await registerAxisServiceWorker();
    expect(reg).toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it('registers once and shares the same promise (no double-register)', async () => {
    const swListeners: Record<string, Array<() => void>> = {};
    const registration = {
      waiting: null as { postMessage: ReturnType<typeof mock> } | null,
      addEventListener: mock(() => {}),
      update: mock(async () => {}),
    };
    const register = mock(() => Promise.resolve(registration));

    // @ts-expect-error test stub
    globalThis.window = {};
    // @ts-expect-error test stub
    globalThis.navigator = {
      serviceWorker: {
        controller: null,
        register,
        addEventListener: mock((type: string, fn: () => void) => {
          (swListeners[type] ??= []).push(fn);
        }),
      },
    };
    // @ts-expect-error test stub
    globalThis.location = {
      protocol: 'https:',
      hostname: 'example.com',
      reload: mock(() => {}),
    };

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

  it('posts SKIP_WAITING only for a waiting worker and reloads once on controllerchange', async () => {
    const waiting = { postMessage: mock(() => {}) };
    const swListeners: Record<string, Array<() => void>> = {};
    const registration = {
      waiting,
      addEventListener: mock(() => {}),
      update: mock(async () => {}),
    };
    const register = mock(() => Promise.resolve(registration));
    const reload = mock(() => {});

    // @ts-expect-error test stub
    globalThis.window = {};
    // @ts-expect-error test stub
    globalThis.navigator = {
      serviceWorker: {
        // no prior controller — first claim would not reload without update request
        controller: null,
        register,
        addEventListener: mock((type: string, fn: () => void) => {
          (swListeners[type] ??= []).push(fn);
        }),
      },
    };
    // @ts-expect-error test stub
    globalThis.location = {
      protocol: 'https:',
      hostname: 'example.com',
      reload,
    };

    await registerAxisServiceWorker();

    expect(waiting.postMessage).toHaveBeenCalledWith(SKIP_WAITING_MESSAGE);

    // Simulate activation after SKIP_WAITING
    for (const fn of swListeners.controllerchange ?? []) fn();
    expect(reload).toHaveBeenCalledTimes(1);

    // Second controllerchange must not reload again
    for (const fn of swListeners.controllerchange ?? []) fn();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads on controllerchange when already controlled even without waiting postMessage', async () => {
    const swListeners: Record<string, Array<() => void>> = {};
    const registration = {
      waiting: null,
      addEventListener: mock(() => {}),
      update: mock(async () => {}),
    };
    const register = mock(() => Promise.resolve(registration));
    const reload = mock(() => {});

    // @ts-expect-error test stub
    globalThis.window = {};
    // @ts-expect-error test stub
    globalThis.navigator = {
      serviceWorker: {
        controller: {}, // already controlled
        register,
        addEventListener: mock((type: string, fn: () => void) => {
          (swListeners[type] ??= []).push(fn);
        }),
      },
    };
    // @ts-expect-error test stub
    globalThis.location = {
      protocol: 'https:',
      hostname: 'example.com',
      reload,
    };

    await registerAxisServiceWorker();

    // SW auto skipWaiting activates a new worker → controllerchange
    for (const fn of swListeners.controllerchange ?? []) fn();
    expect(reload).toHaveBeenCalledTimes(1);

    for (const fn of swListeners.controllerchange ?? []) fn();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload on first-time controllerclaim without update request', async () => {
    const swListeners: Record<string, Array<() => void>> = {};
    const registration = {
      waiting: null,
      addEventListener: mock(() => {}),
      update: mock(async () => {}),
    };
    const register = mock(() => Promise.resolve(registration));
    const reload = mock(() => {});

    // @ts-expect-error test stub
    globalThis.window = {};
    // @ts-expect-error test stub
    globalThis.navigator = {
      serviceWorker: {
        controller: null,
        register,
        addEventListener: mock((type: string, fn: () => void) => {
          (swListeners[type] ??= []).push(fn);
        }),
      },
    };
    // @ts-expect-error test stub
    globalThis.location = {
      protocol: 'https:',
      hostname: 'example.com',
      reload,
    };

    await registerAxisServiceWorker();

    for (const fn of swListeners.controllerchange ?? []) fn();
    expect(reload).not.toHaveBeenCalled();
  });
});
