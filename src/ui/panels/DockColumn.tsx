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
 * Empty portal host for a dock side. Width/visibility follow open panels.
 * Left/right multi-panel: side-by-side (row). Bottom: vertical stack.
 *
 * @module ui/panels/DockColumn
 */

import { type Component, createMemo } from 'solid-js';
import { store } from '../../store';
import {
  DOCK_HOST_IDS,
  OVERLAY_HOST_IDS,
  dockColumnWidth,
  panelDockLayoutHeight,
  panelsOnDock,
} from './dock-layout';
import { getHoverSlideExpandedMap } from './hover-slide';
import { isPhoneViewport, isTabletSideDockOverlay } from '../responsive';
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
 * Desktop: width/height participate in the app flex layout so the chart
 * shrinks between columns. Tablet left/right: overlay the chart (negative
 * margin, in-flow width cancelled) so the plot stays full-width.
 */
export const DockColumn: Component<{ side: Side }> = (props) => {
  const ids = createMemo(() => {
    // Track full chrome map so open/dock changes re-measure the column
    void store.panelChrome;
    // Hover-slide expand/collapse reflows column width/height
    void getHoverSlideExpandedMap();
    return panelsOnDock(props.side);
  });
  const empty = () => ids().length === 0;
  // Mobile: panels portal into the sheet host — columns collapse to zero
  // (open panels still count here, but their sheets are fixed overlays)
  const collapsed = () => isPhoneViewport();
  // Tablet: left/right overlay the chart. Phone collapse still wins.
  // Never overwrite persisted desktop geometry — overlay is layout-only.
  const overlay = () =>
    isTabletSideDockOverlay() &&
    (props.side === 'left' || props.side === 'right') &&
    !collapsed();
  const width = createMemo(() => {
    if (props.side === 'bottom') return undefined;
    if (collapsed()) return 0;
    void store.panelChrome;
    void getHoverSlideExpandedMap();
    return empty() ? 0 : dockColumnWidth(props.side);
  });
  const bottomHeight = createMemo(() => {
    if (props.side !== 'bottom' || empty()) return 0;
    if (collapsed()) return 0;
    void store.panelChrome;
    void getHoverSlideExpandedMap();
    // Sum layout heights (peek when hover-slide collapsed)
    let sum = 0;
    for (const id of ids()) {
      sum += panelDockLayoutHeight(id);
    }
    return sum;
  });

  return (
    <div
      id={HOST[props.side]}
      class={`axis-dock-col axis-dock-col-${props.side}`}
      classList={{
        'is-empty': empty(),
        'is-mobile-collapsed': collapsed() && !empty(),
        'is-tablet-overlay': overlay() && !empty(),
      }}
      data-dock={props.side}
      data-dock-count={ids().length}
      data-dock-overlay={overlay() && !empty() ? 'tablet' : undefined}
      style={
        empty()
          ? undefined
          : props.side === 'bottom'
            ? {
                height: `${bottomHeight()}px`,
                flex: '0 0 auto',
                // Smooth column size when a hover-slide panel opens/closes
                transition: 'height 0.16s ease-out',
              }
            : overlay()
              ? {
                  // Visual width from chrome; negative margin so the chart
                  // does not shrink. Overlay sits above the plot, below topbar.
                  width: `${width()}px`,
                  flex: '0 0 auto',
                  ...(props.side === 'left'
                    ? { 'margin-right': `-${width()}px` }
                    : { 'margin-left': `-${width()}px` }),
                  'z-index': '20',
                  transition: 'width 0.16s ease-out, margin 0.16s ease-out',
                }
              : {
                  width: `${width()}px`,
                  flex: '0 0 auto',
                  transition: 'width 0.16s ease-out',
                }
      }
    />
  );
};

/** Float/window portal host (panels use position:fixed). */
export const FloatRoot: Component = () => (
  <div id={DOCK_HOST_IDS.float} class="axis-float-root" aria-hidden="true" />
);

type OverlaySide = Extract<PanelDock, 'left' | 'right' | 'bottom'>;

/**
 * Inner-edge overlay host — absolute on the chart cell so overlay panels
 * keep dock layout but do not shrink the plot.
 */
export const ChartOverlayHost: Component<{ side: OverlaySide }> = (props) => (
  <div
    id={OVERLAY_HOST_IDS[props.side]}
    class={`axis-chart-overlay-host axis-chart-overlay-host-${props.side}`}
    data-overlay-dock={props.side}
    aria-hidden="true"
  />
);
