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
 * Drawing-rail primitives — one 32px grid button (44px on coarse), one flyout caret.
 *
 * Replaces the ad-hoc `btnClass` string concat (Tailwind `!w-8 !h-8` fights
 * against `.axis-draw-btn`) with a single class contract owned by CSS.
 * Pixel contract: 32×32 box on a fine pointer, 44×44 on coarse, 16px glyph
 * optically centered, accent wash + 2px edge bar when active. The floating
 * name is visual only (`aria-hidden`); the button name is `aria-label`.
 *
 * @module chart/drawings/toolbar/tool-button
 */

import { type Component, type JSX, Show } from 'solid-js';
import './density.css';

/**
 * 32×32 rail button (44×44 on a coarse pointer): glyph plus state wash.
 *
 * @param props.title tooltip (usually name + shortcut chord)
 * @param props.label accessible name
 * @param props.testId optional `data-testid` for e2e hooks
 */
export const ToolRailButton: Component<{
  title: string;
  label: string;
  active?: boolean;
  pressed?: boolean;
  disabled?: boolean;
  testId?: string;
  /** Extra class hook (e.g. `is-eye-on` for a visibility toggle). */
  class?: string;
  onSelect: () => void;
  children: JSX.Element;
}> = (props): JSX.Element => (
  <button
    type="button"
    class={`axis-draw-btn${props.class ? ` ${props.class}` : ''}`}
    classList={{
      'is-active': !!props.active,
      'is-pressed': !!props.pressed,
    }}
    title={props.title}
    aria-label={props.label}
    aria-pressed={props.pressed ?? props.active ?? false}
    disabled={props.disabled}
    data-testid={props.testId}
    onClick={props.onSelect}
  >
    {props.children}
    <span class="axis-draw-btn-label" aria-hidden="true">
      {props.label}
    </span>
  </button>
);

/** Small caret that opens a group flyout; stops the click from selecting the tool. */
export const ToolCaret: Component<{
  label: string;
  title: string;
  expanded: boolean;
  down?: boolean;
  onToggle: () => void;
}> = (props): JSX.Element => (
  <button
    type="button"
    class="axis-draw-caret"
    classList={{ 'is-down': !!props.down, 'is-open': props.expanded }}
    aria-label={props.label}
    aria-haspopup="menu"
    aria-expanded={props.expanded}
    title={props.title}
    data-drawing-caret
    onClick={(e) => {
      e.stopPropagation();
      props.onToggle();
    }}
  >
    <svg viewBox="0 0 8 8" width="8" height="8" aria-hidden="true">
      <path
        d="M2.1 1.25 L5.75 4 L2.1 6.75"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </button>
);

/** Hairline divider between rail groups; purely decorative. */
export const RailSeparator: Component = (): JSX.Element => (
  <div class="axis-draw-sep" aria-hidden="true" />
);

/** Small count / label badge on a rail button; renders nothing for an empty string. */
export const RailBadge: Component<{ text: string }> = (props): JSX.Element => (
  <Show when={props.text}>
    <span class="axis-draw-badge" aria-hidden="true">
      {props.text}
    </span>
  </Show>
);
