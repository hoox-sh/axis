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
  ResultMeta,
  StoredRunResult,
} from '../plugins/types';
import { createSignal } from 'solid-js';
import { ensureBuiltins } from '../plugins/bootstrap';
import { getActiveStorage, getActiveStorageId } from '../plugins/active';
import { metaFromScriptContent } from '../indicators/script-meta';
import { getStorage } from './catalog';
import { localStoragePlugin } from './local';
import { appendLog, setActivePlugin } from '../store';

/**
 * Pending storage engine switch awaiting user decision. Consumed by
 * {@link import('../ui/StorageChangePrompt').StorageChangePrompt}, which
 * mounts a single global {@link import('../ui/StorageChangeDialog').default}
 * and applies the final `setActivePlugin('storage', …)` after the user picks
 * *Migrate*, *Start fresh*, or cancels.
 *
 * Single module-level signal so every call site (ScriptLibraryPanel,
 * SettingsDialog, PluginsPage, PluginManager) shares one source of truth
 * instead of each one duplicating dialog state.
 */
interface StorageChangeRequest {
  /** Previous active storage id (e.g. `"local"`). */
  from: string;
  /** Target storage id the user just picked. */
  to: string;
}

const [pendingStorageChange, setPendingStorageChange] =
  createSignal<StorageChangeRequest | null>(null);

// Re-export so UI consumers (Results modal "Saved runs" tab, badges) can
// import the lightweight metadata + payload types from this façade without
// reaching into the plugin layer.
export type { ResultMeta, StoredRunResult };

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

/**
 * Returns true when the active storage plugin implements the optional
 * `saveResult` method (i.e. supports run-result persistence).
 *
 * Backends that omit `saveResult` (e.g. plain git / cloud storage without a
 * results store) report `false` here. UI affordances (the "Saved runs" tab in
 * the Results modal) should consult this before rendering — callers MUST
 * still guard the call site itself with `plugin.saveResult?` for type
 * narrowing.
 */
export function supportsRunResults(): boolean {
  const p = getActiveStoragePlugin();
  return typeof p?.saveResult === 'function';
}

/**
 * Persist a completed strategy/indicator run, keyed by `(meta.scriptId,
 * meta.runId)`. The active plugin receives the call when it implements
 * `saveResult`; otherwise the run is written to the local plugin so users on
 * git/cloud backends still get crash-recovery persistence.
 *
 * Throws when the chosen backend fails (quota, IDB unavailable, serialization
 * error). Callers decide whether to surface or swallow the error.
 */
export async function saveRunResult(stored: StoredRunResult): Promise<void> {
  const p = getActiveStoragePlugin();
  if (typeof p?.saveResult === 'function') {
    await p.saveResult(stored);
    return;
  }
  // Fallback: write to local for crash recovery so cloud/git users still
  // retain results between sessions.
  const local = localAlways();
  if (typeof local.saveResult !== 'function') {
    throw new Error(
      'No storage backend available that supports saveResult (active and local both lack the method)',
    );
  }
  await local.saveResult(stored);
}

/**
 * Load a previously saved run by `(scriptId, runId)`.
 *
 * Returns `null` when the active plugin either has no `loadResult` method
 * or has no record for the requested ids — neither case is treated as an
 * error. Backends that throw on corruption propagate the error to the caller.
 */
export async function loadRunResult(
  scriptId: string,
  runId: string,
): Promise<StoredRunResult | null> {
  const p = getActiveStoragePlugin();
  if (typeof p?.loadResult === 'function') {
    return p.loadResult(scriptId, runId);
  }
  return null;
}

/**
 * List saved run metadata for a script (newest first). Returns `[]` when the
 * active plugin does not implement `listResults` — UI consumers should treat
 * this as "no saved runs", not as an error.
 */
export async function listRunResults(scriptId: string): Promise<ResultMeta[]> {
  const p = getActiveStoragePlugin();
  if (typeof p?.listResults === 'function') {
    return p.listResults(scriptId);
  }
  return [];
}

/**
 * Delete a saved run by `(scriptId, runId)`. Idempotent: silently no-ops when
 * the run is absent on the active backend. Falls back to the local plugin
 * when the active one lacks `removeResult` so a run that was written to local
 * (via the `saveRunResult` fallback) can still be cleaned up.
 */
export async function removeRunResult(
  scriptId: string,
  runId: string,
): Promise<void> {
  const p = getActiveStoragePlugin();
  if (typeof p?.removeResult === 'function') {
    await p.removeResult(scriptId, runId);
    return;
  }
  // Fallback: run may have been written to local (see saveRunResult). Try
  // there for symmetry; the contract says remove is idempotent, so any error
  // is intentionally swallowed.
  try {
    const local = localAlways();
    if (typeof local.removeResult === 'function') {
      await local.removeResult(scriptId, runId);
    }
  } catch {
    /* idempotent — record may not exist */
  }
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

// ---------------------------------------------------------------------------
// Storage change dialog glue
// ---------------------------------------------------------------------------

/**
 * Accessor for the pending storage-change request. Returns `null` when no
 * dialog is open. Read by
 * {@link import('../ui/StorageChangePrompt').StorageChangePrompt} to drive
 * the global dialog host.
 */
export function getPendingStorageChange(): StorageChangeRequest | null {
  return pendingStorageChange();
}

/**
 * Ask the user to confirm switching the active storage engine from `oldId`
 * to `newId`. Drop-in replacement for
 * `setActivePlugin('storage', newId)` at every UI call site — wraps the
 * flip in the {@link import('../ui/StorageChangeDialog').default} dialog so
 * the user can pick *Migrate* or *Start fresh* (or cancel).
 *
 * Short-circuits silently when:
 * - `newId` is empty (defensive)
 * - `oldId` and `newId` are identical (no real change → no dialog)
 * - `oldId` is empty (first-time set → no prior data to migrate)
 *
 * The dialog handles the actual per-script copy; once the user picks
 * *Migrate* or *Start fresh* the global prompt component calls
 * `setActivePlugin('storage', newId)` and clears the pending request.
 */
export function promptStorageChange(oldId: string, newId: string): void {
  const from = String(oldId || '');
  const to = String(newId || '');
  if (!to) return;
  if (from === to) return;
  if (!from) {
    // First-time set — no prior data to migrate, just flip.
    setActivePlugin('storage', to);
    return;
  }
  setPendingStorageChange({ from, to });
}

/** Cancel any in-flight storage change dialog. */
export function cancelPendingStorageChange(): void {
  setPendingStorageChange(null);
}

/** Test helper — reset module state between test cases. */
export function _resetPendingStorageChangeForTests(): void {
  setPendingStorageChange(null);
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
