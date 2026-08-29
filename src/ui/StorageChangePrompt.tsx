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
 * Global storage-change dialog host.
 *
 * Mounts a single {@link default StorageChangeDialog} at the app root and
 * drives it from a shared signal exposed by `storage/service.ts`:
 * {@link getPendingStorageChange}. Call sites
 * (ScriptLibraryPanel dropdown, SettingsDialog save, PluginsPage catalog,
 * PluginManager modal) invoke
 * {@link import('../storage/service').promptStorageChange} instead of
 * `setActivePlugin('storage', …)` so the user is prompted to migrate or
 * start fresh before the engine flips.
 *
 * The actual per-script copy is handled inside the dialog (it talks to
 * `getStorage(fromId)` / `getStorage(toId)` directly so the active plugin
 * can stay pinned to `fromId` until the user commits the switch). When the
 * user picks *Migrate* or *Start fresh* this host calls
 * `setActivePlugin('storage', to)` and clears the pending request. On
 * *Cancel* (or backdrop click / Escape) the request is dropped without
 * touching the active plugin.
 *
 * @module ui/StorageChangePrompt
 */

import { Show, type Component } from 'solid-js';
import StorageChangeDialog from './StorageChangeDialog';
import { getStorage } from '../storage/catalog';
import {
  cancelPendingStorageChange,
  getPendingStorageChange,
} from '../storage/service';
import { setActivePlugin } from '../store';

/** Best-effort human label for a storage id (falls back to the id itself). */
function labelFor(id: string): string {
  return getStorage(id)?.name || id || 'unknown';
}

/**
 * Global storage-change prompt. Render once at the app root. The dialog
 * itself stays inert (`open === false`) when no call site has requested a
 * change.
 */
export const StorageChangePrompt: Component = () => {
  return (
    <Show when={getPendingStorageChange()}>
      {(changeAccessor) => {
        // `<Show>`'s function child receives a non-null accessor; we keep the
        // `from` / `to` lookups reactive so the dialog rebinds when a new
        // request supersedes the prior one.
        const from = () => changeAccessor().from;
        const to = () => changeAccessor().to;
        return (
          <StorageChangeDialog
            open
            fromEngineId={from()}
            fromEngineLabel={labelFor(from())}
            toEngineId={to()}
            toEngineLabel={labelFor(to())}
            onConfirm={() => {
              // Dialog has already completed the migration (or the user
              // asked for a clean switch). Commit the engine flip and
              // clear the request so the host re-renders idle.
              const target = to();
              setActivePlugin('storage', target);
              cancelPendingStorageChange();
            }}
            onCancel={() => {
              cancelPendingStorageChange();
            }}
          />
        );
      }}
    </Show>
  );
};

export default StorageChangePrompt;
