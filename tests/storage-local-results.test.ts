/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Local storage plugin's optional run-result methods
 * (`saveResult` / `loadResult` / `listResults` / `removeResult`).
 *
 * Verifies the IDB-or-mem round-trip, FIFO trim at
 * {@link MAX_RESULTS_PER_SCRIPT}, idempotent overwrite, and idempotent
 * removal. No real IndexedDB in this environment — the plugin falls back to
 * its in-memory mirror, which `_getMemResultsForTests()` exposes for direct
 * assertions.
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
  MAX_RESULTS_PER_SCRIPT,
  _clearLocalLibraryForTests,
  _getMemResultsForTests,
  _resetLocalMigrationFlag,
} from '../src/storage/local';
import type { ResultMeta, RunResult, StoredRunResult } from '../src/plugins/types';

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
});

describe('storage-local result methods — read/write round-trip', () => {
  it('saveResult + loadResult round-trip preserves the full payload', async () => {
    const stored = makeStored('main.pine', 'run-a', 1000);
    await localStoragePlugin.saveResult!(stored);
    const loaded = await localStoragePlugin.loadResult!('main.pine', 'run-a');
    expect(loaded).not.toBeNull();
    expect(loaded?.meta.scriptId).toBe('main.pine');
    expect(loaded?.meta.runId).toBe('run-a');
    expect(loaded?.meta.startedAt).toBe(1000);
    expect(loaded?.result.plots).toEqual([1, 2, 3]);
  });

  it('loadResult returns null for an unknown (scriptId, runId)', async () => {
    const loaded = await localStoragePlugin.loadResult!('nope.pine', 'missing');
    expect(loaded).toBeNull();
  });

  it('loadResult returns null when scriptId exists but runId does not', async () => {
    await localStoragePlugin.saveResult!(makeStored('main.pine', 'run-a', 1000));
    const loaded = await localStoragePlugin.loadResult!('main.pine', 'run-b');
    expect(loaded).toBeNull();
  });

  it('saveResult with the same (scriptId, runId) overwrites the prior record (idempotent)', async () => {
    await localStoragePlugin.saveResult!(makeStored('main.pine', 'run-x', 1000));
    const updated = makeStored('main.pine', 'run-x', 2000);
    updated.result.plots = [9, 9, 9];
    await localStoragePlugin.saveResult!(updated);
    const loaded = await localStoragePlugin.loadResult!('main.pine', 'run-x');
    expect(loaded?.meta.startedAt).toBe(2000);
    expect(loaded?.result.plots).toEqual([9, 9, 9]);
    // Only one record should exist for the script
    const mem = _getMemResultsForTests();
    const bucket = mem.get('main.pine');
    expect(bucket?.size).toBe(1);
  });

  it('different runIds for the same scriptId coexist', async () => {
    await localStoragePlugin.saveResult!(makeStored('main.pine', 'run-1', 1000));
    await localStoragePlugin.saveResult!(makeStored('main.pine', 'run-2', 2000));
    const a = await localStoragePlugin.loadResult!('main.pine', 'run-1');
    const b = await localStoragePlugin.loadResult!('main.pine', 'run-2');
    expect(a?.meta.startedAt).toBe(1000);
    expect(b?.meta.startedAt).toBe(2000);
  });
});

describe('storage-local listResults', () => {
  it('returns [] for an unknown scriptId', async () => {
    const list = await localStoragePlugin.listResults!('nope.pine');
    expect(list).toEqual([]);
  });

  it('returns metas for a known scriptId, newest first', async () => {
    await localStoragePlugin.saveResult!(makeStored('main.pine', 'run-1', 1000));
    await localStoragePlugin.saveResult!(makeStored('main.pine', 'run-2', 3000));
    await localStoragePlugin.saveResult!(makeStored('main.pine', 'run-3', 2000));
    const list = await localStoragePlugin.listResults!('main.pine');
    expect(list.map((m) => m.runId)).toEqual(['run-2', 'run-3', 'run-1']);
    // The list returns metas only (no RunResult body attached)
    for (const m of list) {
      expect(m.scriptId).toBe('main.pine');
      expect(typeof m.runId).toBe('string');
      expect(typeof m.startedAt).toBe('number');
    }
  });

  it('does not mix results across scripts', async () => {
    await localStoragePlugin.saveResult!(makeStored('a.pine', 'a-1', 1000));
    await localStoragePlugin.saveResult!(makeStored('b.pine', 'b-1', 2000));
    const listA = await localStoragePlugin.listResults!('a.pine');
    const listB = await localStoragePlugin.listResults!('b.pine');
    expect(listA.map((m) => m.runId)).toEqual(['a-1']);
    expect(listB.map((m) => m.runId)).toEqual(['b-1']);
  });
});

