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
 * Chart layout menu — grid mode (1 / 2H / 2V / 4) + named save/load.
 *
 * @module ui/ChartLayoutMenu
 */

import { Component, For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import {
  store,
  setChartGridMode,
  saveChartLayout,
  loadChartLayout,
  deleteChartLayout,
} from '../store';
import { CHART_GRID_MODES, type ChartGridMode } from '../chart/layout';
import { Icons } from './icons';
import { loadSymbolData } from '../data/load-symbol';
import { getSlotBars } from '../chart/chart-registry';

/** Compact topbar control for multi-chart layouts and named snapshots. */
export const ChartLayoutMenu: Component = () => {
  const [open, setOpen] = createSignal(false);
  const [saveName, setSaveName] = createSignal('');
  let rootEl: HTMLDivElement | undefined;

  onMount(() => {
    const onDoc = (e: PointerEvent) => {
      if (!open()) return;
      const t = e.target as Node;
      if (rootEl && !rootEl.contains(t)) setOpen(false);
    };
    // Auto-load when a slot is focused and has no bars yet
    const onSlot = (e: Event) => {
      const slotId = (e as CustomEvent).detail?.slotId as string | undefined;
      if (!slotId) return;
      if (getSlotBars(slotId).length) return;
      const slot = store.chartLayout?.slots?.find((s) => s.id === slotId);
      if (!slot) return;
      void loadSymbolData(slot.symbol, slot.interval, store.source);
    };
    document.addEventListener('pointerdown', onDoc, true);
    window.addEventListener('axis-slot-activate', onSlot);
    onCleanup(() => {
      document.removeEventListener('pointerdown', onDoc, true);
      window.removeEventListener('axis-slot-activate', onSlot);
    });
  });

  const mode = () => store.chartLayout?.mode || '1';
  const saved = () => store.savedLayouts || [];

  const pickMode = (m: ChartGridMode) => {
    setChartGridMode(m);
    setOpen(false);
  };

  const onSave = () => {
    const name = saveName().trim() || `Layout ${new Date().toLocaleString()}`;
    saveChartLayout(name);
    setSaveName('');
  };

  const onLoad = (id: string) => {
    if (loadChartLayout(id)) {
      setOpen(false);
      // Load bars for active slot after layout restore
      const slot = store.chartLayout?.slots?.find((s) => s.id === store.chartLayout.activeId);
      if (slot) void loadSymbolData(slot.symbol, slot.interval, store.source);
    }
  };

  return (
    <div class="relative" ref={rootEl} data-testid="axis-chart-layout-menu">
      <button
        type="button"
        class={`sc-btn sc-btn-ghost ${open() ? 'text-accent' : ''}`}
        title="Chart layouts — multi-chart grid and saved layouts"
        aria-expanded={open()}
        aria-haspopup="menu"
        data-testid="axis-btn-layouts"
        onClick={() => setOpen((o) => !o)}
      >
        <Icons.layers />
        <span class="hidden sm:inline">Layouts</span>
        <span class="font-mono text-[10px] opacity-80 ml-0.5">{mode()}</span>
      </button>

      <Show when={open()}>
        <div
          class="absolute right-0 top-full mt-1 z-[200] w-[min(320px,calc(100vw-24px))] bg-bg-panel border-2 border-border shadow-[0_8px_28px_rgba(0,0,0,0.45)] p-2 flex flex-col gap-2"
          role="menu"
          aria-label="Chart layouts"
        >
          <div class="text-[10px] uppercase tracking-wider text-text-faint font-semibold px-0.5">
            Grid
          </div>
          <div class="grid grid-cols-4 gap-1">
            <For each={[...CHART_GRID_MODES]}>
              {(m) => (
                <button
                  type="button"
                  role="menuitem"
                  class={`sc-btn py-2 text-[11px] font-mono ${
                    mode() === m.id ? 'border-accent text-accent bg-accent/10' : ''
                  }`}
                  title={m.hint}
                  data-testid={`axis-layout-mode-${m.id}`}
                  onClick={() => pickMode(m.id)}
                >
                  {m.label}
                </button>
              )}
            </For>
          </div>
          <p class="text-[10px] text-text-faint px-0.5 leading-snug">
            Click a chart to focus it. Topbar symbol / Load / Run apply to the active chart.
          </p>

          <div class="border-t border-border-soft pt-2 mt-0.5">
            <div class="text-[10px] uppercase tracking-wider text-text-faint font-semibold px-0.5 mb-1">
              Saved layouts
            </div>
            <div class="flex gap-1 mb-1.5">
              <input
                class="sc-input flex-1 min-w-0 text-[11px]"
                placeholder="Name this layout…"
                value={saveName()}
                onInput={(e) => setSaveName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSave();
                }}
                data-testid="axis-layout-save-name"
              />
              <button
                type="button"
                class="sc-btn sc-btn-primary px-2"
                title="Save current grid + panel chrome"
                data-testid="axis-layout-save"
                onClick={onSave}
              >
                Save
              </button>
            </div>
            <Show
              when={saved().length > 0}
              fallback={
                <div class="text-[10px] text-text-faint px-0.5 py-1">No saved layouts yet.</div>
              }
            >
              <ul class="max-h-[180px] overflow-y-auto flex flex-col gap-0.5">
                <For each={saved()}>
                  {(lay) => (
                    <li class="flex items-center gap-1 group">
                      <button
                        type="button"
                        class="sc-btn sc-btn-ghost flex-1 justify-start text-left text-[11px] min-w-0"
                        title={`Load “${lay.name}”`}
                        onClick={() => onLoad(lay.id)}
                      >
                        <span class="truncate">{lay.name}</span>
                        <span class="font-mono text-[9px] text-text-faint ml-1 flex-shrink-0">
                          {lay.chartLayout?.mode || '1'}
                        </span>
                      </button>
                      <button
                        type="button"
                        class="sc-btn sc-btn-ghost px-1 opacity-60 hover:opacity-100 hover:text-red"
                        title="Delete layout"
                        aria-label={`Delete ${lay.name}`}
                        onClick={() => deleteChartLayout(lay.id)}
                      >
                        <Icons.x />
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
};
