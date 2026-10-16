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
 * Slogan typewriter — Solid port of the hoox landing `TypewriterTagline`.
 *
 * Cycles through phrases with the landing rhythm (type → hold 2s → delete →
 * next, repeat) and a block cursor, so the hoox.sh/axis slogans look identical
 * on the maintenance page. Timing constants are lifted from
 * `hoox-landing-page/components/typewriter-tagline.tsx`.
 *
 * Layout: the box is sized by an invisible probe holding the *longest* phrase,
 * so the line's left edge never moves while characters stream in — a centred
 * typewriter would otherwise slide the text both ways as it types. The host
 * can therefore centre the box and still get a stable typing origin.
 *
 * Accessibility: the whole line is `aria-hidden`. The maintenance page root is
 * an `aria-live` region and a per-character DOM mutation inside it would make
 * screen readers announce every keystroke; the slogans are decorative and the
 * page's meaning lives in the heading beside them.
 *
 * Reduced motion: renders the first phrase statically — the cycle never starts
 * and the cursor does not pulse (`motion-safe:` variant).
 *
 * @module ui/SloganTypewriter
 */

import { type Component, createSignal, onCleanup, onMount } from 'solid-js';

/** ms per char while typing (landing parity). */
const TYPE_MS = 65;
/** ms per char while deleting (landing parity). */
const DELETE_MS = 35;
/** Hold a complete phrase before deleting it (landing parity). */
const HOLD_MS = 2000;

export type SloganTypewriterProps = {
  /** Phrases to cycle in order; `phrases[0]` is the first (static) frame. */
  phrases: readonly string[];
  class?: string;
};

/** Animated, aria-hidden slogan line (see module doc for the contract). */
export const SloganTypewriter: Component<SloganTypewriterProps> = (props) => {
  const first = props.phrases[0] ?? '';
  const [text, setText] = createSignal(first);
  /** Longest phrase — sizes the box so the left edge is stable. */
  const probe = () => props.phrases.reduce((a, b) => (b.length > a.length ? b : a), first);

  let phraseIdx = 0;
  let charIdx = first.length;
  let phase: 'hold' | 'delete' | 'type' = 'hold';
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = () => {
    const list = props.phrases;
    if (!list.length) return;
    const phrase = list[phraseIdx] ?? list[0] ?? '';

    if (phase === 'hold') {
      phase = 'delete';
      timer = setTimeout(tick, HOLD_MS);
      return;
    }
    if (phase === 'delete') {
      charIdx -= 1;
      setText(phrase.slice(0, Math.max(0, charIdx)));
      if (charIdx <= 0) {
        phraseIdx = (phraseIdx + 1) % list.length;
        phase = 'type';
        timer = setTimeout(tick, TYPE_MS);
      } else {
        timer = setTimeout(tick, DELETE_MS);
      }
      return;
    }
    // phase === 'type'
    const next = list[phraseIdx] ?? list[0] ?? '';
    charIdx += 1;
    setText(next.slice(0, charIdx));
    if (charIdx >= next.length) {
      phase = 'hold';
      timer = setTimeout(tick, HOLD_MS);
    } else {
      timer = setTimeout(tick, TYPE_MS);
    }
  };

  onMount(() => {
    // Static first phrase when motion is unwelcome.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    timer = setTimeout(tick, HOLD_MS);
  });
  onCleanup(() => clearTimeout(timer));

  return (
    <span
      class={`relative inline-block text-left ${props.class ?? ''}`}
      data-testid="axis-maintenance-slogans"
      aria-hidden="true"
    >
      {/* Sizing probe — holds the longest phrase, invisible. */}
      <span class="pointer-events-none invisible whitespace-nowrap">{probe()}</span>
      <span class="absolute inset-0 whitespace-nowrap text-left">
        {text()}
        <span class="motion-safe:animate-pulse">█</span>
      </span>
    </span>
  );
};
