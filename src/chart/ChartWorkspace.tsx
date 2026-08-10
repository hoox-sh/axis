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
import { Icons } from '../ui/icons';
import {
  toggleBrowserFullscreen,
  toggleChartOnlyMode,
  exitBrowserFullscreen,
  setChartOnlyMode,
} from '../ui/presentation';

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

  const fsOn = () => !!store.presentation?.fullscreen;
  const chartOnly = () => !!store.presentation?.chartOnly;

  const exitAllPresentation = () => {
    setChartOnlyMode(false);
    if (fsOn()) void exitBrowserFullscreen();
  };

  return (
    <div
      class="flex-1 min-h-0 min-w-0 relative flex flex-col"
      data-axis-chart-workspace-wrap
      data-chart-only={chartOnly() ? '1' : '0'}
    >
      {/* Presentation controls — always available on chart; essential when
          chart-only hides the topbar. Top-right, above slot badges / rail. */}
      <div
        class="absolute top-1.5 right-1.5 z-[40] flex items-center gap-0.5 pointer-events-auto"
        data-testid="axis-presentation-controls"
        role="group"
        aria-label="Presentation controls"
      >
        <Show when={chartOnly()}>
          <button
            type="button"
            class="sc-btn sc-btn-ghost sc-btn-icon min-w-[1.75em] h-[1.75em] bg-bg-panel/90 border-2 border-border text-text-dim hover:text-text hover:border-border-focus"
            title="Exit chart only (Esc)"
            aria-label="Exit chart only"
            data-testid="axis-btn-exit-chart-only"
            onClick={exitAllPresentation}
          >
            <Icons.x />
          </button>
        </Show>
        <button
          type="button"
          class={`sc-btn sc-btn-ghost sc-btn-icon min-w-[1.75em] h-[1.75em] border-2 ${
            fsOn()
              ? 'bg-accent/20 border-accent text-accent'
              : 'bg-bg-panel/90 border-border text-text-dim hover:text-text hover:border-border-focus'
          }`}
          title={fsOn() ? 'Exit fullscreen (F11)' : 'Fullscreen (F11)'}
          aria-pressed={fsOn()}
          aria-label="Toggle fullscreen"
          data-testid="axis-chart-btn-fullscreen"
          onClick={() => void toggleBrowserFullscreen()}
        >
          <Icons.fullscreen />
        </button>
        <button
          type="button"
          class={`sc-btn sc-btn-ghost sc-btn-icon min-w-[1.75em] h-[1.75em] border-2 ${
            chartOnly()
              ? 'bg-accent/20 border-accent text-accent'
              : 'bg-bg-panel/90 border-border text-text-dim hover:text-text hover:border-border-focus'
          }`}
          title={
            chartOnly()
              ? 'Exit chart only (Shift+F / Esc)'
              : 'Chart only — hide chrome (Shift+F)'
          }
          aria-pressed={chartOnly()}
          aria-label="Toggle chart-only mode"
          data-testid="axis-chart-btn-chart-only"
          onClick={() => toggleChartOnlyMode()}
        >
          {chartOnly() ? <Icons.minimize /> : <Icons.maximize />}
        </button>
      </div>

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
