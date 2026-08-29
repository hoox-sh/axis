/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * High-level `storage/service.ts` result API — `supportsRunResults()`,
 * `saveRunResult`, `loadRunResult`, `listRunResults`, `removeRunResult`.
 *
 * The service is a thin façade over the **active** storage plugin; it must:
 * - delegate to the active plugin when it implements the optional
 *   `saveResult` / `loadResult` / `listResults` / `removeResult` methods;
 * - fall back to the local plugin when the active plugin lacks them (so
 *   git / cloud users still get crash-recovery persistence);
 * - never throw on missing records (returns `null` / `[]`);
 * - never throw on missing method (returns `null` / `[]` / no-op).
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { registry } from '../src/plugins/registry';
import { _resetBootstrapFlag, ensureBuiltins } from '../src/plugins/bootstrap';
import { _resetStorageRegistrationFlag } from '../src/storage/catalog';
import { _resetSourceRegistrationFlag } from '../src/sources/catalog';
import { _resetStreamRegistrationFlag } from '../src/streams/catalog';
import { _resetEngineRegistrationFlag } from '../src/engines/catalog';
import { setActivePlugin, store } from '../src/store';
import {
  loadRunResult,
  listRunResults,
  removeRunResult,
  saveRunResult,
  supportsRunResults,
} from '../src/storage/service';
import {
  localStoragePlugin,
  _clearLocalLibraryForTests,
  _resetLocalMigrationFlag,
} from '../src/storage/local';
import type {
  ResultMeta,
  RunResult,
  ScriptDocument,
  ScriptMeta,
  StoragePlugin,
  StoredRunResult,
} from '../src/plugins/types';

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

const sampleResult = (): RunResult => ({
  status: 'success',
  plots: [1, 2, 3],
  events: [],
});

function makeStored(
  scriptId: string,
  runId: string,
  startedAt: number,
): StoredRunResult {
  const meta: ResultMeta = {
    scriptId,
    runId,
    startedAt,
    durationMs: 42,
    schemaVersion: 1,
  };
  return { meta, result: sampleResult() };
}

/**
 * Storage plugin stub that satisfies the `StoragePlugin` contract but does
 * NOT implement the optional run-result methods (`saveResult`,
 * `loadResult`, `listResults`, `removeResult`). Used to exercise the
 * service-layer "fallback to local" branch.
 */
