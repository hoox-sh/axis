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
 * Shared emitter + singleton helpers.
 *
 * Extracted from `theme/manager.ts` and `plugins/registry.ts` which had
 * identical subscribe/emit loops with listener-error swallow.
 *
 * @module utils/emitter
 */

export type Unsubscribe = () => void;

export interface Emitter<TListener extends (...args: never[]) => void> {
  on(listener: TListener): Unsubscribe;
  emit(...args: Parameters<TListener>): void;
  readonly size: number;
}

/** Tiny pub/sub with listener-error isolation. */
export function createEmitter<TListener extends (...args: never[]) => void>(): Emitter<TListener> {
  const listeners = new Set<TListener>();
  return {
    on(listener: TListener): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(...args: Parameters<TListener>): void {
      for (const listener of [...listeners]) {
        try {
          listener(...args);
        } catch {
          /* listener errors must not break emit */
        }
      }
    },
    get size(): number {
      return listeners.size;
    },
  };
}

export interface Singleton<T> {
  get(): T;
  reset(): void;
}

/** Lazy process-wide instance with test reset. */
export function createSingleton<T>(factory: () => T): Singleton<T> {
  let instance: T | null = null;
  return {
    get(): T {
      if (!instance) instance = factory();
      return instance;
    },
    reset(): void {
      instance = null;
    },
  };
}
