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
 * Read-only keyboard-shortcuts reference overlay. Opens via the
 * `axis-shortcuts-open` window event (fired by the Hub's `Shift-?` /
 * `Shift-/` binding and the palette's "Show keyboard shortcuts" command).
 * Lists every active binding grouped by scope, honoring user overrides.
 *
 * @module ui/shortcuts/ShortcutsModal
 */

import { Component, For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { store } from '../../store';
import { DEFAULT_BINDINGS, getDisplay } from './registry';
import { detectPlatform } from './keys';
import type { ShortcutDef } from './types';

const SCOPE_ORDER: ShortcutDef['scope'][] = ['app', 'editor', 'chart', 'palette'];
const SCOPE_LABEL: Record<ShortcutDef['scope'], string> = {
  app: 'App',
  editor: 'Editor',
  chart: 'Chart',
  palette: 'Palette',
};

/** Whether the shortcuts modal is open (for tests / host chrome). */
export function isShortcutsModalOpen(): boolean {
  return shortcutsOpen();
}

const [shortcutsOpen, setShortcutsOpen] = createSignal(false);

/** Open the shortcuts modal (used by the Hub / palette command). */
export function openShortcutsModal(): void {
  setShortcutsOpen(true);
}

/** Close the shortcuts modal. */
export function closeShortcutsModal(): void {
  setShortcutsOpen(false);
}

/** Read-only help overlay listing every active binding. */
export const ShortcutsModal: Component = () => {
  const close = () => closeShortcutsModal();

  onMount(() => {
    const onOpen = () => openShortcutsModal();
    window.addEventListener('axis-shortcuts-open', onOpen);
    const onKey = (e: KeyboardEvent) => {
      if (!shortcutsOpen()) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => {
      window.removeEventListener('axis-shortcuts-open', onOpen);
      window.removeEventListener('keydown', onKey);
    });
  });

  const onBackdrop = (e: MouseEvent) => {
    if (e.target === e.currentTarget) close();
  };

  const overrides = () => store.shortcuts?.overrides ?? {};
  const platform = detectPlatform();

  // Dedupe aliased bindings (e.g. Shift-? / Shift-/ share one id).
  const uniqueBindings = () => {
    const seen = new Set<string>();
    return DEFAULT_BINDINGS.filter((def) => {
      if (seen.has(def.id)) return false;
      seen.add(def.id);
      return true;
    });
  };

  const groups = () =>
    SCOPE_ORDER.map((scope) => ({
      scope,
      bindings: uniqueBindings().filter((def) => def.scope === scope),
    })).filter((g) => g.bindings.length > 0);

  return (
    <Show when={shortcutsOpen()}>
      <div
        class="sc-dialog-backdrop"
        onClick={onBackdrop}
        role="presentation"
        data-testid="axis-shortcuts-backdrop"
      >
        <div
          class="sc-dialog w-[min(640px,calc(100vw-2*var(--ui-dialog-margin)))] max-h-[min(88vh,720px)] flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-labelledby="axis-shortcuts-title"
          data-testid="axis-shortcuts-modal"
          tabIndex={-1}
        >
          <div class="sc-dialog-accent" />

          <div class="sc-dialog-header">
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="min-w-0">
                <div
                  id="axis-shortcuts-title"
                  class="text-[0.95em] font-semibold text-text tracking-tight"
                >
                  Keyboard shortcuts
                </div>
                <div class="sc-hint">Familiar power-user chords · overrides apply</div>
              </div>
            </div>
            <button
              type="button"
              class="sc-btn sc-btn-ghost px-2"
              onClick={close}
              aria-label="Close shortcuts"
              data-testid="axis-shortcuts-close"
            >
              ✕
            </button>
          </div>

          <div class="sc-dialog-body overflow-y-auto flex flex-col gap-5 text-[0.9em]">
            <For each={groups()}>
              {(group) => (
                <section class="flex flex-col gap-1.5">
                  <h3 class="text-[0.78em] font-semibold uppercase tracking-wider text-text-dim">
                    {SCOPE_LABEL[group.scope]}
                  </h3>
                  <For each={group.bindings}>
                    {(def) => {
                      const chord = getDisplay(def.id, overrides(), platform);
                      return (
                        <div
                          class="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-bg-hover"
                          data-testid={`axis-shortcut-${def.id}`}
                        >
                          <span class="text-text">{def.description}</span>
                          <Show when={chord} fallback={<span class="sc-hint">—</span>}>
                            <kbd class="sc-kbd">{chord}</kbd>
                          </Show>
                        </div>
                      );
                    }}
                  </For>
                </section>
              )}
            </For>
          </div>

          <div class="sc-dialog-footer">
            <span class="sc-hint">
              Recording a new chord? Settings → Keyboard
            </span>
            <button
              type="button"
              class="sc-btn sc-btn-primary"
              onClick={close}
              data-testid="axis-shortcuts-done"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};