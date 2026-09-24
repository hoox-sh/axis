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
 * Drawing-toolbar dock menu — placement picker for the rail handle.
 *
 * @module chart/drawings/toolbar/dock-menu
 */

import type { Component } from 'solid-js';
import type { ToolbarDock } from './chrome';

export const DockMenu: Component<{
  dock: ToolbarDock;
  slideChecked: boolean;
  slideDisabled?: boolean;
  onDock: (dock: ToolbarDock) => void;
  onFree: () => void;
  onSlide: (checked: boolean) => void;
}> = (props) => (
  <div class="axis-draw-menu" role="menu" aria-label="Drawing toolbar placement">
    <button
      type="button"
      role="menuitemradio"
      aria-checked={props.dock === 'left'}
      classList={{ 'is-active': props.dock === 'left' }}
      onClick={() => props.onDock('left')}
    >
      Dock left
    </button>
    <button
      type="button"
      role="menuitemradio"
      aria-checked={props.dock === 'top'}
      classList={{ 'is-active': props.dock === 'top' }}
      onClick={() => props.onDock('top')}
    >
      Dock top
    </button>
    <button
      type="button"
      role="menuitemradio"
      aria-checked={props.dock === 'float'}
      classList={{ 'is-active': props.dock === 'float' }}
      onClick={props.onFree}
    >
      Free position
    </button>
    <label class="axis-draw-menu-check" classList={{ 'is-disabled': !!props.slideDisabled }}>
      <input
        type="checkbox"
        checked={props.slideChecked}
        disabled={props.slideDisabled}
        onChange={(e) => props.onSlide(e.currentTarget.checked)}
      />
      Slide in
    </label>
  </div>
);
