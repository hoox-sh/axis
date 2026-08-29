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
 * Minimal IndexedDB helpers for AXIS script storage (local plugin).
 * Promise wrappers around IDBRequest / transactions; `idbAvailable` gates SSR/tests.
 *
 * ## Versioned schema upgrades
 *
 * `openDb(name, version, onUpgrade)` calls `onUpgrade(db, oldVersion)` once
 * during `onupgradeneeded`. Implementers MUST branch on `oldVersion` (e.g.
 * `if (oldVersion < 2) { ... }`) so existing object stores / records are
 * preserved across bumps — never recreate a store that already exists
 * (use `objectStoreNames.contains(name)` as a guard). Add new stores /
 * indices inside their own `oldVersion < N` block.
 */

/** True when the browser exposes a usable `indexedDB` global. */
export function idbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

/**
 * Open (or create/upgrade) a named database.
 * @param onUpgrade called with the db and previous version during `onupgradeneeded`
 */
export function openDb(
  name: string,
  version: number,
  onUpgrade: (db: IDBDatabase, oldVersion: number) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!idbAvailable()) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(name, version);
    req.onerror = () => reject(req.error || new Error('IDB open failed'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (ev) => {
      const oldVersion = (ev.target as IDBOpenDBRequest).result
        ? (ev as IDBVersionChangeEvent).oldVersion
        : 0;
      onUpgrade(req.result, oldVersion);
    };
  });
}

/** Convert an IDBRequest into a Promise of its result. */
export function idbReq<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IDB request failed'));
  });
}

/** Resolve when a transaction completes; reject on error/abort. */
export function idbTxDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('IDB transaction aborted'));
  });
}
