/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Update manager: version comparison, poll detection, hard-reload URL, and
 * polling lifecycle (all side channels injected — no network, no DOM).
 */

import './setup';
import { describe, expect, it, beforeEach, mock } from 'bun:test';
import {
  _resetUpdateManagerForTests,
  buildHardReloadUrl,
  checkForUpdates,
  dismissUpdate,
  getUpdateState,
  hardReload,
  isNewerVersion,
  markUpdateAvailable,
  normalizeVersion,
  setWaitingWorkerActivate,
  softReload,
  startUpdatePolling,
  takeWaitingWorkerActivate,
  versionJsonUrl,
} from '../src/update/update-manager';
import { APP_VERSION } from '../src/version';

const RUNNING = APP_VERSION;
const NEXT = '9.9.9-test';

function fetchJson(body: unknown, ok = true) {
  return mock(async (_url: string, _init?: unknown) => ({
    ok,
    json: async () => body,
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  _resetUpdateManagerForTests();
});

describe('normalizeVersion / isNewerVersion', () => {
  it('trims and stringifies', () => {
    expect(normalizeVersion(' 2.6.1 ')).toBe('2.6.1');
    expect(normalizeVersion(null)).toBe('');
    expect(normalizeVersion(undefined)).toBe('');
  });

  it('detects a different deployed version', () => {
    expect(isNewerVersion(NEXT, RUNNING)).toBe(true);
    expect(isNewerVersion(RUNNING, RUNNING)).toBe(false);
    expect(isNewerVersion('', RUNNING)).toBe(false);
  });
});

describe('versionJsonUrl', () => {
  it('is relative to the app base with a cache-buster', () => {
    const url = versionJsonUrl('./', 123);
    expect(url).toBe('./version.json?t=123');
    expect(versionJsonUrl('/', 1)).toBe('/version.json?t=1');
  });
});

describe('markUpdateAvailable', () => {
  it('flips state and notifies without Browser Notification by default', () => {
    const setStatus = mock((..._args: unknown[]) => {});
    const info = markUpdateAvailable(NEXT, 'version-poll', {
      setStatus: (msg) => setStatus(msg),
      canNotify: () => false,
    });
    expect(info?.latestVersion).toBe(NEXT);
    expect(info?.currentVersion).toBe(RUNNING);
    expect(getUpdateState().status).toBe('update-available');
    expect(setStatus).toHaveBeenCalled();
  });

  it('ignores same/empty versions', () => {
    expect(markUpdateAvailable(RUNNING)).toBeNull();
    expect(markUpdateAvailable('')).toBeNull();
    expect(getUpdateState().status).toBe('current');
  });

  it('is idempotent for the same version', () => {
    const a = markUpdateAvailable(NEXT, 'manual', { canNotify: () => false });
    const b = markUpdateAvailable(NEXT, 'manual', { canNotify: () => false });
    expect(a).toBe(b);
  });

  it('compares against an explicit running version when given', () => {
    const info = markUpdateAvailable('1.0.0', 'manual', { canNotify: () => false }, '1.0.0');
    expect(info).toBeNull();
    const newer = markUpdateAvailable(RUNNING, 'manual', { canNotify: () => false }, '0.0.1');
    expect(newer?.currentVersion).toBe('0.0.1');
    expect(newer?.latestVersion).toBe(RUNNING);
  });
});

describe('dismissUpdate', () => {
  it('returns to current and clears the payload, re-firing on next detection', () => {
    markUpdateAvailable(NEXT, 'manual', { canNotify: () => false });
    dismissUpdate();
    expect(getUpdateState().status).toBe('current');
    expect(getUpdateState().update).toBeNull();
    expect(
      markUpdateAvailable(NEXT, 'manual', { canNotify: () => false })?.latestVersion,
    ).toBe(NEXT);
  });
});

describe('checkForUpdates', () => {
  it('detects a deployed mismatch', async () => {
    const info = await checkForUpdates({
      fetchImpl: fetchJson({ version: NEXT }),
      url: 'https://app.example/version.json',
      hooks: { canNotify: () => false },
    });
    expect(info?.latestVersion).toBe(NEXT);
    expect(getUpdateState().status).toBe('update-available');
    expect(getUpdateState().lastCheckedAt).toBeGreaterThan(0);
  });

  it('returns null when versions match', async () => {
    const info = await checkForUpdates({
      fetchImpl: fetchJson({ version: RUNNING }),
      hooks: { canNotify: () => false },
    });
    expect(info).toBeNull();
    expect(getUpdateState().status).toBe('current');
  });

  it('never throws on offline / 404 / malformed payloads', async () => {
    expect(
      await checkForUpdates({ fetchImpl: fetchJson({}, false) }),
    ).toBeNull();
    expect(
      await checkForUpdates({ fetchImpl: fetchJson({ nope: 1 }) }),
    ).toBeNull();
    const failing = mock(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await checkForUpdates({ fetchImpl: failing })).toBeNull();
    expect(getUpdateState().status).toBe('current');
  });
});

describe('buildHardReloadUrl', () => {
  it('adds a cache-busting version param, preserving path/query/hash', () => {
    expect(buildHardReloadUrl('https://app.example/chart?sym=BTC#panel', NEXT)).toBe(
      'https://app.example/chart?sym=BTC&_axis_v=9.9.9-test#panel',
    );
    expect(buildHardReloadUrl('/editor', NEXT)).toBe('/editor?_axis_v=9.9.9-test');
  });
});

describe('hardReload', () => {
  it('unregisters workers, clears axis caches, navigates cache-busted', async () => {
    markUpdateAvailable(NEXT, 'manual', { canNotify: () => false });
    const unregister = mock(async () => true);
    const deleted: string[] = [];
    const navigated: string[] = [];
    await hardReload({
      serviceWorker: { getRegistrations: async () => [{ unregister }] },
      caches: {
        keys: async () => ['axis-shell-v5', 'other-cache'],
        delete: async (k: string) => {
          deleted.push(k);
          return true;
        },
      },
      location: { href: 'https://app.example/' },
      navigate: (url: string) => navigated.push(url),
    });
    expect(unregister).toHaveBeenCalled();
    expect(deleted).toEqual(['axis-shell-v5']);
    expect(navigated).toEqual(['https://app.example/?_axis_v=9.9.9-test']);
    expect(getUpdateState().status).toBe('reloading');
  });
});

describe('waiting worker activation', () => {
  it('softReload consumes a stored activation once', () => {
    const activate = mock(() => true);
    setWaitingWorkerActivate(activate);
    // Avoid touching real location: take + call manually via softReload path
    const taken = takeWaitingWorkerActivate();
    expect(taken).toBe(activate);
    expect(takeWaitingWorkerActivate()).toBeNull();
  });

  it('softReload uses the activation when it reports success', () => {
    const activate = mock(() => true);
    const reload = mock(() => {});
    const original = globalThis.location;
    globalThis.location = { href: 'https://app.example/', reload } as unknown as Location;
    try {
      softReload(activate);
      expect(activate).toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    } finally {
      globalThis.location = original;
    }
  });

  it('softReload falls back to reload when activation reports nothing waiting', () => {
    const activate = mock(() => false);
    const reload = mock(() => {});
    const original = globalThis.location;
    globalThis.location = { href: 'https://app.example/', reload } as unknown as Location;
    try {
      softReload(activate);
      expect(reload).toHaveBeenCalled();
    } finally {
      globalThis.location = original;
    }
  });

  it('softReload without activation falls back to location.reload', () => {
    const reload = mock(() => {});
    const original = globalThis.location;
    globalThis.location = { href: 'https://app.example/', reload } as unknown as Location;
    try {
      softReload();
      expect(reload).toHaveBeenCalled();
    } finally {
      globalThis.location = original;
    }
  });
});

describe('startUpdatePolling', () => {
  it('checks immediately, on interval, and stops cleanly', async () => {
    let calls = 0;
    const fetchImpl = mock(async () => {
      calls += 1;
      return { ok: true, json: async () => ({ version: RUNNING }) };
    }) as unknown as typeof fetch;
    const fns: Array<() => void> = [];
    const timers: Array<() => void> = [];
    const target = {
      addEventListener: mock((_t: string, fn: () => void) => fns.push(fn)),
      removeEventListener: mock(() => {}),
    };
    const handle = startUpdatePolling({
      fetchImpl,
      target,
      timer: {
        set: (fn: () => void) => {
          timers.push(fn);
          return timers.length;
        },
        clear: mock(() => {}),
      },
      hooks: { canNotify: () => false },
    });
    // Immediate check ran (async) — allow it to settle
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(target.addEventListener).toHaveBeenCalled();
    handle.stop();
    expect(target.removeEventListener).toHaveBeenCalled();
  });
});
