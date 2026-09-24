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
 * Style-bar micro-controls — swatches, width chips, line-style chips.
 *
 * One class contract each (owned by CSS), consistent 28px control height,
 * visible focus rings, and `aria-pressed` for toggle semantics.
 *
 * @module chart/drawings/toolbar/style-controls
 */

import { type Component, For } from 'solid-js';
import type { DrawingLineStyle } from '../../drawing-types';

export const StyleDivider: Component = () => (
  <span class="axis-draw-style-sep" aria-hidden="true" />
);

export const ColorSwatch: Component<{
  color: string;
  selected: boolean;
  onPick: (color: string) => void;
}> = (props) => (
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

export const SwatchRow: Component<{
  colors: readonly string[];
  current: string;
  onPick: (color: string) => void;
  customValue: string;
  onCustom: (color: string) => void;
}> = (props) => (
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

export const WidthChip: Component<{
  width: number;
  active: boolean;
  onPick: (w: number) => void;
}> = (props) => (
  <button
    type="button"
    class="axis-draw-chip"
    classList={{ 'is-active': props.active }}
    title={`Width ${props.width}`}
    aria-label={`Line width ${props.width}`}
    aria-pressed={props.active}
    onClick={() => props.onPick(props.width)}
  >
    {props.width === 1.5 ? '1½' : props.width}
  </button>
);

export const LineStyleChip: Component<{
  style: DrawingLineStyle;
  active: boolean;
  onPick: (s: DrawingLineStyle) => void;
}> = (props) => (
  <button
    type="button"
    class="axis-draw-chip is-line"
    classList={{ 'is-active': props.active }}
    title={props.style}
    aria-label={`Line style ${props.style}`}
    aria-pressed={props.active}
    onClick={() => props.onPick(props.style)}
  >
    <span
      class="axis-draw-line-preview"
      data-style={props.style}
      aria-hidden="true"
    />
  </button>
);

export const ToggleChip: Component<{
  title: string;
  label: string;
  active: boolean;
  onToggle: () => void;
}> = (props) => (
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
