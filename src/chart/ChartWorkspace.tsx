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

import { Component, For, Show, createEffect } from 'solid-js';
import { store, setActiveChartSlot } from '../store';
import { gridClassForMode } from './layout';
import { ChartHost } from './ChartHost';
import { setActiveSlotId } from './chart-registry';
import { BarReplayControls } from '../ui/BarReplayControls';
import { onchainManagerState } from '../onchain/manager';

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
  /** Attached on-chain series count (price-pane overlays; subtle chrome only). */
  const onchainCount = () => onchainManagerState.series?.length ?? 0;

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
            // Stable per-slot host: Solid reuses by list index; slot.id is the
            // PaneManager key. Layout mode changes that keep the same slot id
            // must not remount LWC (ChartHost only mounts once per host instance).
            const isActive = () => activeId() === slot.id;
            const slotTitle = () => {
              const n = onchainCount();
              const base = `${slot.symbol} · ${slot.interval}`;
              return n > 0 ? `${base} · onchain:${n}` : base;
            };
            return (
              <div
                class={`min-h-0 min-w-0 flex flex-col relative overflow-hidden bg-bg-base ${
                  isActive() ? 'ring-1 ring-inset ring-accent/80' : 'ring-1 ring-inset ring-transparent'
                }`}
                data-chart-slot={slot.id}
                data-active={isActive() ? '1' : '0'}
                onPointerDown={() => {
                  if (!isActive()) {
                    try {
                      setActiveChartSlot(slot.id);
                    } catch {
                      /* store update must not kill workspace */
                    }
                  }
                }}
              >
                {/* Market title — sole top-left identity chip.
                    Price pane script badges sit on the same top row, offset right
                    of the drawing rail (see index.css). Bare "PRICE" suppressed.
                    When on-chain series are attached, append subtle · onchain:N. */}
                <div
                  class="absolute top-1 left-1.5 z-[32] pointer-events-none max-w-[min(100%-3rem,20rem)]"
                  data-axis-slot-badge
                >
                  <span
                    class={`axis-slot-badge ${isActive() ? 'is-active' : ''}`}
                    title={slotTitle()}
                  >
                    {slot.symbol}
                    <span class="axis-slot-tf">{slot.interval}</span>
                    <Show when={onchainCount() > 0}>
                      <span
                        class="axis-slot-onchain"
                        data-testid="axis-slot-onchain-count"
                        data-onchain-count={String(onchainCount())}
                      >
                        · onchain:{onchainCount()}
                      </span>
                    </Show>
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
