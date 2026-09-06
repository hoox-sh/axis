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
 * @module ui/shortcuts/Hub
 *
 * Single capture-phase `keydown` listener that owns the dispatch table for
 * every keyboard shortcut. Modules register their side effects via
 * {@link registerShortcut}; the Hub matches events against the effective
 * chords (defaults + persisted overrides) and invokes the registered action.
 *
 * The dialog-skip guard replicates `presentation.ts` so Escape / palette
 * chords never leak into an open modal or the command palette input.
 *
 * The dispatch core ({@link buildDispatchTable} + {@link dispatchShortcut})
 * is framework-free so it can be unit-tested without a DOM/Solid runtime.
 */

import { Component, createMemo, onCleanup, onMount } from 'solid-js';
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
 * Register the side effect for a shortcut id. Returns a cleanup that removes
 * the registration (safe to call more than once).
 */
export function registerShortcut(id: ShortcutId, action: Action): () => void {
  actions.set(id, action);
  return () => {
    if (actions.get(id) === action) actions.delete(id);
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
 * or palette. Editor/chart chords always run — the Hub is the canonical owner
 * for their action side effects (save, goto, zoom, …).
 */
function shouldSkip(id: ShortcutId, target: EventTarget | null): boolean {
  if (id.startsWith('editor.') || id.startsWith('chart.')) return false;
  return isInOpenDialog(target);
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

/**
 * Mount once from the product shell. Renders nothing; owns the capture-phase
 * keydown listener for the whole app.
 */
export const ShortcutHub: Component<{ children?: any }> = (props) => {
  const table = createMemo(buildDispatchTable);

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      dispatchShortcut(table(), e);
    };
    window.addEventListener('keydown', onKey, true);
    onCleanup(() => window.removeEventListener('keydown', onKey, true));
  });

  return props.children ?? null;
};