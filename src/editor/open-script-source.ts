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
 * Load an applied script's Pine source into the docked editor.
 *
 * The editor is lazy-mounted; {@link subscribeOpenScriptSource} drains a
 * pending payload when TabbedEditor comes up.
 *
 * @module editor/open-script-source
 */

import { setEditorMode, setEditorOpen, setStatus } from '../store';

export type OpenScriptSourceDetail = { code: string; name: string };

const listeners = new Set<(detail: OpenScriptSourceDetail) => void>();
let pending: OpenScriptSourceDetail | null = null;

/** Called from TabbedEditor onMount; delivers any queued open immediately. */
export function subscribeOpenScriptSource(
  fn: (detail: OpenScriptSourceDetail) => void,
): () => void {
  listeners.add(fn);
  if (pending) {
    const detail = pending;
    pending = null;
    queueMicrotask(() => fn(detail));
  }
  return () => {
    listeners.delete(fn);
  };
}

/** Open the docked editor on `code` (new tab, or replace empty/demo). */
export function openScriptSourceInEditor(code: string, name?: string): void {
  const trimmed = String(code || '').trim();
  if (!trimmed) {
    setStatus('error', 'No source on this script');
    return;
  }
  const detail: OpenScriptSourceDetail = {
    code: trimmed,
    name: (name || 'Script').trim() || 'Script',
  };
  pending = detail;
  setEditorMode('docked');
  setEditorOpen(true);
  if (!listeners.size) return;
  pending = null;
  for (const fn of listeners) fn(detail);
}