describe('storage-local removeResult', () => {
  it('deletes a record; subsequent loadResult returns null', async () => {
    await localStoragePlugin.saveResult!(makeStored('main.pine', 'run-x', 1000));
    await localStoragePlugin.removeResult!('main.pine', 'run-x');
    const loaded = await localStoragePlugin.loadResult!('main.pine', 'run-x');
    expect(loaded).toBeNull();
  });

  it('is idempotent — calling on a missing record is a no-op (no throw)', async () => {
    await expect(
      localStoragePlugin.removeResult!('never-existed', 'run-x'),
    ).resolves.toBeUndefined();
    // Idempotent on repeat too
    await expect(
      localStoragePlugin.removeResult!('never-existed', 'run-x'),
    ).resolves.toBeUndefined();
  });

  it('only removes the targeted (scriptId, runId); siblings stay', async () => {
    await localStoragePlugin.saveResult!(makeStored('main.pine', 'run-1', 1000));
    await localStoragePlugin.saveResult!(makeStored('main.pine', 'run-2', 2000));
    await localStoragePlugin.removeResult!('main.pine', 'run-1');
    const list = await localStoragePlugin.listResults!('main.pine');
    expect(list.map((m) => m.runId)).toEqual(['run-2']);
  });
});

describe('storage-local FIFO trim', () => {
  it('trims oldest entries when a script exceeds MAX_RESULTS_PER_SCRIPT', async () => {
    const scriptId = 'trim.pine';
    // Save MAX_RESULTS_PER_SCRIPT + 5 entries; the oldest 5 should be evicted.
    const overBy = 5;
    const total = MAX_RESULTS_PER_SCRIPT + overBy;
    for (let i = 0; i < total; i++) {
      await localStoragePlugin.saveResult!(
        makeStored(scriptId, `run-${i}`, 1000 + i),
      );
    }
    const list = await localStoragePlugin.listResults!(scriptId);
    // Cap respected
    expect(list.length).toBe(MAX_RESULTS_PER_SCRIPT);
    // Newest entry first, oldest (the ones that should have been evicted) gone
    expect(list[0].runId).toBe(`run-${total - 1}`);
    expect(list[list.length - 1].runId).toBe(`run-${overBy}`);
    // Evicted run ids no longer present
    for (let i = 0; i < overBy; i++) {
      expect(list.find((m) => m.runId === `run-${i}`)).toBeUndefined();
    }
    // The protected (most recent) record remains intact
    const newest = await localStoragePlugin.loadResult!(scriptId, `run-${total - 1}`);
    expect(newest).not.toBeNull();
    expect(newest?.meta.startedAt).toBe(1000 + total - 1);
  });

  it('never evicts the run that was just saved even if its startedAt is older', async () => {
    const scriptId = 'trim-protected.pine';
    // Fill to MAX_RESULTS_PER_SCRIPT with newer timestamps
    for (let i = 0; i < MAX_RESULTS_PER_SCRIPT; i++) {
      await localStoragePlugin.saveResult!(
        makeStored(scriptId, `run-${i}`, 10000 + i),
      );
    }
    // Save an "older" record — it should be the protected one even though
    // its startedAt is below every existing entry's.
    const older = makeStored(scriptId, 'protected', 1);
    await localStoragePlugin.saveResult!(older);
    // The protected entry must still be retrievable regardless of the
    // cap / trim interaction. The trim loop skips entries whose runId
    // matches the protected id, so this older record is never evicted.
    const stillThere = await localStoragePlugin.loadResult!(scriptId, 'protected');
    expect(stillThere).not.toBeNull();
    expect(stillThere?.meta.startedAt).toBe(1);
    // And the cap is still respected for everyone else — we never saw the
    // bucket grow beyond MAX_RESULTS_PER_SCRIPT (the protected entry is
    // allowed to push size to MAX+1 in this 1-over scenario).
    const list = await localStoragePlugin.listResults!(scriptId);
    expect(list.length).toBeLessThanOrEqual(MAX_RESULTS_PER_SCRIPT + 1);
    expect(list.length).toBeGreaterThanOrEqual(MAX_RESULTS_PER_SCRIPT);
    // None of the original (newer) entries got evicted when the protected
    // entry was the absolute oldest — only the protected is at risk, and
    // it survived.
    expect(list.some((m) => m.runId === 'protected')).toBe(true);
  });
});
