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
 * Solid **chart host** — mounts {@link PaneManager} for one layout slot.
 *
 * Used by {@link ChartWorkspace} (one instance per grid cell). Active slot
 * owns drawings + scale controls; inactive slots are view-only price/volume.
 *
 * @module chart/ChartHost
 */

import { Component, Show, createEffect, createMemo, onMount, onCleanup, untrack } from 'solid-js';
import { PaneManager } from './pane-manager';
import { DrawingToolbar } from './DrawingToolbar';
import { PineTableHud } from './PineTableHud';
import { ChartScaleControls } from './ChartScaleControls';
import { store, setCrosshair } from '../store';
import { HooxLoader } from '../ui/HooxLoader';
import {
  getManager,
  setManager,
  getDrawingLayer,
  setDrawingLayer,
  setDataToChart,
  getActiveDrawingLayer,
} from './manager-access';
import {
  getSlotBars,
  getSlotChartDataGen,
  getSlotManager,
  setActiveSlotId,
  setSlotBars,
  setSlotManager,
  disposeSlotChart,
} from './chart-registry';
import { loadSymbolData } from '../data/load-symbol';

export {
  getManager,
  getDrawingLayer,
  setDataToChart,
  getActiveDrawingLayer,
} from './manager-access';

export interface ChartHostProps {
  /** Multi-chart slot id (unique PaneManager host key). */
  slotId?: string;
  /** Whether this slot is the active (focused) chart. */
  active?: boolean;
  symbol?: string;
  interval?: string;
}

