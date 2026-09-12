/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * copyScriptsBetweenStorages copies onto the destination and never removes
 * source scripts.
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import { registry } from '../src/plugins/registry';
import { _resetBootstrapFlag, ensureBuiltins } from '../src/plugins/bootstrap';
import {
  _resetStorageRegistrationFlag,
  registerDynamicStorage,
} from '../src/storage/catalog';
import { _resetSourceRegistrationFlag } from '../src/sources/catalog';
import { _resetStreamRegistrationFlag } from '../src/streams/catalog';
import { _resetEngineRegistrationFlag } from '../src/engines/catalog';
import {
  localStoragePlugin,
  _clearLocalLibraryForTests,
  _resetLocalMigrationFlag,
} from '../src/storage/local';
import { copyScriptsBetweenStorages } from '../src/storage/service';
import type { ScriptDocument, ScriptMeta, StoragePlugin } from '../src/plugins/types';

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

const dest = new Map<string, ScriptDocument>();
let destRemoves = 0;
let destWrite: StoragePlugin['write'] = async (doc) => {
  dest.set(doc.id, { ...doc });
  const { content: _c, ...meta } = doc;
  return meta;
};

const destPlugin: StoragePlugin = {
  id: 'mem-dest',
  name: 'Memory dest',
  kind: 'storage',
  async list(): Promise<ScriptMeta[]> {
    return [...dest.values()].map(({ content: _c, ...meta }) => meta);
  },
  async read(id) {
    const d = dest.get(id);
    if (!d) throw new Error(`missing ${id}`);
    return d;
  },
  async write(doc, config) {
    return destWrite(doc, config);
  },
  async remove(id) {
    destRemoves += 1;
    dest.delete(id);
  },
};

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
  dest.clear();
  destRemoves = 0;
  destWrite = async (doc) => {
    dest.set(doc.id, { ...doc });
    const { content: _c, ...meta } = doc;
    return meta;
  };
  ensureBuiltins();
  registerDynamicStorage(destPlugin);
});

describe('copyScriptsBetweenStorages', () => {
  it('copies scripts and leaves the source intact', async () => {
    await localStoragePlugin.write({
      id: 's_keep',
      name: 'Keep me',
      content: 'plot(close)',
      updatedAt: Date.now(),
    });
    await localStoragePlugin.write({
      id: 's_also',
      name: 'Also keep',
      content: 'plot(open)',
      updatedAt: Date.now(),
    });

    const result = await copyScriptsBetweenStorages('local', 'mem-dest');
    expect(result.copied).toBe(2);
    expect(result.failed).toEqual([]);
    expect(result.aborted).toBe(false);

    const src = await localStoragePlugin.list();
    expect(src.map((s) => s.id).sort()).toEqual(['s_also', 's_keep']);
    expect(dest.has('s_keep')).toBe(true);
    expect(dest.get('s_keep')?.content).toBe('plot(close)');
    expect(destRemoves).toBe(0);
  });

  it('never calls remove on the source plugin', async () => {
    let sourceRemoves = 0;
    const orig = localStoragePlugin.remove.bind(localStoragePlugin);
    localStoragePlugin.remove = async (id, cfg) => {
      sourceRemoves += 1;
      return orig(id, cfg);
    };
    await localStoragePlugin.write({
      id: 's_x',
      name: 'X',
      content: 'plot(1)',
      updatedAt: Date.now(),
    });
    await copyScriptsBetweenStorages('local', 'mem-dest');
    expect(sourceRemoves).toBe(0);
    expect(await localStoragePlugin.read('s_x')).toBeDefined();
    localStoragePlugin.remove = orig;
  });

  it('records per-script failures without deleting source', async () => {
    destWrite = async () => {
      throw new Error('dest down');
    };
    await localStoragePlugin.write({
      id: 's_fail',
      name: 'Fail',
      content: 'plot(1)',
      updatedAt: Date.now(),
    });
    const result = await copyScriptsBetweenStorages('local', 'mem-dest');
    expect(result.copied).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toContain('dest down');
    expect((await localStoragePlugin.list()).some((s) => s.id === 's_fail')).toBe(true);
  });
});
