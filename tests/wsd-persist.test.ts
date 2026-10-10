/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * WS-D persistence hardening: secrets at rest (D1), newly persisted slices
 * (D5), corrupt-key backup discipline (D6), per-section hydrate isolation
 * (D7), field validation/bounds + unknown-key drop (D8), DEFAULTS aliasing
 * (D9), stale popout reset (D11), shared toast gate (D19), schema versioning
 * (D21).
 */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import {
  store,
  setStore,
  flushPersist,
  parsePersistedState,
  backupAndClearCorrupt,
  migratePersistedBag,
  persistedSchemaVersion,
  PERSIST_SCHEMA_VERSION,
  DEFAULTS,
  STORAGE_KEY,
  appendLog,
  clearLogs,
  clearToasts,
  notify,
  DEFAULT_NOTIFICATIONS,
  WATCHLIST_WIDTH_MAX,
} from '../src/store';
import { resolveCloudConfig } from '../src/storage/cloud-config';
import { resolveGitConfig } from '../src/storage/git-config';
import {
  forgetSecret,
  CLOUD_API_KEY_SLOT,
  GIT_TOKEN_SLOT,
} from '../src/storage/vault';

const CLOUD_KEY = 'pn_wsd_test_cloud_key';
const GIT_TOKEN = 'ghp_wsd_test_git_token';

function readPersistedJson(): Record<string, unknown> {
  const raw = localStorage.getItem(STORAGE_KEY);
  expect(raw).toBeTruthy();
  return JSON.parse(raw as string) as Record<string, unknown>;
}

beforeEach(() => {
  clearLogs();
  clearToasts();
  setStore('notifications', {
    ...DEFAULT_NOTIFICATIONS,
    categories: { ...DEFAULT_NOTIFICATIONS.categories },
  });
  forgetSecret(CLOUD_API_KEY_SLOT);
  forgetSecret(GIT_TOKEN_SLOT);
});

describe('D1 — secrets never persist at rest', () => {
  it('strips cloud apiKey + git token from the durable payload, keeps endpoints', () => {
    setStore('pluginsConfig', 'storage:cloud', {
      endpoint: 'https://worker.example',
      apiKey: CLOUD_KEY,
    });
    setStore('pluginsConfig', 'storage:git', {
      provider: 'github',
      owner: 'o',
      repo: 'r',
      token: GIT_TOKEN,
    });
    expect(flushPersist()).toBe(true);
    const persisted = readPersistedJson();
    expect(JSON.stringify(persisted)).not.toContain(CLOUD_KEY);
    expect(JSON.stringify(persisted)).not.toContain(GIT_TOKEN);
    const pc = persisted.pluginsConfig as Record<string, Record<string, unknown>>;
    expect(pc['storage:cloud']?.endpoint).toBe('https://worker.example');
    expect(pc['storage:git']?.owner).toBe('o');
    // Session still works: resolvers serve the vaulted values.
    expect(resolveCloudConfig().apiKey).toBe(CLOUD_KEY);
    expect(resolveGitConfig().token).toBe(GIT_TOKEN);
    // Cleanup so later suites see a clean bag.
    setStore('pluginsConfig', 'storage:cloud', { endpoint: 'https://worker.example' });
    setStore('pluginsConfig', 'storage:git', { provider: 'github', owner: 'o', repo: 'r' });
    expect(flushPersist()).toBe(true);
  });

  it('migrates plaintext secrets from a pre-vault blob into the vault', () => {
    forgetSecret(CLOUD_API_KEY_SLOT);
    const overlay = parsePersistedState(
      JSON.stringify({
        pluginsConfig: { 'storage:cloud': { endpoint: 'https://w.example', apiKey: CLOUD_KEY } },
      }),
    );
    expect(overlay).not.toBeNull();
    expect(resolveCloudConfig().apiKey).toBe(CLOUD_KEY);
  });
});

describe('D5 — topbar / onchain / drawingUi persist + round-trip', () => {
  it('writes the slices and hydrates them back', () => {
    setStore('topbar', 'brand', false);
    setStore('onchain', 'lastProtocolSlug', 'aave');
    setStore('drawingUi', 'magnet', 'strong');
    expect(flushPersist()).toBe(true);
    const persisted = readPersistedJson();
    expect((persisted.topbar as { brand: boolean }).brand).toBe(false);
    expect((persisted.onchain as { lastProtocolSlug: string }).lastProtocolSlug).toBe('aave');
    expect((persisted.drawingUi as { magnet: string }).magnet).toBe('strong');
    const overlay = parsePersistedState(JSON.stringify(persisted));
    expect(overlay?.topbar?.brand).toBe(false);
    expect(overlay?.onchain?.lastProtocolSlug).toBe('aave');
    expect(overlay?.drawingUi?.magnet).toBe('strong');
    // Restore.
    setStore('topbar', 'brand', true);
    setStore('onchain', 'lastProtocolSlug', '');
    setStore('drawingUi', 'magnet', 'off');
    expect(flushPersist()).toBe(true);
  });
});

