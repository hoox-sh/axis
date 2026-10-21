// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Collections with a hard size cap.
 *
 * Several modules keep a module-level map that grows with the number of
 * distinct keys a session touches — an engine endpoint, a symbol, a series id.
 * Those maps used to grow without bound, so a long session (or a script that
 * churns keys) leaked a socket, a timer or a memo per key.
 *
 * The cap evicts the **oldest** entry in insertion order. Reading an entry
 * does not refresh its order — only writing it does — so the cap bounds the
 * number of *distinct keys* a module remembers rather than how often they are
 * used.
 *
 * @module utils/bounded-map
 */

/** Options for {@link BoundedMap}. */
export interface BoundedMapOptions<K, V> {
  /**
   * Called for an entry dropped by the cap.
   *
   * Use it to release whatever the entry held — close a socket, clear a
   * timer, flush a pending write. The entry is already out of the map when
   * this runs.
   */
  onEvict?: (key: K, value: V | undefined) => void;
}

/** A `Map` with a hard size cap. */
export class BoundedMap<K, V> {
  private readonly items = new Map<K, V>();
  private readonly max: number;
  private readonly onEvict: ((key: K, value: V | undefined) => void) | undefined;

  constructor(max: number, opts: BoundedMapOptions<K, V> = {}) {
    this.max = Math.max(1, Math.floor(max));
    this.onEvict = opts.onEvict;
  }

  get size(): number {
    return this.items.size;
  }

  get(key: K): V | undefined {
    return this.items.get(key);
  }

  has(key: K): boolean {
    return this.items.has(key);
  }

  delete(key: K): boolean {
    return this.items.delete(key);
  }

  clear(): void {
    this.items.clear();
  }

  keys(): IterableIterator<K> {
    return this.items.keys();
  }

  values(): IterableIterator<V> {
    return this.items.values();
  }

  entries(): IterableIterator<[K, V]> {
    return this.items.entries();
  }

  forEach(fn: (value: V, key: K) => void): void {
    this.items.forEach((v, k) => {
      fn(v, k);
    });
  }

  /** Store a value, refreshing its order and evicting the oldest entries. */
  set(key: K, value: V): this {
    this.items.delete(key);
    this.items.set(key, value);
    this.trim();
    return this;
  }

  /** Evict the oldest entries until the map is back within the cap. */
  private trim(): void {
    while (this.items.size > this.max) {
      const oldest = this.items.keys().next();
      if (oldest.done) break;
      const key = oldest.value;
      const value = this.items.get(key);
      this.items.delete(key);
      this.onEvict?.(key, value);
    }
  }
}

/** A `Set` with a hard size cap. */
export class BoundedSet<T> {
  private readonly items = new Set<T>();
  private readonly max: number;

  constructor(max: number) {
    this.max = Math.max(1, Math.floor(max));
  }

  get size(): number {
    return this.items.size;
  }

  has(value: T): boolean {
    return this.items.has(value);
  }

  delete(value: T): boolean {
    return this.items.delete(value);
  }

  clear(): void {
    this.items.clear();
  }

  values(): IterableIterator<T> {
    return this.items.values();
  }

  /** Add a value, evicting the oldest entries when the cap is reached. */
  add(value: T): this {
    this.items.add(value);
    this.trim();
    return this;
  }

  private trim(): void {
    while (this.items.size > this.max) {
      const oldest = this.items.values().next();
      if (oldest.done) break;
      this.items.delete(oldest.value);
    }
  }
}
