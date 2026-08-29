// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Built-in **local** storage plugin for user Pine scripts.
 *
 * ## Backends (priority)
 * 1. IndexedDB (`pynescript.axis.storage`) — scripts + KV (drafts) + results
 * 2. localStorage JSON blob — when IDB unavailable
 * 3. In-memory Map — tests / SSR
 *
 * One-shot migration imports older library/draft localStorage keys into IDB.
 * Drafts also mirror to `pynescript.axis.editor.doc` for the editor bridge.
 *
 * ## Schema versions
 *
 * | Version | Change |
 * |---------|--------|
 * | 1 | `scripts` (keyPath `id`) + `kv` stores |
 * | 2 | adds `results` store (out-of-line `[scriptId, runId]` keys) with `byScript` index on `meta.scriptId` for cheap per-script listing. FIFO trim keeps at most {@link MAX_RESULTS_PER_SCRIPT} runs per script. |
 *
 * The version is exposed as {@link LOCAL_STORAGE_VERSION}. Migration is purely
 * additive — older stores (`scripts`, `kv`) are never recreated.
 */

import type {
  ResultMeta,
  ScriptDocument,
  ScriptMeta,
  StoragePlugin,
  StorageStatus,
  StoredRunResult,
} from '../plugins/types';
import { metaFromScriptContent } from '../indicators/script-meta';
import { idbAvailable, idbReq, idbTxDone, openDb } from './idb';

const DB_NAME = 'pynescript.axis.storage';
/**
 * IndexedDB schema version for the local storage plugin.
 *
 * Bumped to `2` to add the `results` object store for persisted run results
 * (see {@link LOCAL_STORAGE_VERSION}). Migration is purely additive — existing
 * `scripts` and `kv` stores and their records are never touched.
 */
const DB_VERSION = 2;
const STORE_SCRIPTS = 'scripts';
const STORE_KV = 'kv';
const STORE_RESULTS = 'results';
/** Index on `meta.scriptId` for cheap per-script listing. */
const IDX_BY_SCRIPT = 'byScript';

const LS_LIBRARY = 'pynescript.axis.library.v1';
const LS_DRAFT = 'pynescript.axis.library.draft';
const LS_MIGRATED = 'pynescript.axis.library.migrated';
const LS_RESULTS = 'pynescript.axis.results.v1';

/**
 * Schema version exported for consumers that want to detect / migrate.
 *
 * Bumped in lockstep with {@link DB_VERSION}. Cloud/git plugins can read this
 * to decide whether to ignore the results store when running alongside the
 * `local` backend in a shared IDB context.
 */
export const LOCAL_STORAGE_VERSION = 2;

/**
 * FIFO cap on persisted runs per `scriptId` for the local storage plugin.
 * Oldest entries (by `meta.startedAt`) are evicted when exceeded.
 */
export const MAX_RESULTS_PER_SCRIPT = 50;

const LEGACY_LIBRARY_KEYS = [
  'pynescript.axis.library.legacy',
] as const;

const LEGACY_DRAFT_KEYS = [
  'pynescript.axis.editor.doc',
] as const;

type KvValue =
  | string
  | ScriptDocument
  | ScriptMeta[]
  | boolean
  | null
  | { content: string; name: string };

/** In-memory fallback when neither IDB nor localStorage exist (tests / SSR). */
const memLibrary = new Map<string, ScriptDocument>();
const memKv = new Map<string, KvValue>();
/**
 * In-memory mirror of the `results` store for the localStorage / SSR paths.
 * Layout: `scriptId → (runId → StoredRunResult)`. Lazily rehydrated from
 * `LS_RESULTS` on first read via {@link ensureMemResults}.
 */
const memResults = new Map<string, Map<string, StoredRunResult>>();

let dbPromise: Promise<IDBDatabase> | null = null;
let migrated = false;
let memResultsLoaded = false;

function lsGet(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  } catch {
    /* quota / private mode */
  }
}