describe('D6 — corrupt backup discipline', () => {
  it('backs up before clearing, and caps to a single sidecar key', () => {
    localStorage.setItem('wsd.k1', 'first');
    expect(backupAndClearCorrupt('wsd.k1', 'wsd.k1.corrupt')).toBe(true);
    expect(localStorage.getItem('wsd.k1')).toBeNull();
    expect(localStorage.getItem('wsd.k1.corrupt')).toBe('first');
    localStorage.setItem('wsd.k1', 'second');
    expect(backupAndClearCorrupt('wsd.k1', 'wsd.k1.corrupt')).toBe(true);
    // Capped: one sidecar, overwritten — no wsd.k1.corrupt.2 growth.
    expect(localStorage.getItem('wsd.k1.corrupt')).toBe('second');
    localStorage.removeItem('wsd.k1.corrupt');
  });

  it('is a no-op for missing keys', () => {
    localStorage.removeItem('wsd.missing');
    expect(backupAndClearCorrupt('wsd.missing', 'wsd.missing.corrupt')).toBe(true);
    expect(localStorage.getItem('wsd.missing.corrupt')).toBeNull();
  });
});

describe('D7 — one malformed section does not void the blob', () => {
  it('keeps valid sections when chartLayout/panelChrome are garbage', () => {
    const overlay = parsePersistedState(
      JSON.stringify({
        symbol: 'ETHUSDT',
        chartLayout: 42,
        panelChrome: 'nope',
        watchlist: { open: true, width: 300 },
      }),
    );
    expect(overlay).not.toBeNull();
    expect(overlay?.symbol).toBe('ETHUSDT');
    expect(overlay?.watchlist?.open).toBe(true);
    expect(overlay?.chartLayout).toBeTruthy();
    expect(overlay?.panelChrome).toBeTruthy();
  });
});

describe('D8 — validation, bounds, unknown-key drop', () => {
  it('drops unknown keys and coerces out-of-range fields', () => {
    const overlay = parsePersistedState(
      JSON.stringify({
        symbol: '!!! not a symbol !!!',
        interval: 'every-fortnight',
        exchange: 'BINANCE!!!',
        historyBars: 10 ** 12,
        watchlist: { open: true, width: 99999 },
        theme: 'neon',
        evil: 1,
      }),
    ) as unknown as Record<string, unknown>;
    expect(overlay).not.toBeNull();
    expect(overlay.symbol).toBe(DEFAULTS.symbol);
    expect(overlay.interval).toBe(DEFAULTS.interval);
    expect(overlay.exchange).toBe(DEFAULTS.exchange);
    expect(overlay.theme).toBe(DEFAULTS.theme);
    expect(overlay).not.toHaveProperty('evil');
    const watchlist = overlay.watchlist as { width: number };
    expect(watchlist.width).toBeLessThanOrEqual(WATCHLIST_WIDTH_MAX);
  });
});

describe('D9 — seed state never aliases DEFAULTS', () => {
  it('topbar/extras are fresh objects', () => {
    expect(store.topbar).not.toBe(DEFAULTS.topbar);
    expect(store.extras).not.toBe(DEFAULTS.extras);
    expect(store.extras.ticker).not.toBe(DEFAULTS.extras.ticker);
    expect(store.extras.ticker.symbols).not.toBe(DEFAULTS.extras.ticker.symbols);
    const before = DEFAULTS.topbar.brand;
    setStore('topbar', 'brand', !before);
    expect(DEFAULTS.topbar.brand).toBe(before);
    setStore('topbar', 'brand', before);
  });
});

describe('D11 — stale popout resets to docked', () => {
  it('forces editor.mode docked on hydrate', () => {
    const overlay = parsePersistedState(
      JSON.stringify({ editor: { open: true, mode: 'popout', width: 400 } }),
    );
    expect(overlay?.editor?.mode).toBe('docked');
  });
});

describe('D19 — single shared toast gate', () => {
  it('notify and appendLog honor the same category toggle', () => {
    setStore('notifications', {
      ...DEFAULT_NOTIFICATIONS,
      categories: { ...DEFAULT_NOTIFICATIONS.categories, run: false },
    });
    const logsBefore = store.logs.length;
    notify('ok', 'wsd run message', { source: 'run' });
    appendLog('error', 'wsd run error', 'run');
    expect(store.logs.length).toBe(logsBefore + 2);
    expect(store.toasts.length).toBe(0);
    setStore('notifications', {
      ...DEFAULT_NOTIFICATIONS,
      categories: { ...DEFAULT_NOTIFICATIONS.categories },
    });
  });
});

describe('D21 — schema version + migration hook', () => {
  it('writes the current version and reads back', () => {
    expect(flushPersist()).toBe(true);
    const persisted = readPersistedJson();
    expect(persisted.schemaVersion).toBe(PERSIST_SCHEMA_VERSION);
    expect(parsePersistedState(JSON.stringify(persisted))).not.toBeNull();
  });

  it('accepts blobs lacking schemaVersion (legacy v0)', () => {
    const overlay = parsePersistedState(JSON.stringify({ symbol: 'SOLUSDT' }));
    expect(overlay?.symbol).toBe('SOLUSDT');
  });

  it('migration hook passes unknown versions through without throwing', () => {
    const bag = { symbol: 'ETHUSDT' };
    expect(migratePersistedBag(bag, 999)).toBe(bag);
    expect(persistedSchemaVersion({})).toBe(0);
    expect(persistedSchemaVersion(null)).toBe(0);
  });
});
