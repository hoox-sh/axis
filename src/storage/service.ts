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
 * High-level script library API used by UI and editor.
 *
 * Resolves the **active** storage plugin (`activePlugins.storage`); falls back
 * to local. Drafts always dual-write to the local plugin for crash recovery
 * even when git/cloud is selected (remotes typically skip draft commits).
 */

import type {
  ScriptDocument,
  ScriptMeta,
  ScriptVersion,
  StoragePlugin,
  StorageStatus,
} from '../plugins/types';
import { ensureBuiltins } from '../plugins/bootstrap';
import { getActiveStorage, getActiveStorageId } from '../plugins/active';
import { metaFromScriptContent } from '../indicators/script-meta';
import { getStorage } from './catalog';
import { localStoragePlugin } from './local';
import { appendLog } from '../store';

/** Active storage or local fallback; throws only if nothing is available. */
function requireActive(): StoragePlugin {
  ensureBuiltins();
  const p = getActiveStorage() || getStorage('local') || localStoragePlugin;
  if (!p) throw new Error('No storage plugin available');
  return p;
}

/** Always the local plugin (for drafts / crash recovery). */
function localAlways(): StoragePlugin {
  ensureBuiltins();
  return getStorage('local') || localStoragePlugin;
}

/** List script metadata from the active storage (optional name/path prefix). */
export async function listScripts(prefix?: string): Promise<ScriptMeta[]> {
  return requireActive().list({ prefix });
}

/** Read full script document by id from active storage. */
export async function readScript(id: string): Promise<ScriptDocument> {
  return requireActive().read(id);
}

/**
 * Write/create a script on active storage; assigns id and stamps updatedAt.
 * Logs success to the system log strip.
 */
export async function writeScript(
  doc: Omit<ScriptDocument, 'updatedAt' | 'revision'> &
    Partial<Pick<ScriptDocument, 'updatedAt' | 'revision' | 'createdAt'>>,
): Promise<ScriptMeta> {
  const content = doc.content ?? '';
  const derived = metaFromScriptContent(content, {
    scriptKind: doc.scriptKind,
    pineVersion: doc.pineVersion,
  });
  const full: ScriptDocument = {
    id: doc.id || `s_${Date.now().toString(36)}`,
    name: doc.name || 'Untitled',
    description: doc.description,
    path: doc.path,
    content,
    updatedAt: doc.updatedAt || Date.now(),
    createdAt: doc.createdAt,
    revision: doc.revision,
    tags: doc.tags,
    scriptKind: derived.scriptKind,
    pineVersion: derived.pineVersion,
  };
  const meta = await requireActive().write(full);
  appendLog('ok', `Saved "${meta.name}" → ${getActiveStorageId()}`, 'library');
  return meta;
}

/** Delete a script from active storage and log. */
export async function removeScript(id: string): Promise<void> {
  await requireActive().remove(id);
  appendLog('info', `Deleted script ${id}`, 'library');
}

/**
 * Persist editor draft: always local, plus active storage if it implements
 * `saveDraft` (failures on remote are swallowed — local remains source of truth).
 */
export async function saveDraft(content: string, name?: string): Promise<void> {
  const payload = { content, name };
  await localAlways().saveDraft?.(payload);
  const active = requireActive();
  if (active.id !== 'local' && active.saveDraft) {
    try {
      await active.saveDraft(payload);
    } catch {
      /* active may be offline */
    }
  }
}

/**
 * Load draft preferring local crash recovery, then active storage draft.
 */
export async function loadDraft(): Promise<{ content: string; name?: string } | null> {
  // Prefer local crash draft
  const local = await localAlways().loadDraft?.();
  if (local?.content) return local;
  const active = requireActive();
  if (active.id !== 'local' && active.loadDraft) {
    return active.loadDraft();
  }
  return null;
}

/** Connection/status of the active storage plugin. */
export async function getStorageStatus(): Promise<StorageStatus> {
  const p = requireActive();
  if (p.getStatus) return p.getStatus();
  return { connected: true };
}

/** Active storage plugin instance (or local fallback). */
export function getActiveStoragePlugin(): StoragePlugin {
  return requireActive();
}

/** True when the active storage can list/restore git commit history. */
export function supportsScriptVersioning(): boolean {
  const p = requireActive();
  return typeof p.listVersions === 'function' && typeof p.readAtRevision === 'function';
}

/**
 * List git commit history for a library script (newest first).
 * Throws when the active backend does not implement versioning.
 */
export async function listScriptVersions(
  id: string,
  opts?: { limit?: number },
): Promise<ScriptVersion[]> {
  const p = requireActive();
  if (typeof p.listVersions !== 'function') {
    throw new Error('Script version history requires Git storage (GitHub / GitLab)');
  }
  return p.listVersions(id, { limit: opts?.limit });
}

/**
 * Read a library script body at a historical commit SHA.
 * Does not modify the remote tip — use {@link writeScript} to restore.
 */
export async function readScriptVersion(id: string, rev: string): Promise<ScriptDocument> {
  const p = requireActive();
  if (typeof p.readAtRevision !== 'function') {
    throw new Error('Script version history requires Git storage (GitHub / GitLab)');
  }
  return p.readAtRevision(id, rev);
}

/**
 * Restore a historical revision as the current library tip (new commit on git).
 * Loads the content at `rev` and writes it back with an optional note in description.
 */
export async function restoreScriptVersion(
  id: string,
  rev: string,
  opts?: { name?: string },
): Promise<ScriptMeta> {
  const doc = await readScriptVersion(id, rev);
  const short = rev.slice(0, 7);
  const meta = await writeScript({
    id: doc.id,
    name: opts?.name || doc.name,
    description: doc.description,
    path: doc.path,
    content: doc.content,
    createdAt: doc.createdAt,
    tags: doc.tags,
    scriptKind: doc.scriptKind,
    pineVersion: doc.pineVersion,
  });
  appendLog('ok', `Restored "${meta.name}" from ${short}`, 'library');
  return meta;
}

/** Export all scripts from active storage as JSON-friendly array. */
export async function exportLibraryJson(): Promise<ScriptDocument[]> {
  const metas = await listScripts();
  const docs: ScriptDocument[] = [];
  for (const m of metas) {
    docs.push(await readScript(m.id));
  }
  return docs;
}

/** Import scripts into active storage (skips id conflicts by new id if forceNewIds). */
export async function importLibraryJson(
  items: Array<Partial<ScriptDocument> & { script?: string }>,
  opts?: { forceNewIds?: boolean },
): Promise<number> {
  let n = 0;
  for (const item of items) {
    const content = item.content ?? item.script ?? '';
    const id = opts?.forceNewIds
      ? `s_${Date.now().toString(36)}_${n}`
      : item.id || `s_${Date.now().toString(36)}_${n}`;
    await writeScript({
      id,
      name: item.name || `Imported ${n + 1}`,
      description: item.description,
      content: String(content),
      path: item.path,
      tags: item.tags,
    });
    n++;
  }
  return n;
}