function lsRemove(key: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function newId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function toMeta(doc: ScriptDocument): ScriptMeta {
  const { content, ...meta } = doc;
  // Always re-derive from body when present so old library entries get kind/version
  const derived = metaFromScriptContent(content, {
    scriptKind: meta.scriptKind,
    pineVersion: meta.pineVersion,
  });
  return {
    ...meta,
    scriptKind: derived.scriptKind,
    pineVersion: derived.pineVersion,
  };
}

function normalizeDoc(raw: Partial<ScriptDocument> & { script?: string }): ScriptDocument {
  const now = Date.now();
  const content = String(raw.content ?? raw.script ?? '');
  const derived = metaFromScriptContent(content, {
    scriptKind: raw.scriptKind,
    pineVersion: raw.pineVersion,
  });
  return {
    id: raw.id || newId(),
    name: raw.name || 'Untitled',
    description: raw.description,
    path: raw.path,
    content,
    updatedAt: raw.updatedAt || now,
    createdAt: raw.createdAt || now,
    revision: raw.revision || `local-${now}`,
    tags: raw.tags,
    scriptKind: derived.scriptKind,
    pineVersion: derived.pineVersion,
  };
}

async function getDb(): Promise<IDBDatabase | null> {
  if (!idbAvailable()) return null;
  if (!dbPromise) {
    dbPromise = openDb(DB_NAME, DB_VERSION, (db, oldVersion) => {
      // v1 — initial schema. Branch only on `oldVersion < 1` so users
      // coming from a pre-v1 install get the original two stores; users
      // upgrading v1 → v2 keep their existing data untouched.
      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains(STORE_SCRIPTS)) {
          db.createObjectStore(STORE_SCRIPTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_KV)) {
          db.createObjectStore(STORE_KV);
        }
      }
      // v2 — additive: new `results` store for persisted run results.
      // Out-of-line compound `[scriptId, runId]` keys + a `byScript` index
      // on `meta.scriptId` so `listResults(scriptId)` is a single index
      // range scan. Never touches existing `scripts` / `kv` stores.
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(STORE_RESULTS)) {
          const rstore = db.createObjectStore(STORE_RESULTS);
          if (!rstore.indexNames.contains(IDX_BY_SCRIPT)) {
            rstore.createIndex(IDX_BY_SCRIPT, 'meta.scriptId', { unique: false });
          }
        }
      }
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  try {
    return await dbPromise;
  } catch {
    return null;
  }
}

// --- localStorage fallback ---

function lsReadLibrary(): ScriptDocument[] {
  const raw = lsGet(LS_LIBRARY);
  if (!raw) {
    if (memLibrary.size) return [...memLibrary.values()].map((d) => normalizeDoc(d));
    return [];
  }
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((x: Partial<ScriptDocument>) => normalizeDoc(x));
  } catch {
    return [];
  }
}

function lsWriteLibrary(docs: ScriptDocument[]) {
  memLibrary.clear();
  for (const d of docs) memLibrary.set(d.id, d);
  lsSet(LS_LIBRARY, JSON.stringify(docs));
}

// --- IDB ops ---

async function idbList(): Promise<ScriptDocument[]> {
  const db = await getDb();
  if (!db) return lsReadLibrary();
  const tx = db.transaction(STORE_SCRIPTS, 'readonly');
  const store = tx.objectStore(STORE_SCRIPTS);
  const all = await idbReq(store.getAll() as IDBRequest<ScriptDocument[]>);
  await idbTxDone(tx);
  return (all || []).map((d) => normalizeDoc(d));
}

async function idbGet(id: string): Promise<ScriptDocument | undefined> {
  const db = await getDb();
  if (!db) return lsReadLibrary().find((d) => d.id === id);
  const tx = db.transaction(STORE_SCRIPTS, 'readonly');
  const doc = await idbReq(tx.objectStore(STORE_SCRIPTS).get(id) as IDBRequest<ScriptDocument | undefined>);
  await idbTxDone(tx);
  return doc ? normalizeDoc(doc) : undefined;
}

async function idbPut(doc: ScriptDocument): Promise<void> {
  const db = await getDb();
  if (!db) {
    const lib = lsReadLibrary().filter((d) => d.id !== doc.id);
    lib.push(doc);
    lsWriteLibrary(lib);
    return;
  }
  const tx = db.transaction(STORE_SCRIPTS, 'readwrite');
  tx.objectStore(STORE_SCRIPTS).put(doc);
  await idbTxDone(tx);
}

async function idbDelete(id: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    lsWriteLibrary(lsReadLibrary().filter((d) => d.id !== id));
    return;
  }
  const tx = db.transaction(STORE_SCRIPTS, 'readwrite');
  tx.objectStore(STORE_SCRIPTS).delete(id);
  await idbTxDone(tx);
}

async function idbKvGet(key: string): Promise<KvValue> {
  const db = await getDb();
  if (!db) {
    if (memKv.has(key)) return memKv.get(key) ?? null;
    const raw = lsGet(`${LS_DRAFT}:${key}`);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as KvValue;
    } catch {
      return raw;
    }
  }
  const tx = db.transaction(STORE_KV, 'readonly');
  const v = await idbReq(tx.objectStore(STORE_KV).get(key) as IDBRequest<KvValue>);
  await idbTxDone(tx);
  return v ?? null;
}

