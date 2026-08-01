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
 * Empty portal host for a dock side. Width/visibility follow open panels
 * so multiple shells can stack in a flex column (one below the other).
 *
 * @module ui/panels/DockColumn
 */

import { Component, createMemo } from 'solid-js';
import { store } from '../../store';
import { DOCK_HOST_IDS, dockColumnWidth, panelsOnDock } from './dock-layout';
import type { PanelDock } from './types';

type Side = Extract<PanelDock, 'left' | 'right' | 'bottom'>;

const HOST: Record<Side, string> = {
  left: DOCK_HOST_IDS.left,
  right: DOCK_HOST_IDS.right,
  bottom: DOCK_HOST_IDS.bottom,
};

/**
 * Dock column host — children are portaled in by {@link FloatableShell}.
 * Always in the DOM (so portals can attach); collapses when empty.
 * Width/height participate in the app flex layout so the chart area
 * shrinks between columns instead of panels overlaying the plot.
 */
export const DockColumn: Component<{ side: Side }> = (props) => {
  const ids = createMemo(() => {
    // Track full chrome map so open/dock changes re-measure the column
    void store.panelChrome;
    return panelsOnDock(props.side);
  });
  const empty = () => ids().length === 0;
  const width = createMemo(() => {
    if (props.side === 'bottom') return undefined;
    void store.panelChrome;
    return empty() ? 0 : dockColumnWidth(props.side);
  });
  const bottomHeight = createMemo(() => {
    if (props.side !== 'bottom' || empty()) return 0;
    // Sum pixel heights of open bottom panels so the main row flex-shrinks
    let sum = 0;
    for (const id of ids()) {
      const h = store.panelChrome?.[id]?.h;
      sum += typeof h === 'number' && h > 0 ? h : 160;
    }
    return sum;
  });

  return (
    <div
      id={HOST[props.side]}
      class={`axis-dock-col axis-dock-col-${props.side}`}
      classList={{ 'is-empty': empty() }}
      data-dock={props.side}
      data-dock-count={ids().length}
      style={
        empty()
          ? undefined
          : props.side === 'bottom'
            ? { height: `${bottomHeight()}px`, flex: '0 0 auto' }
            : { width: `${width()}px`, flex: '0 0 auto' }
      }
    />
  );
};

/** Float/window portal host (panels use position:fixed). */
export const FloatRoot: Component = () => (
  <div id={DOCK_HOST_IDS.float} class="axis-float-root" aria-hidden="true" />
);
