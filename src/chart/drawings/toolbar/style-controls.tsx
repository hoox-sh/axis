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
 * Style-bar micro-controls — swatches, width chips, line-style chips.
 *
 * One class contract each (owned by CSS), consistent 28px control height,
 * visible focus rings, and `aria-pressed` for toggle semantics.
 *
 * @module chart/drawings/toolbar/style-controls
 */

import { type Component, For } from 'solid-js';
import type { DrawingLineStyle } from '../../drawing-types';

/** Thick vertical separator between style-bar groups. */
export const StyleDivider: Component = (): JSX.Element => (
  <span class="axis-draw-style-sep" aria-hidden="true" />
);
/** Hairline separator inside a style-bar group. */
export const StyleDividerThin: Component = (): JSX.Element => (
  <span class="axis-draw-style-sep axis-draw-style-sep-thin" aria-hidden="true" />
);

/**
 * One palette swatch button.
 *
 * @param props.color CSS color painted as the swatch background
 * @param props.selected marks the current color (adds `is-active`)
 * @param props.onPick receives `color` on click
 */
export const ColorSwatch: Component<{
  color: string;
  selected: boolean;
  onPick: (color: string) => void;
}> = (props): JSX.Element => (
  <button
    type="button"
    class="axis-draw-swatch"
    classList={{ 'is-active': props.selected }}
    style={{ 'background-color': props.color }}
    title={props.color}
    aria-label={`Color ${props.color}`}
    aria-pressed={props.selected}
    onClick={() => props.onPick(props.color)}
  />
);

/**
 * Palette row: fixed swatches plus a native custom-color input.
 *
 * @param props.colors preset colors in display order
 * @param props.current active color, compared case-insensitively
 * @param props.customValue initial value for the color input
 * @param props.onCustom fires with the picked custom color
 */
export const SwatchRow: Component<{
  colors: readonly string[];
  current: string;
  onPick: (color: string) => void;
  customValue: string;
  onCustom: (color: string) => void;
}> = (props): JSX.Element => (
  <>
    <For each={[...props.colors]}>
      {(c) => (
        <ColorSwatch
          color={c}
          selected={props.current.toLowerCase() === c.toLowerCase()}
          onPick={props.onPick}
        />
      )}
    </For>
    <input
      type="color"
      class="axis-draw-swatch is-custom"
      title="Custom color"
      aria-label="Custom color"
      value={props.customValue}
      onInput={(e) => props.onCustom(e.currentTarget.value)}
    />
  </>
);

/** Line-width chip; `1.5` renders as `1½` to keep the bar compact. */
export const WidthChip: Component<{
  width: number;
  active: boolean;
  onPick: (w: number) => void;
}> = (props): JSX.Element => (
  <button
    type="button"
    class="axis-draw-chip"
    classList={{
      'is-active': props.active,
      'is-pressed': props.active,
    }}
    title={`Width ${props.width}`}
    aria-label={`Line width ${props.width}`}
    aria-pressed={props.active}
    onClick={() => props.onPick(props.width)}
  >
    {props.width === 1.5 ? '1½' : props.width}
  </button>
);

/** Dash-pattern chip with a live stroke preview (`solid` / `dashed` / `dotted`). */
export const LineStyleChip: Component<{
  style: DrawingLineStyle;
  active: boolean;
  onPick: (s: DrawingLineStyle) => void;
}> = (props): JSX.Element => (
  <button
    type="button"
    class="axis-draw-chip is-line"
    classList={{ 'is-active': props.active }}
    title={props.style}
    aria-label={`Line style ${props.style}`}
    aria-pressed={props.active}
    onClick={() => props.onPick(props.style)}
  >
    <span class="axis-draw-line-preview" data-style={props.style} aria-hidden="true" />
  </button>
);

/** On/off chip for boolean style settings (labels, arrow caps, reverse). */
export const ToggleChip: Component<{
  title: string;
  label: string;
  active: boolean;
  onToggle: () => void;
}> = (props): JSX.Element => (
  <button
    type="button"
    class="axis-draw-chip"
    classList={{ 'is-active': props.active }}
    title={props.title}
    aria-label={props.title}
    aria-pressed={props.active}
    onClick={props.onToggle}
  >
    {props.label}
  </button>
);