async function idbKvSet(key: string, value: KvValue): Promise<void> {
  const db = await getDb();
  if (!db) {
    memKv.set(key, value);
    lsSet(`${LS_DRAFT}:${key}`, JSON.stringify(value));
    return;
  }
  const tx = db.transaction(STORE_KV, 'readwrite');
  tx.objectStore(STORE_KV).put(value, key);
  await idbTxDone(tx);
}

// --- Results (localStorage / in-memory fallback) ---

/** On-disk shape of `LS_RESULTS`: `{ [scriptId]: { [runId]: StoredRunResult } }`. */
type LsResultsShape = Record<string, Record<string, StoredRunResult>>;

/** Lazy rehydrate of {@link memResults} from the localStorage JSON blob. */
function ensureMemResults(): void {
  if (memResultsLoaded) return;
  memResultsLoaded = true;
  const raw = lsGet(LS_RESULTS);
  if (!raw) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== 'object') return;
  for (const [scriptId, bucket] of Object.entries(parsed as LsResultsShape)) {
    if (!bucket || typeof bucket !== 'object') continue;
    const m = new Map<string, StoredRunResult>();
    for (const [runId, item] of Object.entries(bucket)) {
      if (item && typeof item === 'object' && 'meta' in item && 'result' in item) {
        m.set(runId, item as StoredRunResult);
      }
    }
    if (m.size) memResults.set(scriptId, m);
  }
}

/** Flush the in-memory results mirror back to localStorage (best-effort). */
function flushMemResults(): void {
  const out: LsResultsShape = {};
  for (const [scriptId, bucket] of memResults.entries()) {
    out[scriptId] = Object.fromEntries(bucket);
  }
  lsSet(LS_RESULTS, JSON.stringify(out));
}

/**
 * Trim a per-script bucket down to {@link MAX_RESULTS_PER_SCRIPT} entries,
 * evicting oldest by `meta.startedAt`. The `protectedRunId` (the run we just
 * saved) is never removed even when it happens to be the oldest entry by ts.
 */
function trimBucketToCap(
  bucket: Map<string, StoredRunResult>,
  protectedRunId: string,
): void {
  if (bucket.size <= MAX_RESULTS_PER_SCRIPT) return;
  const entries = [...bucket.entries()].sort(
    (a, b) => (a[1].meta.startedAt || 0) - (b[1].meta.startedAt || 0),
  );
  const over = bucket.size - MAX_RESULTS_PER_SCRIPT;
  for (let i = 0; i < over; i++) {
    const [runId] = entries[i];
    if (runId !== protectedRunId) bucket.delete(runId);
  }
}

function memSaveResult(stored: StoredRunResult): void {
  ensureMemResults();
  const { scriptId, runId } = stored.meta;
  let bucket = memResults.get(scriptId);
  if (!bucket) {
    bucket = new Map();
    memResults.set(scriptId, bucket);
  }
  // Idempotent overwrite on (scriptId, runId).
  bucket.set(runId, stored);
  trimBucketToCap(bucket, runId);
  flushMemResults();
}

function memLoadResult(scriptId: string, runId: string): StoredRunResult | null {
  ensureMemResults();
  return memResults.get(scriptId)?.get(runId) ?? null;
}