function scheduleSlotReflow(slotId?: string) {
  const run = () => {
    try {
      if (slotId) getSlotManager(slotId)?.resizeAll();
      else getManager()?.resizeAll();
    } catch {
      /* ignore */
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(run));
}

/** One chart cell: multi-pane LWC + optional drawing chrome when active. */
export const ChartHost: Component<ChartHostProps> = (props) => {
  let hostEl: HTMLDivElement | undefined;
  let panesEl: HTMLDivElement | undefined;
  let localManager: PaneManager | undefined;

  const slotId = () => props.slotId || 'main';
  const isActive = () => props.active !== false;

  const bars = createMemo(() => {
    const id = slotId();
    // Active slot mirrors store.bars for live ticks / runner
    if (isActive() && store.bars.length) return store.bars;
    return getSlotBars(id);
  });

  const emptyHint = createMemo(() => {
    if (bars().length > 0) return null;
    if (isActive() && store.status === 'loading') {
      return { title: 'Loading market data…', sub: store.statusMessage || '' };
    }
    if (isActive() && store.status === 'error') {
      return { title: 'Could not load chart', sub: store.statusMessage || 'Try again' };
    }
    const sym = props.symbol || store.symbol;
    const iv = props.interval || store.interval;
    return {
      title: 'Load data to begin',
      sub: `${sym} · ${iv} — click to focus, then press Load`,
    };
  });

  onMount(() => {
    if (!panesEl) return;
    const id = slotId();
    if (isActive()) setActiveSlotId(id);

    const manager = new PaneManager(panesEl, id === 'main' ? '' : id);
    localManager = manager;
    setSlotManager(id, manager);
    if (isActive()) setManager(manager, id);

    for (const pane of store.panes) {
      manager.createPane(pane.id, pane.type, pane.label || pane.type, pane.height || undefined);
    }
    manager.syncTimeScales();
    manager.syncCrosshair((data) => {
      if (!isActive()) return;
      const t =
        data?.time != null && Number.isFinite(Number(data.time))
          ? Number(data.time)
          : null;
      if (t == null) return;
      const bl = bars();
      let barIndex: number | null = null;
      if (bl.length) {
        const exact = bl.findIndex((b) => b.time === t);
        barIndex = exact >= 0 ? exact : null;
        if (barIndex == null) {
          let best = 0;
          let bestD = Infinity;
          for (let i = 0; i < bl.length; i++) {
            const d = Math.abs(bl[i]!.time - t);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
          barIndex = best;
        }
      }
      setCrosshair(t, barIndex);
    });

    const existing = getSlotBars(id);
    if (existing.length) {
      if (isActive()) setDataToChart(existing, { fit: true });
      else {
        // Inactive: apply directly on this manager
        try {
          const prev = getManager();
          setActiveSlotId(id);
          setManager(manager, id);
          setDataToChart(existing, { fit: true });
          // restore previous active
          const activeId = store.chartLayout?.activeId;
          if (activeId && activeId !== id) {
            setActiveSlotId(activeId);
            const am = getSlotManager(activeId);
            if (am) setManager(am, activeId);
          } else if (prev) {
            setManager(prev);
          }
        } catch {
          /* ignore */
        }
      }
    } else if (props.symbol && props.interval && !isActive()) {
      // Prefetch inactive slot history without stealing active focus
      void loadSymbolData(props.symbol, props.interval, store.source).then((ok) => {
        // loadSymbolData always writes to active — only use for active slot
        void ok;
      });
    } else if (isActive() && store.bars.length) {
      setDataToChart(store.bars, { fit: true });
      setSlotBars(id, store.bars, false);
    }

    let ro: ResizeObserver | undefined;
    if (hostEl && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => scheduleSlotReflow(id));
      ro.observe(hostEl);
    }
    const onWin = () => scheduleSlotReflow(id);
    window.addEventListener('resize', onWin);
    window.addEventListener('axis-chart-reflow', onWin);

    onCleanup(() => {
      ro?.disconnect();
      window.removeEventListener('resize', onWin);
      window.removeEventListener('axis-chart-reflow', onWin);
    });
  });

  // When this slot becomes active, register its manager as the global target
  createEffect(() => {
    const id = slotId();
    const active = isActive();
    if (!active) return;
    setActiveSlotId(id);
    const m = localManager || getSlotManager(id);
    if (m) setManager(m, id);
  });

  // Full history reloads for active slot (store.chartDataGen)
  createEffect(() => {
    if (!isActive()) return;
    const gen = store.chartDataGen;
    void gen;
    if (!getManager()) return;
    untrack(() => {
      if (store.bars.length) {
        setDataToChart(store.bars, { fit: true });
        setSlotBars(slotId(), store.bars, false);
      }
    });
  });

  // Inactive slots: react to their runtime gen if we bump it later
  createEffect(() => {
    if (isActive()) return;
    const id = slotId();
    void getSlotChartDataGen(id);
    const bl = getSlotBars(id);
    const m = getSlotManager(id);
    if (!m || !bl.length) return;
    // lightweight re-apply without stealing active manager for long
    untrack(() => {
      try {
        const price = m.getPane('price');
        if (price?.series['candle']) {
          setActiveSlotId(id);
          setManager(m, id);
          setDataToChart(bl, { fit: false, clearMarkers: false });
          const aid = store.chartLayout?.activeId;
          if (aid && aid !== id) {
            setActiveSlotId(aid);
            const am = getSlotManager(aid);
            if (am) setManager(am, aid);
          }
        }
      } catch {
        /* ignore */
      }
    });
  });

  createEffect(() => {
    if (!isActive()) return;
    const type = store.chartType;
    void type;
    if (!getManager()) return;
    untrack(() => {
      if (store.bars.length) setDataToChart(store.bars, { fit: false, clearMarkers: false });
    });
  });

  createEffect(() => {
    void store.panelChrome;
    void store.chartLayout?.mode;
    scheduleSlotReflow(slotId());
  });

  createEffect(() => {
    if (!isActive()) return;
    const tool = store.drawingTool;
    getDrawingLayer()?.setTool(tool);
  });

  onCleanup(() => {
    const id = slotId();
    if (isActive()) {
      const layer = getDrawingLayer();
      if (layer) {
        layer.destroy();
        setDrawingLayer(undefined, id);
      }
    }
    disposeSlotChart(id);
    localManager = undefined;
  });

  return (
    <div
      ref={(el) => {
        hostEl = el;
      }}
      class="flex-1 flex flex-col min-h-0 min-w-0 relative bg-bg-base h-full"
      data-axis-chart-host
      data-slot={slotId()}
      data-active={isActive() ? '1' : '0'}
    >
      <div
        ref={(el) => {
          panesEl = el;
        }}
        class="flex-1 flex flex-col min-h-0 min-w-0 w-full"
        data-axis-panes
      />
      <Show when={isActive() && bars().length > 0}>
        <DrawingToolbar />
        <PineTableHud />
        <ChartScaleControls />
      </Show>
      <Show when={emptyHint()}>
        {(hint) => (
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 z-[5] pointer-events-none px-6">
            <div
              class={`text-[11px] tracking-[0.18em] uppercase font-medium ${
                isActive() && store.status === 'error' ? 'text-red' : 'text-text-faint'
              }`}
            >
              {hint().title}
            </div>
            <Show when={hint().sub}>
              <div class="text-[11px] text-text-faint/80 font-mono text-center max-w-md">
                {hint().sub}
              </div>
            </Show>
            <Show when={isActive() && (store.status === 'loading' || store.status === 'running')}>
              <div class="mt-3">
                <HooxLoader
                  size="l"
                  layout="stack"
                  label={store.status === 'running' ? 'Running' : 'Loading'}
                />
              </div>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
};
