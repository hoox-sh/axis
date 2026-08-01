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
 * Pure helpers + thin storage wrappers for editor **git sync** chrome.
 *
 * Pull / push use the active storage plugin via {@link ../storage/service}
 * (git commits on write; local/cloud still “save to library”).
 *
 * @module editor/git-sync
 */

import { store } from '../store';
import type { ScriptDocument, ScriptMeta, StorageStatus, SyncResult } from '../plugins/types';
import {
  getActiveStoragePlugin,
  getStorageStatus,
  listScripts,
  readScript,
  writeScript,
} from '../storage/service';
import { getActiveStorageId } from '../plugins/active';

/** Fields used to render the editor status chip. */
export interface GitStatusMeta {
  /** Active storage plugin id (`local` | `cloud` | `git` | …). */
  storageId?: string;
  /** Whether the active editor tab has unsaved changes. */
  dirty?: boolean;
  /** From {@link StorageStatus.connected}. */
  connected?: boolean;
  branch?: string;
  remote?: string;
  /** Optional count of scripts after a pull/list. */
  count?: number;
  error?: string;
}

/** Result of {@link pullLibrary}. */
export interface PullLibraryResult {
  list: ScriptMeta[];
  status: StorageStatus;
  sync?: SyncResult;
  /** Re-read of the bound library script when `libraryId` was provided. */
  doc?: ScriptDocument;
}

/**
 * Whether the active storage backend is the built-in git plugin.
 * Reads `store.activePlugins.storage` (defaults to local when unset).
 */
export function isGitStorageActive(): boolean {
  return (store.activePlugins?.storage || 'local') === 'git';
}

/**
 * Human-readable status chip: storage id, optional branch/remote, dirty/clean.
 *
 * @example
 * formatGitStatus({ storageId: 'git', dirty: true, branch: 'main' })
 * // → "git · @main · dirty"
 */
export function formatGitStatus(meta: GitStatusMeta = {}): string {
  const storageId = meta.storageId || getActiveStorageId() || 'local';
  const parts: string[] = [storageId];
  if (meta.remote) parts.push(meta.remote);
  if (meta.branch) parts.push(`@${meta.branch}`);
  parts.push(meta.dirty ? 'dirty' : 'clean');
  if (meta.connected === false) parts.push('offline');
  if (typeof meta.count === 'number') parts.push(`${meta.count} script(s)`);
  if (meta.error) parts.push(meta.error);
  return parts.filter(Boolean).join(' · ');
}

/** Active storage plugin id (`local` | `cloud` | `git` | custom). */
export function getEditorStorageId(): string {
  return getActiveStorageId() || store.activePlugins?.storage || 'local';
}

/**
 * Pull / refresh library from active storage.
 * Calls plugin `sync('pull')` when implemented, then lists + status.
 * When `libraryId` is set, re-reads that script for the editor tab.
 */
export async function pullLibrary(libraryId?: string): Promise<PullLibraryResult> {
  const plugin = getActiveStoragePlugin();
  let sync: SyncResult | undefined;
  if (typeof plugin.sync === 'function') {
    try {
      sync = await plugin.sync('pull');
    } catch (e: unknown) {
      sync = {
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }
  const list = await listScripts();
  const status = await getStorageStatus();
  let doc: ScriptDocument | undefined;
  if (libraryId) {
    try {
      doc = await readScript(libraryId);
    } catch {
      /* id may have been deleted remotely */
    }
  }
  return { list, status, sync, doc };
}

/**
 * Push / save the current editor document via {@link writeScript}
 * (git → commit; other backends → library write).
 */
export async function pushScript(input: {
  id?: string;
  name: string;
  content: string;
  description?: string;
  path?: string;
}): Promise<ScriptMeta> {
  return writeScript({
    id: input.id || `s_${Date.now().toString(36)}`,
    name: input.name || 'Untitled',
    content: input.content ?? '',
    description: input.description,
    path: input.path,
  });
}

/**
 * Build status meta for the chip after a pull or on idle.
 */
export function statusMetaFromPull(
  pull: PullLibraryResult,
  dirty: boolean,
  storageId?: string,
): GitStatusMeta {
  return {
    storageId: storageId || getEditorStorageId(),
    dirty,
    connected: pull.status.connected,
    branch: pull.status.branch,
    remote: pull.status.remote,
    count: pull.list.length,
    error: pull.status.error || (pull.sync && !pull.sync.ok ? pull.sync.message : undefined),
  };
}
