// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
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

import { type Component, createSignal, onCleanup, onMount } from 'solid-js';
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

/**
 * Bottom-center chip that flashes the chord and description of the shortcut
 * that just fired. Mount once in the app shell; it owns a `window` listener on
 * {@link SHORTCUT_FIRED_EVENT} and is `pointer-events: none` so it never
 * steals focus from the palette input.
 */
export const ShortcutFeedback: Component = (): JSX.Element => {
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
    <div
      class={`pointer-events-none fixed left-1/2 z-[1100] flex max-w-[min(20rem,calc(100vw-16px))] -translate-x-1/2 items-center gap-2 rounded-[var(--radius-input)] border border-border bg-bg-panel px-2 py-2 shadow-[var(--ui-shadow-panel)] transition-opacity duration-[var(--ui-motion-duration-fast)] ease-out motion-reduce:transition-none bottom-[max(3rem,calc(2.5rem+env(safe-area-inset-bottom,0px)))] ${
        visible() ? 'opacity-100' : 'opacity-0'
      }`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-hidden={visible() ? 'false' : 'true'}
      data-testid="axis-shortcut-feedback"
    >
      <kbd class="inline-flex items-center rounded-[var(--radius-chip)] border border-accent/40 bg-accent/10 px-1 font-mono text-[11px] font-semibold tabular-nums text-accent">
        {chord() ? formatChord(chord()) : ''}
      </kbd>
      <span class="min-w-0 truncate font-sans text-[12px] text-text-dim">{label()}</span>
    </div>
  );
};