function memListResults(scriptId: string): ResultMeta[] {
  ensureMemResults();
  const bucket = memResults.get(scriptId);
  if (!bucket) return [];
  return [...bucket.values()]
    .map((r) => r.meta)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

function memRemoveResult(scriptId: string, runId: string): void {
  ensureMemResults();
  const bucket = memResults.get(scriptId);
  if (!bucket) return;
  bucket.delete(runId);
  if (bucket.size === 0) memResults.delete(scriptId);
  flushMemResults();
}

// --- Results (IDB) ---

/**
 * Persist a run result and FIFO-trim to {@link MAX_RESULTS_PER_SCRIPT}.
 * `put` on the compound key `[scriptId, runId]` makes this idempotent for
 * repeated saves of the same run.
 */
async function idbSaveResult(stored: StoredRunResult): Promise<void> {
  const db = await getDb();
  if (!db) return memSaveResult(stored);
  const tx = db.transaction(STORE_RESULTS, 'readwrite');
  const store = tx.objectStore(STORE_RESULTS);
  const { scriptId, runId } = stored.meta;
  store.put({ meta: stored.meta, result: stored.result }, [scriptId, runId]);
  // FIFO trim within the same transaction so the write + trim are atomic.
  const idx = store.index(IDX_BY_SCRIPT);
  const all =
    (await idbReq(idx.getAll(IDBKeyRange.only(scriptId)) as IDBRequest<StoredRunResult[]>)) || [];
  if (all.length > MAX_RESULTS_PER_SCRIPT) {
    all.sort((a, b) => (a.meta.startedAt || 0) - (b.meta.startedAt || 0));
    const over = all.length - MAX_RESULTS_PER_SCRIPT;
    for (let i = 0; i < over; i++) {
      const item = all[i];
      // Never evict the run we just saved, even when its startedAt is older.
      if (item.meta.runId !== runId) {
        store.delete([item.meta.scriptId, item.meta.runId]);
      }
    }
  }
  await idbTxDone(tx);
}

async function idbLoadResult(scriptId: string, runId: string): Promise<StoredRunResult | null> {
  const db = await getDb();
  if (!db) return memLoadResult(scriptId, runId);
  const tx = db.transaction(STORE_RESULTS, 'readonly');
  const v = await idbReq(
    tx.objectStore(STORE_RESULTS).get([scriptId, runId]) as IDBRequest<StoredRunResult | undefined>,
  );
  await idbTxDone(tx);
  return v ?? null;
}

async function idbListResults(scriptId: string): Promise<ResultMeta[]> {
  const db = await getDb();
  if (!db) return memListResults(scriptId);
  const tx = db.transaction(STORE_RESULTS, 'readonly');
  const idx = tx.objectStore(STORE_RESULTS).index(IDX_BY_SCRIPT);
  const all =
    (await idbReq(idx.getAll(IDBKeyRange.only(scriptId)) as IDBRequest<StoredRunResult[]>)) || [];
  await idbTxDone(tx);
  return all
    .map((r) => r.meta)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

async function idbRemoveResult(scriptId: string, runId: string): Promise<void> {
  const db = await getDb();
  if (!db) return memRemoveResult(scriptId, runId);
  const tx = db.transaction(STORE_RESULTS, 'readwrite');
  tx.objectStore(STORE_RESULTS).delete([scriptId, runId]);
  await idbTxDone(tx);
}

// --- Migration ---

async function migrateOnce(): Promise<void> {
  if (migrated) return;
  migrated = true;

  const already = lsGet(LS_MIGRATED) === '1';
  const flag = await idbKvGet('migratedLibrary');
  if (already || flag === true) return;

  const existing = await idbList();
  const have = new Set(existing.map((d) => d.id));
  let imported = 0;

  for (const key of LEGACY_LIBRARY_KEYS) {
    try {
      const raw = lsGet(key);
      if (!raw) continue;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        const doc = normalizeDoc(item);
        if (have.has(doc.id)) continue;
        await idbPut(doc);
        have.add(doc.id);
        imported++;
      }
    } catch {
      /* ignore bad legacy */
    }
  }

  // Draft from editor doc keys if no draft yet
  const draft = await idbKvGet('draft');
  if (!draft) {
    for (const key of LEGACY_DRAFT_KEYS) {
      const content = lsGet(key);
      if (content && content.trim()) {
        await idbKvSet('draft', { content, name: 'Draft' });
        break;
      }
    }
  }

  lsSet(LS_MIGRATED, '1');
  await idbKvSet('migratedLibrary', true);
  if (imported > 0) {
    console.info(`[storage-local] migrated ${imported} script(s) from legacy keys`);
  }
}

/** @internal Reset migration flag (tests). */
export function _resetLocalMigrationFlag() {
  migrated = false;
}

/**
 * Local browser storage plugin (`id: local`).
 * Implements list/read/write/remove, drafts, persisted run results, and
 * getStatus. The four `*Result` methods are the local-plugin counterparts to
 * the optional `StoragePlugin` extension; cloud/git backends may omit them.
 */
export const localStoragePlugin: StoragePlugin = {
  id: 'local',
  name: 'Local (this browser)',
  kind: 'storage',
  builtIn: true,
  description:
    'Stores your Pine scripts in this browser (IndexedDB, with localStorage fallback). Works offline.',
  capabilities: { offline: true, results: true },
  configSchema: {
    namespace: { type: 'string', default: 'default', label: 'Namespace (advanced)' },
  },

  async list(opts) {
    await migrateOnce();
    let docs = await idbList();
    const prefix = opts?.prefix;
    if (prefix) {
      docs = docs.filter(
        (d) => d.name.startsWith(prefix) || (d.path && d.path.startsWith(prefix)),
      );
    }
    docs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return docs.map(toMeta);
  },

  async read(id) {
    await migrateOnce();
    const doc = await idbGet(id);
    if (!doc) throw new Error(`Script not found: ${id}`);
    return doc;
  },

  async write(doc) {
    await migrateOnce();
    const now = Date.now();
    const prev = doc.id ? await idbGet(doc.id).catch(() => undefined) : undefined;
    const next = normalizeDoc({
      ...doc,
      id: doc.id || newId(),
      createdAt: prev?.createdAt || doc.createdAt || now,
      updatedAt: now,
      revision: `local-${now}`,
    });
    await idbPut(next);
    return toMeta(next);
  },

  async remove(id) {
    await migrateOnce();
    await idbDelete(id);
  },

  async saveDraft(doc) {
    await migrateOnce();
    await idbKvSet('draft', {
      content: doc.content ?? '',
      name: doc.name || 'Draft',
    });
    // Mirror to legacy editor doc key for bridge / late joiners
    lsSet('pynescript.axis.editor.doc', doc.content ?? '');
  },

  async loadDraft() {
    await migrateOnce();
    const v = await idbKvGet('draft');
    if (v && typeof v === 'object' && v !== null && 'content' in (v as object)) {
      const d = v as { content: string; name?: string };
      return { content: String(d.content ?? ''), name: d.name };
    }
    if (typeof v === 'string') return { content: v, name: 'Draft' };
    // Fallback editor key
    const content = lsGet('pynescript.axis.editor.doc');
    if (content) return { content, name: 'Draft' };
    return null;
  },

  /**
   * Persist a completed strategy/indicator run keyed by `(meta.scriptId, meta.runId)`.
   * Idempotent — re-saving with the same ids overwrites the prior record.
   * Trims the per-script bucket to {@link MAX_RESULTS_PER_SCRIPT} (FIFO by
   * `meta.startedAt`). Throws on IDB quota / serialization failure so callers
   * can decide whether to surface the error.
   */
  async saveResult(stored, _config) {
    await migrateOnce();
    await idbSaveResult(stored);
  },

  /**
   * Load a previously saved run. Returns `null` when missing (not an error).
   */
  async loadResult(scriptId, runId, _config) {
    await migrateOnce();
    return idbLoadResult(scriptId, runId);
  },

  /**
   * List saved runs for a script, newest first. Returns just the meta rows
   * — callers call `loadResult` if they need the full `RunResult` body.
   */
  async listResults(scriptId, _config) {
    await migrateOnce();
    return idbListResults(scriptId);
  },

  /**
   * Delete a saved run. Silently no-ops when the run is absent (idempotent).
   */
  async removeResult(scriptId, runId, _config) {
    await migrateOnce();
    await idbRemoveResult(scriptId, runId);
  },

  async getStatus(): Promise<StorageStatus> {
    const offline = true;
    return {
      connected: true,
      dirty: false,
      remote: idbAvailable() ? 'indexedDB' : 'localStorage',
      branch: undefined,
      lastSyncAt: Date.now(),
      error: offline ? undefined : undefined,
    };
  },
};

/**
 * Test helper: wipe library + results (localStorage path + flag + IDB stores).
 * Also clears the cached `dbPromise` so the next access picks up the bumped
 * schema version.
 */
export async function _clearLocalLibraryForTests() {
  migrated = false;
  memResultsLoaded = false;
  memLibrary.clear();
  memKv.clear();
  memResults.clear();
  lsRemove(LS_LIBRARY);
  lsRemove(LS_MIGRATED);
  lsRemove(`${LS_DRAFT}:draft`);
  lsRemove(`${LS_DRAFT}:migratedLibrary`);
  lsRemove(LS_RESULTS);
  const db = await getDb();
  if (db) {
    const tx = db.transaction([STORE_SCRIPTS, STORE_KV, STORE_RESULTS], 'readwrite');
    tx.objectStore(STORE_SCRIPTS).clear();
    tx.objectStore(STORE_KV).clear();
    tx.objectStore(STORE_RESULTS).clear();
    await idbTxDone(tx);
  }
}

/**
 * Test helper: read-only view of the in-memory results mirror. Lets suites
 * assert FIFO trim and idempotent overwrite behavior without going through
 * the IDB / localStorage paths.
 */
export function _getMemResultsForTests(): ReadonlyMap<string, ReadonlyMap<string, StoredRunResult>> {
  return memResults;
}