function makeStubPlugin(id: string): StoragePlugin {
  return {
    id,
    name: `Stub ${id}`,
    kind: 'storage',
    description: 'Storage stub for service-level tests',
    builtIn: false,
    async list(_opts?: { prefix?: string; config?: Record<string, unknown> }): Promise<ScriptMeta[]> {
      return [];
    },
    async read(_id: string, _config?: Record<string, unknown>): Promise<ScriptDocument> {
      throw new Error('not found');
    },
    async write(
      doc: ScriptDocument,
      _config?: Record<string, unknown>,
    ): Promise<ScriptMeta> {
      return {
        id: doc.id,
        name: doc.name,
        updatedAt: doc.updatedAt,
      };
    },
    async remove(_id: string, _config?: Record<string, unknown>): Promise<void> {
      /* no-op */
    },
    // NOTE: intentionally no saveResult / loadResult / listResults / removeResult
    // so the service layer exercises its fallback path to the local plugin.
  };
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

afterEach(() => {
  // Reset to local so cross-file tests relying on the default aren't polluted.
  setActivePlugin('storage', 'local');
});

describe('storage service — supportsRunResults', () => {
  it('returns true when the active plugin (local) implements saveResult', () => {
    setActivePlugin('storage', 'local');
    expect(supportsRunResults()).toBe(true);
  });

  it('returns false when the active plugin does NOT implement saveResult', () => {
    const stub = makeStubPlugin('stub-no-results');
    registry.registerStorage(stub);
    try {
      setActivePlugin('storage', 'stub-no-results');
      expect(supportsRunResults()).toBe(false);
    } finally {
      setActivePlugin('storage', 'local');
      registry.unregisterStorage('stub-no-results', { allowBuiltIn: true });
    }
  });
});

describe('storage service — saveRunResult', () => {
  it('delegates to the active local plugin when supported', async () => {
    setActivePlugin('storage', 'local');
    const stored = makeStored('main.pine', 'run-a', 1000);
    await saveRunResult(stored);
    const loaded = await loadRunResult('main.pine', 'run-a');
    expect(loaded?.meta.startedAt).toBe(1000);
    expect(loaded?.result.plots).toEqual([1, 2, 3]);
  });

  it('falls back to local when the active plugin lacks saveResult', async () => {
    const stub = makeStubPlugin('stub-fallback');
    registry.registerStorage(stub);
    try {
      setActivePlugin('storage', 'stub-fallback');
      // Active plugin lacks the method, but local implements it
      const stored = makeStored('main.pine', 'run-fb', 2000);
      await saveRunResult(stored);
      // Service must have written to local (not active), so we can read
      // it back from the local plugin directly.
      const loaded = await localStoragePlugin.loadResult!('main.pine', 'run-fb');
      expect(loaded).not.toBeNull();
      expect(loaded?.meta.startedAt).toBe(2000);
    } finally {
      setActivePlugin('storage', 'local');
      registry.unregisterStorage('stub-fallback', { allowBuiltIn: true });
    }
  });
});

describe('storage service — loadRunResult', () => {
  it('returns the saved record from local plugin', async () => {
    await saveRunResult(makeStored('main.pine', 'run-load', 5000));
    const loaded = await loadRunResult('main.pine', 'run-load');
    expect(loaded?.meta.scriptId).toBe('main.pine');
    expect(loaded?.meta.runId).toBe('run-load');
  });

  it('returns null when the record is missing', async () => {
    const loaded = await loadRunResult('never.pine', 'never');
    expect(loaded).toBeNull();
  });

  it('returns null when the active plugin lacks loadResult (no error)', async () => {
    const stub = makeStubPlugin('stub-noload');
    registry.registerStorage(stub);
    try {
      setActivePlugin('storage', 'stub-noload');
      const loaded = await loadRunResult('main.pine', 'run-x');
      expect(loaded).toBeNull();
    } finally {
      setActivePlugin('storage', 'local');
      registry.unregisterStorage('stub-noload', { allowBuiltIn: true });
    }
  });
});

describe('storage service — listRunResults', () => {
  it('returns [] when the active plugin does not implement listResults', async () => {
    const stub = makeStubPlugin('stub-nolist');
    registry.registerStorage(stub);
    try {
      setActivePlugin('storage', 'stub-nolist');
      const list = await listRunResults('main.pine');
      expect(list).toEqual([]);
    } finally {
      setActivePlugin('storage', 'local');
      registry.unregisterStorage('stub-nolist', { allowBuiltIn: true });
    }
  });

  it('returns [] for an empty local store', async () => {
    setActivePlugin('storage', 'local');
    const list = await listRunResults('empty-script.pine');
    expect(list).toEqual([]);
  });

  it('returns metas from the local plugin (newest first)', async () => {
    setActivePlugin('storage', 'local');
    await saveRunResult(makeStored('svc.pine', 'a', 100));
    await saveRunResult(makeStored('svc.pine', 'b', 300));
    await saveRunResult(makeStored('svc.pine', 'c', 200));
    const list = await listRunResults('svc.pine');
    expect(list.map((m) => m.runId)).toEqual(['b', 'c', 'a']);
  });
});

describe('storage service — removeRunResult', () => {
  it('is idempotent — no-op when the run does not exist', async () => {
    await expect(removeRunResult('never.pine', 'never')).resolves.toBeUndefined();
    // Repeat to confirm idempotency on repeated calls
    await expect(removeRunResult('never.pine', 'never')).resolves.toBeUndefined();
  });

  it('removes a record that was previously saved', async () => {
    setActivePlugin('storage', 'local');
    await saveRunResult(makeStored('main.pine', 'run-rm', 7000));
    expect((await loadRunResult('main.pine', 'run-rm'))).not.toBeNull();
    await removeRunResult('main.pine', 'run-rm');
    expect(await loadRunResult('main.pine', 'run-rm')).toBeNull();
  });

  it('does not throw when the active plugin lacks removeResult', async () => {
    const stub = makeStubPlugin('stub-noremove');
    registry.registerStorage(stub);
    try {
      setActivePlugin('storage', 'stub-noremove');
      await expect(removeRunResult('main.pine', 'x')).resolves.toBeUndefined();
    } finally {
      setActivePlugin('storage', 'local');
      registry.unregisterStorage('stub-noremove', { allowBuiltIn: true });
    }
  });
});

describe('storage service — store.activePlugins wiring', () => {
  it('respects setActivePlugin for the storage kind', () => {
    setActivePlugin('storage', 'local');
    expect(store.activePlugins?.storage).toBe('local');
  });
});
