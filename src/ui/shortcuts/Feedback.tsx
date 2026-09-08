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
 * @module ui/shortcuts/Feedback
 *
 * Transient on-screen confirmation that a keyboard shortcut fired. Listens for
 * the `axis-shortcut-fired` CustomEvent emitted by `dispatchShortcut`
 * (runtime.ts) and flashes a bottom-center chip with the live chord + binding
 * description.
 *
 * Deliberately `pointer-events: none` + `aria-live="polite"`: feedback must
 * never steal focus (the palette input auto-focuses while open) or block
 * clicks. Platform-correct glyphs come from `formatChord` (⌘K vs Ctrl+K).
 */

import { type Component, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { formatChord } from './keys';

/** Payload of the `axis-shortcut-fired` CustomEvent (see runtime.ts). */
export interface ShortcutFiredDetail {
  id: string;
  /** Raw chord string from the dispatch table, e.g. `Mod-K`. */
  chord: string;
  description?: string;
}

/** How long the chip stays on screen (fast enough to not feel sticky). */
const HIDE_MS = 1200;

/** Event name emitted by dispatchShortcut on a consumed key. */
export const SHORTCUT_FIRED_EVENT = 'axis-shortcut-fired';

export const ShortcutFeedback: Component = () => {
  const [visible, setVisible] = createSignal(false);
  const [chord, setChord] = createSignal('');
  const [label, setLabel] = createSignal('');
  let timer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    const onFired = (e: Event) => {
      const detail = (e as CustomEvent<ShortcutFiredDetail>).detail;
      if (!detail?.chord) return;
      // Re-trigger resets the content and the hide timer (rapid chords stay visible).
      setChord(detail.chord);
      setLabel(detail.description || detail.id);
      setVisible(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setVisible(false), HIDE_MS);
    };
    window.addEventListener(SHORTCUT_FIRED_EVENT, onFired);
    onCleanup(() => {
      window.removeEventListener(SHORTCUT_FIRED_EVENT, onFired);
      if (timer) clearTimeout(timer);
    });
  });

  return (
    <Show when={visible()}>
      <div
        class="fixed bottom-12 left-1/2 -translate-x-1/2 z-[1100] flex items-center gap-2 px-3 py-1.5 bg-bg-panel/95 border border-accent/60 rounded-[var(--radius-sc)] shadow-[0_8px_32px_rgba(0,0,0,0.5)] pointer-events-none"
        role="status"
        aria-live="polite"
        data-testid="axis-shortcut-feedback"
      >
        <kbd class="font-mono text-[11px] text-accent">{formatChord(chord())}</kbd>
        <span class="text-[11px] text-text-dim">{label()}</span>
      </div>
    </Show>
  );
};
