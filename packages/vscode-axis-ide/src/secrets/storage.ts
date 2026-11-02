// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

import { PRO_KEY_ERROR, SECRET_SLOTS, SECRET_STORE_ERROR, WORKER_KEY_ERROR } from './slots';
import {
  type ValidateResult,
  validateProKey,
  validateWorkerKey,
} from './validate';

/**
 * Minimal SecretStorage surface so Bun unit tests can inject a Map-backed mock
 * without loading the vscode module.
 */
export interface SecretStore {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}

/** In-memory SecretStore for unit tests. */
export function createMemorySecretStore(
  initial?: Iterable<[string, string]>,
): SecretStore & { readonly map: Map<string, string> } {
  const map = new Map<string, string>(initial);
  return {
    map,
    get(key: string): Thenable<string | undefined> {
      return Promise.resolve(map.get(key));
    },
    store(key: string, value: string): Thenable<void> {
      map.set(key, value);
      return Promise.resolve();
    },
    delete(key: string): Thenable<void> {
      map.delete(key);
      return Promise.resolve();
    },
  };
}

function trimOrNull(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  return raw.trim();
}

export class AxisSecretStorage {
  constructor(private readonly store: SecretStore) {}

  /**
   * Store a Worker key, or delete the slot when `raw` trims empty (design empty→delete).
   * Returns `{ ok:true }` with no plaintext key field.
   */
  async setWorkerKey(raw: unknown): Promise<ValidateResult> {
    const v = trimOrNull(raw);
    if (v === null) return { ok: false, error: WORKER_KEY_ERROR };
    try {
      if (!v) {
        await this.store.delete(SECRET_SLOTS.cloudApiKey);
        return { ok: true };
      }
      const checked = validateWorkerKey(v);
      if (!checked.ok) return checked;
      await this.store.store(SECRET_SLOTS.cloudApiKey, v);
      return { ok: true };
    } catch {
      return { ok: false, error: SECRET_STORE_ERROR };
    }
  }

  /**
   * Store a Pro key, or delete the slot when `raw` trims empty.
   * Returns `{ ok:true }` with no plaintext key field.
   */
  async setProKey(raw: unknown): Promise<ValidateResult> {
    const v = trimOrNull(raw);
    if (v === null) return { ok: false, error: PRO_KEY_ERROR };
    try {
      if (!v) {
        await this.store.delete(SECRET_SLOTS.engineServerApiKey);
        return { ok: true };
      }
      const checked = validateProKey(v);
      if (!checked.ok) return checked;
      await this.store.store(SECRET_SLOTS.engineServerApiKey, v);
      return { ok: true };
    } catch {
      return { ok: false, error: SECRET_STORE_ERROR };
    }
  }

  /** Never-throw: returns undefined on missing or store failure. */
  async getWorkerKey(): Promise<string | undefined> {
    try {
      const v = await this.store.get(SECRET_SLOTS.cloudApiKey);
      return typeof v === 'string' && v.length > 0 ? v : undefined;
    } catch {
      return undefined;
    }
  }

  /** Never-throw: returns undefined on missing or store failure. */
  async getProKey(): Promise<string | undefined> {
    try {
      const v = await this.store.get(SECRET_SLOTS.engineServerApiKey);
      return typeof v === 'string' && v.length > 0 ? v : undefined;
    } catch {
      return undefined;
    }
  }

  async clearWorkerKey(): Promise<void> {
    await this.store.delete(SECRET_SLOTS.cloudApiKey);
  }

  async clearProKey(): Promise<void> {
    await this.store.delete(SECRET_SLOTS.engineServerApiKey);
  }

  /** Delete Worker + Pro engine slots only (matches clear-command confirm copy). */
  async clearWorkerAndProKeys(): Promise<void> {
    await Promise.all([
      this.store.delete(SECRET_SLOTS.cloudApiKey),
      this.store.delete(SECRET_SLOTS.engineServerApiKey),
    ]);
  }

  /** Delete every known AXIS secret slot (Worker, Pro, pyne-worker, git PAT). */
  async clearAll(): Promise<void> {
    await Promise.all([
      this.store.delete(SECRET_SLOTS.cloudApiKey),
      this.store.delete(SECRET_SLOTS.engineServerApiKey),
      this.store.delete(SECRET_SLOTS.enginePyneWorkerApiKey),
      this.store.delete(SECRET_SLOTS.gitPat),
    ]);
  }

  /** UI helper — set/missing only; never-throw (delegates to get*). */
  async hasWorkerKey(): Promise<boolean> {
    return (await this.getWorkerKey()) !== undefined;
  }

  /** UI helper — set/missing only; never-throw (delegates to get*). */
  async hasProKey(): Promise<boolean> {
    return (await this.getProKey()) !== undefined;
  }
}
