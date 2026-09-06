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
 * Editor chrome **git sync** bar — pull / push / status chip.
 *
 * Uses active storage (git commits on push; local/cloud = save to library).
 * Buttons stay enabled when storage is not git so Save-to-library still works.
 *
 * @module ui/EditorGitBar
 */

import { Component, createEffect, createSignal, Show } from 'solid-js';
import type { ScriptMeta } from '../plugins/types';
import { setStatus, store } from '../store';
import {
  formatGitStatus,
  getEditorStorageId,
  isGitStorageActive,
  pullLibrary,
  pushScript,
  statusMetaFromPull,
  type GitStatusMeta,
} from '../editor/git-sync';
import { Icons } from './icons';

export interface EditorGitBarProps {
  /** Current document text (live editor preferred). */
  getDoc: () => string;
  /** Active tab display name. */
  getName: () => string;
  /** Bound library script id when loaded/saved. */
  getLibraryId: () => string | undefined;
  /** Whether the active tab has unsaved edits. */
  dirty: () => boolean;
  /** After successful push: clear dirty + bind library id. */
  onPushSuccess?: (meta: ScriptMeta) => void;
  /**
   * After pull, when the active tab is bound to a library script that was
   * re-read from storage — parent should load content into the editor.
   */
  onPullReload?: (doc: string, name?: string, libraryId?: string) => void;
  /** Compact mode for tight toolbars (icon-only + small chip). */
  compact?: boolean;
}

/** Pull / push / status controls for the Pine editor chrome. */
export const EditorGitBar: Component<EditorGitBarProps> = (props) => {
  const [busy, setBusy] = createSignal(false);
  const [statusMeta, setStatusMeta] = createSignal<GitStatusMeta>({
    storageId: getEditorStorageId(),
    dirty: false,
  });

  const storageLabel = () => store.activePlugins?.storage || getEditorStorageId() || 'local';
  const gitActive = () => isGitStorageActive();

  // Keep chip storage id + dirty in sync with store / tab without network I/O
  createEffect(() => {
    const dirty = props.dirty();
    const storageId = storageLabel();
    setStatusMeta((prev) => ({
      ...prev,
      storageId,
      dirty,
    }));
  });

  const chipText = () => formatGitStatus(statusMeta());

  const onPull = async () => {
    if (busy()) return;
    setBusy(true);
    try {
      const libraryId = props.getLibraryId();
      const result = await pullLibrary(libraryId);
      const meta = statusMetaFromPull(result, props.dirty(), storageLabel());
      setStatusMeta(meta);

      if (result.sync && !result.sync.ok) {
        setStatus('error', result.sync.message || 'Pull failed');
      } else if (result.doc && libraryId) {
        props.onPullReload?.(result.doc.content, result.doc.name, result.doc.id);
        setStatusMeta({ ...meta, dirty: false });
        setStatus(
          'ready',
          gitActive()
            ? `Pulled "${result.doc.name}" from git (${result.list.length} script(s))`
            : `Refreshed "${result.doc.name}" (${result.list.length} script(s))`,
        );
      } else {
        setStatus(
          'ready',
          result.sync?.message ||
            (gitActive()
              ? `Pulled ${result.list.length} script(s) from git`
              : `Library: ${result.list.length} script(s)`),
        );
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatusMeta((prev) => ({ ...prev, error: msg, connected: false }));
      setStatus('error', msg);
    } finally {
      setBusy(false);
    }
  };

  const onPush = async () => {
    if (busy()) return;
    const content = props.getDoc() || '';
    if (!content.trim()) {
      setStatus('error', 'Editor is empty');
      return;
    }
    const name = props.getName() || 'Script';
    setBusy(true);
    try {
      const meta = await pushScript({
        id: props.getLibraryId(),
        name,
        content,
      });
      props.onPushSuccess?.(meta);
      setStatusMeta((prev) => ({
        ...prev,
        storageId: storageLabel(),
        dirty: false,
        error: undefined,
        connected: true,
      }));
      setStatus(
        'ready',
        gitActive()
          ? `Committed & saved "${meta.name}" to git`
          : `Saved "${meta.name}" → ${storageLabel()}`,
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus('error', msg);
    } finally {
      setBusy(false);
    }
  };

  const pullTitle = () =>
    gitActive()
      ? 'Pull / refresh library from git'
      : 'Refresh library list from active storage';

  const pushTitle = () =>
    gitActive()
      ? 'Push / commit current script to git'
      : `Save current script to ${storageLabel()} library`;

  return (
    <div
      class="flex items-center gap-0.5 flex-shrink-0"
      data-testid="axis-editor-git-bar"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        class="sc-btn sc-btn-ghost px-1.5 text-[10px]"
        title={pullTitle()}
        aria-label={pullTitle()}
        disabled={busy()}
        data-testid="axis-btn-editor-git-pull"
        onClick={() => void onPull()}
      >
        <Icons.refresh size={12} class={busy() ? 'animate-spin' : ''} />
        <Show when={!props.compact}>
          <span>Pull</span>
        </Show>
      </button>
      <button
        type="button"
        class="sc-btn sc-btn-ghost px-1.5 text-[10px]"
        title={pushTitle()}
        aria-label={pushTitle()}
        disabled={busy()}
        data-testid="axis-btn-editor-git-push"
        onClick={() => void onPush()}
      >
        <Icons.upload size={12} />
        <Show when={!props.compact}>
          <span>{busy() ? '…' : 'Push'}</span>
        </Show>
      </button>
      <span
        class={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono rounded border border-border-soft max-w-[200px] truncate ${
          statusMeta().dirty ? 'text-orange border-orange/40' : 'text-text-faint'
        }`}
        title={
          gitActive()
            ? chipText()
            : `${chipText()} · Switch storage to Git in Settings for remote commits`
        }
        data-testid="axis-editor-git-status"
      >
        <Show when={gitActive()} fallback={<Icons.folder size={10} />}>
          <Icons.check size={10} class={statusMeta().dirty ? 'opacity-40' : 'text-accent'} />
        </Show>
        {chipText()}
      </span>
    </div>
  );
};
