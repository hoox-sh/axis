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
 * Multi-chart workspace — grid of {@link ChartHost} slots driven by
 * `store.chartLayout` (1 / 2H / 2V / 4). Active slot gets drawings/HUD tools.
 *
 * @module chart/ChartWorkspace
 */

import { Component, For, createEffect } from 'solid-js';
import { store, setActiveChartSlot } from '../store';
import { gridClassForMode } from './layout';
import { ChartHost } from './ChartHost';
import { setActiveSlotId } from './chart-registry';
import { BarReplayControls } from '../ui/BarReplayControls';

/** Root chart area for the main app shell (replaces bare ChartHost). */
export const ChartWorkspace: Component = () => {
  // Keep registry active id aligned with store (boot + external loads)
  createEffect(() => {
    const id = store.chartLayout?.activeId;
    if (id) setActiveSlotId(id);
  });

  const mode = () => store.chartLayout?.mode || '1';
  const slots = () => store.chartLayout?.slots || [];
  const activeId = () => store.chartLayout?.activeId;

  return (
    <div
      class="flex-1 min-h-0 min-w-0 relative flex flex-col"
      data-axis-chart-workspace-wrap
    >
      <div
        class={`flex-1 min-h-0 min-w-0 grid gap-[2px] bg-border ${gridClassForMode(mode())}`}
        data-axis-chart-workspace
        data-layout-mode={mode()}
      >
        <For each={slots()}>
          {(slot) => {
            const isActive = () => activeId() === slot.id;
            return (
              <div
                class={`min-h-0 min-w-0 flex flex-col relative overflow-hidden bg-bg-base ${
                  isActive() ? 'ring-1 ring-inset ring-accent/80' : 'ring-1 ring-inset ring-transparent'
                }`}
                data-chart-slot={slot.id}
                data-active={isActive() ? '1' : '0'}
                onPointerDown={() => {
                  if (!isActive()) setActiveChartSlot(slot.id);
                }}
              >
                <div class="absolute top-1 left-1 z-20 pointer-events-none">
                  <span
                    class={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 border ${
                      isActive()
                        ? 'bg-accent/20 border-accent text-accent'
                        : 'bg-bg-panel/90 border-border text-text-faint'
                    }`}
                  >
                    {slot.symbol}
                    <span class="opacity-70 ml-1">{slot.interval}</span>
                  </span>
                </div>
                <ChartHost
                  slotId={slot.id}
                  active={isActive()}
                  symbol={slot.symbol}
                  interval={slot.interval}
                />
              </div>
            );
          }}
        </For>
      </div>
      {/* Shared replay strip — only paints when a session is active */}
      <BarReplayControls />
    </div>
  );
};
