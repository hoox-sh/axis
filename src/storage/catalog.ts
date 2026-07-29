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
 * Storage plugin catalog — built-ins (local / cloud / git) + dynamic installs.
 *
 * Lazy-registers into the unified `plugins/registry` on first access so
 * Plugin Manager and `storage/service` share one source of truth.
 */

import type { StoragePlugin } from '../plugins/types';
import { registry } from '../plugins/registry';
import { localStoragePlugin } from './local';
import { cloudStoragePlugin } from './cloud';
import { gitStoragePlugin } from './git';

/** Built-in storage plugins shipped with AXIS. */
export const BUILTIN_STORAGES: StoragePlugin[] = [
  localStoragePlugin,
  cloudStoragePlugin,
  gitStoragePlugin,
];

let registered = false;

/** Idempotent register of built-in storages into the plugin registry. */
export function ensureStoragesRegistered(): void {
  if (registered) return;
  registered = true;
  for (const s of BUILTIN_STORAGES) {
    if (!registry.getStorage(s.id)) {
      registry.registerStorage(s);
    }
  }
}

/** Lookup a storage plugin by id (ensures built-ins are registered). */
export function getStorage(id: string): StoragePlugin | undefined {
  ensureStoragesRegistered();
  return registry.getStorage(id);
}

/** List all registered storage plugins (built-in + dynamic). */
export function listStorages(): StoragePlugin[] {
  ensureStoragesRegistered();
  return registry.listStorages();
}

/**
 * Register a user-loaded storage plugin (must implement list/write at minimum).
 * @throws if id/kind invalid or required methods missing
 */
export function registerDynamicStorage(plugin: StoragePlugin): void {
  ensureStoragesRegistered();
  if (!plugin?.id || plugin.kind !== 'storage') throw new Error('Invalid storage plugin');
  if (typeof plugin.list !== 'function' || typeof plugin.write !== 'function') {
    throw new Error('Storage plugin must implement list/read/write/remove');
  }
  registry.registerStorage({ ...plugin, builtIn: plugin.builtIn ?? false });
}

/** Unregister a dynamic storage plugin; returns whether it was present. */
export function unregisterDynamicStorage(id: string): boolean {
  ensureStoragesRegistered();
  return registry.unregisterStorage(id);
}

/** @internal Test helper — allow re-registration of built-ins. */
export function _resetStorageRegistrationFlag() {
  registered = false;
}
