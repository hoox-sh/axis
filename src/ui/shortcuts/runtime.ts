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
 * @module ui/shortcuts/runtime
 *
 * Framework-free dispatch core for the keyboard shortcut system: the action
 * registry, the effective dispatch table (defaults + persisted overrides),
 * and the capture-phase keydown matcher with the dialog-skip guard.
 *
 * Kept free of Solid/DOM so it can be unit-tested without a browser runtime.
 * The {@link ShortcutHub} component (Hub.tsx) wires this to `window`; the
 * app-level actions (actions.ts) register their side effects here.
 */

import { store } from '../../store';
import {
  DEFAULT_BINDINGS,
  matchEvent,
  resolveBinding,
  type ShortcutDef,
  type ShortcutId,
} from './index';

type Action = (event: KeyboardEvent) => void | Promise<void>;

/** Public registry of shortcut actions; modules call `registerShortcut(id, action)`. */
const actions = new Map<ShortcutId, Action>();

/**
 * Register the side effect for a shortcut id. Returns a cleanup that restores
 * the previous registration (or removes it if none existed) — safe to call
 * more than once.
 */
export function registerShortcut(id: ShortcutId, action: Action): () => void {
  const prev = actions.get(id);
  actions.set(id, action);
  return () => {
    if (actions.get(id) === action) {
      if (prev) actions.set(id, prev);
      else actions.delete(id);
    }
  };
}

/** One row of the effective dispatch table. */
export interface DispatchRow {
  id: ShortcutId;
  def: ShortcutDef;
  chord: string;
}

/**
 * Stable dispatcher list (rebuilt when store changes; identity preserved per
 * binding id). Bindings the user cleared (`id → null`) are omitted.
 */
export function buildDispatchTable(): DispatchRow[] {
  const overrides = store.shortcuts?.overrides || {};
  const table: DispatchRow[] = [];
  for (const def of DEFAULT_BINDINGS) {
    const chord = resolveBinding(def, overrides);
    if (chord == null) continue; // user cleared
    table.push({ id: def.id, def, chord });
  }
  return table;
}

/**
 * Replicate the presentation.ts dialog-skip guard: don't steal keys from an
 * editable surface (input / textarea / select / contenteditable / CM) or from
 * an open modal dialog / command palette.
 */
function isInOpenDialog(target: EventTarget | null): boolean {
  if (typeof document === 'undefined') return false;
  if (typeof HTMLElement !== 'undefined' && target instanceof HTMLElement) {
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable) return true;
    if (target.closest?.('.cm-editor, .cm-content, [role="textbox"]')) return true;
  }
  // Explicit modal/dialog sentinel — keep Escape / overlay keys from leaking.
  return !!document.querySelector(
    '[role="dialog"][aria-modal="true"], dialog[open], [data-testid="axis-command-palette"], [data-testid="axis-command-palette-backdrop"]',
  );
}

/**
 * True when the chord should be suppressed because focus is inside an editor
 * or palette.
 *
 * - Editor/chart chords always run — the Hub is the canonical owner for their
 *   action side effects (save, goto, zoom, …).
 * - The palette-opening chords are global (standard palette UX: `Mod-K`
 *   toggles the palette even while it is open / from an input).
 * - `app.escape` is context-sensitive: open dialogs and editable surfaces
 *   handle their own Escape (palette input, Settings, About, …).
 * - The remaining app-level chords (save, run, toggle-editor, settings,
 *   shortcuts) are global and fire regardless of focus.
 */
function shouldSkip(id: ShortcutId, target: EventTarget | null): boolean {
  if (id.startsWith('editor.')) return false;
  if (id.startsWith('chart.')) {
    // Don't steal chart letters while the user is typing in an input /
    // textarea / contenteditable / CodeMirror surface.
    if (typeof HTMLElement !== 'undefined' && target instanceof HTMLElement) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (target.isContentEditable) return true;
      if (target.closest?.('.cm-editor, .cm-content, [role="textbox"]')) return true;
    }
    return false;
  }
  if (id === 'app.open-palette' || id === 'app.open-palette-alt') return false;
  if (id === 'app.escape') return isInOpenDialog(target);
  return false;
}

/**
 * Core dispatch: match the event against the table and invoke the registered
 * action. Returns `true` when the event was consumed (preventDefault called).
 * This is what the mounted listener runs on every capture-phase keydown.
 */
export function dispatchShortcut(table: DispatchRow[], e: KeyboardEvent): boolean {
  if (e.defaultPrevented) return false;
  const row = table.find((r) => matchEvent(e, r.chord));
  if (!row) return false;
  if (shouldSkip(row.id, e.target)) return false;
  const action = actions.get(row.id);
  if (!action) return false; // binding exists but no consumer — common before registration
  // Do not preventDefault globally — only when we actually consumed the key.
  e.preventDefault();
  e.stopPropagation();
  try {
    void action(e);
  } catch (err) {
    console.warn('[shortcuts] action', row.id, err);
  }
  return true;
}