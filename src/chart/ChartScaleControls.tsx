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
 * Price-scale toggles on the main chart (bottom-right of price pane):
 * **[A]** auto-scale · **[L]** logarithmic.
 *
 * @module chart/ChartScaleControls
 */

import { Component, createEffect, createSignal, onMount, onCleanup } from 'solid-js';
import { store } from '../store';
import { getManager } from './manager-access';

/**
 * Bottom-right [A]/[L] control cluster for the price pane.
 * Syncs local active state from {@link PaneManager} when available.
 */
export const ChartScaleControls: Component = () => {
  const [autoOn, setAutoOn] = createSignal(true);
  const [logOn, setLogOn] = createSignal(false);

  const syncFromManager = () => {
    const m = getManager();
    if (!m) return;
    setAutoOn(m.isPriceAutoScale());
    setLogOn(m.isPriceLogScale());
  };

  onMount(() => {
    syncFromManager();
    // Manager is created in ChartHost onMount — poll once after layout.
    const t = window.setTimeout(syncFromManager, 0);
    onCleanup(() => clearTimeout(t));
  });

  // Symbol/history reloads re-enable auto-scale via afterDataReload
  createEffect(() => {
    void store.chartDataGen;
    syncFromManager();
  });

  const onAuto = () => {
    const m = getManager();
    if (!m) return;
    setAutoOn(m.togglePriceAutoScale());
  };

  const onLog = () => {
    const m = getManager();
    if (!m) return;
    setLogOn(m.togglePriceLogScale());
  };

  const btnClass = (active: boolean) =>
    [
      'min-w-[1.65em] h-[1.65em] px-1',
      'font-mono text-[11px] font-semibold leading-none',
      'border-2 select-none',
      'transition-colors',
      active
        ? 'bg-accent/20 border-accent text-accent'
        : 'bg-bg-panel/90 border-border text-text-dim hover:border-border-focus hover:text-text',
    ].join(' ');

  return (
    <div
      class="absolute bottom-2 right-2 z-[15] flex items-center gap-0.5 pointer-events-auto"
      data-testid="axis-chart-scale-controls"
      role="group"
      aria-label="Price scale controls"
    >
      <button
        type="button"
        class={btnClass(autoOn())}
        title="Auto scale price axis (A)"
        aria-pressed={autoOn()}
        aria-label="Auto scale"
        data-testid="axis-chart-scale-auto"
        onClick={onAuto}
      >
        A
      </button>
      <button
        type="button"
        class={btnClass(logOn())}
        title="Logarithmic price scale (L)"
        aria-pressed={logOn()}
        aria-label="Logarithmic scale"
        data-testid="axis-chart-scale-log"
        onClick={onLog}
      >
        L
      </button>
    </div>
  );
};
