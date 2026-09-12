/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Local storage script versioning (git-like snapshots on every write).
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import { registry } from '../src/plugins/registry';
import { _resetBootstrapFlag, ensureBuiltins } from '../src/plugins/bootstrap';
import { _resetStorageRegistrationFlag } from '../src/storage/catalog';
import { _resetSourceRegistrationFlag } from '../src/sources/catalog';
import { _resetStreamRegistrationFlag } from '../src/streams/catalog';
import { _resetEngineRegistrationFlag } from '../src/engines/catalog';
import {
  localStoragePlugin,
  _clearLocalLibraryForTests,
  _resetLocalMigrationFlag,
} from '../src/storage/local';
import { setActivePlugin } from '../src/store';
import {
  listScriptVersions,
  readScriptVersion,
  restoreScriptVersion,
  supportsScriptVersioning,
} from '../src/storage/service';

class MemoryStorage {
  store = new Map<string, string>();
  getItem(k: string) {
    return this.store.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.store.set(k, v);
  }
  removeItem(k: string) {
    this.store.delete(k);
  }
  clear() {
    this.store.clear();
  }
}

beforeEach(async () => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  registry.clear();
  _resetSourceRegistrationFlag();
  _resetStreamRegistrationFlag();
  _resetEngineRegistrationFlag();
  _resetStorageRegistrationFlag();
  _resetBootstrapFlag();
  _resetLocalMigrationFlag();
  await _clearLocalLibraryForTests();
  ensureBuiltins();
  setActivePlugin('storage', 'local');
});

describe('local script versioning', () => {
  it('supports listVersions / readAtRevision', () => {
    expect(typeof localStoragePlugin.listVersions).toBe('function');
    expect(typeof localStoragePlugin.readAtRevision).toBe('function');
    expect(supportsScriptVersioning()).toBe(true);
  });

  it('records a snapshot on each distinct write', async () => {
    await localStoragePlugin.write({
      id: 's_hist',
      name: 'Hist',
      content: 'plot(1)',
      updatedAt: Date.now(),
    });
    await new Promise((r) => setTimeout(r, 2));
    await localStoragePlugin.write({
      id: 's_hist',
      name: 'Hist',
      content: 'plot(2)',
      updatedAt: Date.now(),
    });
    const listFn = localStoragePlugin.listVersions;
    const readFn = localStoragePlugin.readAtRevision;
    expect(listFn).toBeDefined();
    expect(readFn).toBeDefined();
    const vers = (await listFn?.('s_hist')) || [];
    expect(vers.length).toBe(2);
    const oldest = vers[vers.length - 1];
    const newest = vers[0];
    expect(oldest && newest).toBeTruthy();
    const old = await readFn?.('s_hist', oldest?.sha || '');
    expect(old?.content).toBe('plot(1)');
    const latest = await readFn?.('s_hist', newest?.sha || '');
    expect(latest?.content).toBe('plot(2)');
  });

  it('restore writes historical content as the new tip', async () => {
    await localStoragePlugin.write({
      id: 's_rst',
      name: 'Rst',
      content: 'plot(old)',
      updatedAt: Date.now(),
    });
    await new Promise((r) => setTimeout(r, 2));
    await localStoragePlugin.write({
      id: 's_rst',
      name: 'Rst',
      content: 'plot(new)',
      updatedAt: Date.now(),
    });
    const vers = await listScriptVersions('s_rst');
    const oldest = vers[vers.length - 1];
    expect(oldest).toBeDefined();
    await restoreScriptVersion('s_rst', oldest?.sha || '');
    const now = await localStoragePlugin.read('s_rst');
    expect(now.content).toBe('plot(old)');
    const after = await listScriptVersions('s_rst');
    expect(after.length).toBeGreaterThanOrEqual(3);
  });

  it('skips a no-op rewrite', async () => {
    await localStoragePlugin.write({
      id: 's_same',
      name: 'Same',
      content: 'plot(1)',
      updatedAt: Date.now(),
    });
    const n1 = ((await localStoragePlugin.listVersions?.('s_same')) || []).length;
    await localStoragePlugin.write({
      id: 's_same',
      name: 'Same',
      content: 'plot(1)',
      updatedAt: Date.now(),
    });
    const n2 = ((await localStoragePlugin.listVersions?.('s_same')) || []).length;
    expect(n2).toBe(n1);
  });

  it('throws on unknown revision', async () => {
    await expect(readScriptVersion('nope', 'missing')).rejects.toThrow(/not found/i);
  });
});
