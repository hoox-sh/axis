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
import { VolumeProfileOverlay } from '../ui/VolumeProfileOverlay';
import {
  store,
  setCrosshair,
  setCompareBars,
  setCompareLoadState,
  clearCompareBars,
} from '../store';
import { HooxLoader } from '../ui/HooxLoader';
import {
  getManager,
  setManager,
  getDrawingLayer,
  setDrawingLayer,
  setDataToChart,
  getActiveDrawingLayer,
  applyDebugPinsToChart,
} from './manager-access';
import {
  getSlotBars,
  getSlotChartDataGen,
  getSlotManager,
  getActiveSlotId,
  setActiveSlotId,
  setSlotBars,
  setSlotManager,
  disposeSlotChart,
} from './chart-registry';
import { loadSymbolData } from '../data/load-symbol';
import { getVisibleBars, isReplayActive } from './bar-replay';
import {
  applyCompareOverlay,
  clearCompareOverlay,
  fetchCompareBars,
} from './compare-overlay';
import { reportUiError } from '../ui/boot-errors';

export {
  getManager,
  getDrawingLayer,
  setDataToChart,
  getActiveDrawingLayer,
  applyDebugPinsToChart,
  jumpToDebugPin,
} from './manager-access';

/** Helpers for consumers that need the scrubbed OHLCV prefix. */
export {
  getVisibleBars,
  isReplayActive,
  getReplayState,
  startReplaySession,
  stopReplaySession,
} from './bar-replay';

/** Bars to paint — full history, or prefix when bar replay is active. */
function barsForPaint(full: typeof store.bars) {
  return isReplayActive() ? getVisibleBars(full) : full;
}

export interface ChartHostProps {
  /** Multi-chart slot id (unique PaneManager host key). */
  slotId?: string;
  /** Whether this slot is the active (focused) chart. */
  active?: boolean;
  symbol?: string;
  interval?: string;
}

/** Paint path that never throws into Solid effects. */
function safePaint(
  bars: typeof store.bars,
  opts: { fit?: boolean; clearMarkers?: boolean },
  context: string,
) {
  try {
    setDataToChart(bars, opts);
  } catch (err: unknown) {
    // setDataToChart already reports; keep a belt-and-suspenders boundary
    reportUiError(err, { source: 'chart', context, status: true });
  }
}

/** One chart cell: multi-pane LWC + optional drawing chrome when active. */
export const ChartHost: Component<ChartHostProps> = (props) => {
  let hostEl: HTMLDivElement | undefined;
  let panesEl: HTMLDivElement | undefined;
  let localManager: PaneManager | undefined;
  /** False after host teardown — drops late rAF / RO callbacks. */
  let alive = true;
  /** Coalesced double-rAF reflow handles (cancelled on unmount). */
  let reflowRafOuter = 0;
  let reflowRafInner = 0;

  const slotId = () => props.slotId || 'main';
  const isActive = () => props.active !== false;

  const scheduleReflow = () => {
    if (!alive) return;
    // Coalesce resize storms (panel chrome, RO, window) into one double-rAF
    if (reflowRafOuter || reflowRafInner) return;
    reflowRafOuter = requestAnimationFrame(() => {
      reflowRafOuter = 0;
      if (!alive) return;
      reflowRafInner = requestAnimationFrame(() => {
        reflowRafInner = 0;
        if (!alive) return;
        try {
          // Prefer the instance this host owns — avoids resizing a recreated
          // slot manager after unmount, and skips disposed globals.
          (localManager || getSlotManager(slotId()) || getManager())?.resizeAll();
        } catch (err: unknown) {
          reportUiError(err, {
            source: 'chart',
            context: 'Chart reflow failed',
            status: false,
            throttleMs: 5000,
          });
        }
      });
    });
  };

  const cancelReflow = () => {
    if (reflowRafOuter) {
      cancelAnimationFrame(reflowRafOuter);
      reflowRafOuter = 0;
    }
    if (reflowRafInner) {
      cancelAnimationFrame(reflowRafInner);
      reflowRafInner = 0;
    }
  };

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
    alive = true;
    if (isActive()) setActiveSlotId(id);

    let manager: PaneManager;
    try {
      manager = new PaneManager(panesEl, id === 'main' ? '' : id);
    } catch (err: unknown) {
      reportUiError(err, {
        source: 'chart',
        context: 'Chart mount failed',
        status: true,
      });
      return;
    }
    localManager = manager;
    setSlotManager(id, manager);
    if (isActive()) setManager(manager, id);

    for (const pane of store.panes) {
      try {
        manager.createPane(
          pane.id,
          pane.type,
          pane.label || pane.type,
          pane.height || undefined,
        );
      } catch (err: unknown) {
        reportUiError(err, {
          source: 'chart',
          context: `Pane create failed (${pane.id})`,
          status: false,
        });
      }
    }
    // Apply persisted right-scale + series-name label prefs (chart [$] / [N])
    try {
      manager.setPriceScaleLabelsVisible(store.priceScaleLabelsVisible !== false);
      manager.setLastValueLabelsVisible(store.lastValueLabelsVisible !== false);
    } catch {
      /* label prefs optional */
    }
    // Seed theme tokens onto newly created pane charts / host backgrounds
    try {
      manager.applyChartTheme?.();
    } catch {
      /* theme optional */
    }
    try {
      manager.syncTimeScales();
    } catch {
      /* sync optional */
    }
    try {
      manager.syncCrosshair((data) => {
        if (!alive || !isActive()) return;
        const t =
          data?.time != null && Number.isFinite(Number(data.time))
            ? Number(data.time)
            : null;
        // Pointer left the chart: clear so Data Window falls back to last (live) bar
        if (t == null) {
          setCrosshair(null, null);
          return;
        }
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
    } catch (err: unknown) {
      reportUiError(err, {
        source: 'chart',
        context: 'Crosshair sync failed',
        status: false,
      });
    }

    const existing = getSlotBars(id);
    if (existing.length) {
      if (isActive()) safePaint(existing, { fit: true }, 'Initial chart paint');
      else {
        // Inactive: apply directly on this manager
        try {
          if (!alive) return;
          const prev = getManager();
          const prevActiveId =
            store.chartLayout?.activeId || getActiveSlotId() || null;
          setActiveSlotId(id);
          setManager(manager, id);
          safePaint(existing, { fit: true }, 'Inactive slot paint');
          // restore previous active (layout wins; fall back to pre-steal id)
          const activeId = store.chartLayout?.activeId || prevActiveId;
          if (activeId && activeId !== id) {
            setActiveSlotId(activeId);
            const am = getSlotManager(activeId);
            if (am) setManager(am, activeId);
          } else if (prev && prev !== manager) {
            setManager(prev);
          }
        } catch (err: unknown) {
          reportUiError(err, {
            source: 'chart',
            context: 'Inactive slot paint failed',
            status: false,
          });
        }
      }
    } else if (props.symbol && props.interval && !isActive()) {
      // Prefetch inactive slot history without stealing active focus
      const sym = props.symbol;
      const iv = props.interval;
      void loadSymbolData(sym, iv, store.source)
        .then((ok) => {
          // loadSymbolData always writes to active — only use for active slot
          if (!alive) return;
          void ok;
        })
        .catch((err: unknown) => {
          if (!alive) return;
          reportUiError(err, {
            source: 'data',
            context: 'Slot prefetch failed',
            status: false,
          });
        });
    } else if (isActive() && store.bars.length) {
      safePaint(store.bars, { fit: true }, 'Initial chart paint');
      setSlotBars(id, store.bars, false);
    }

    let ro: ResizeObserver | undefined;
    if (hostEl && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        if (alive) scheduleReflow();
      });
      ro.observe(hostEl);
    }
    const onWin = () => {
      if (alive) scheduleReflow();
    };
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
    if (!alive || !isActive()) return;
    const gen = store.chartDataGen;
    void gen;
    // setDataToChart paints via getManager() — require active binding
    if (!getManager()) return;
    untrack(() => {
      if (!alive || !store.bars.length) return;
      // Respect bar-replay cursor so reloads / paint paths don't flash full history
      safePaint(
        barsForPaint(store.bars),
        { fit: !isReplayActive() },
        'Chart data reload',
      );
      setSlotBars(slotId(), store.bars, false);
    });
  });

  // Inactive slots: react to their runtime gen if we bump it later
  createEffect(() => {
    if (!alive || isActive()) return;
    const id = slotId();
    void getSlotChartDataGen(id);
    const bl = getSlotBars(id);
    const m = localManager || getSlotManager(id);
    if (!m || !bl.length) return;
    // lightweight re-apply without stealing active manager for long
    untrack(() => {
      if (!alive) return;
      try {
        const price = m.getPane('price');
        if (price?.series['candle']) {
          const prevActiveId =
            store.chartLayout?.activeId || getActiveSlotId() || null;
          setActiveSlotId(id);
          setManager(m, id);
          safePaint(bl, { fit: false, clearMarkers: false }, 'Inactive slot re-paint');
          const aid = store.chartLayout?.activeId || prevActiveId;
          if (aid && aid !== id) {
            setActiveSlotId(aid);
            const am = getSlotManager(aid);
            if (am) setManager(am, aid);
          }
        }
      } catch (err: unknown) {
        reportUiError(err, {
          source: 'chart',
          context: 'Inactive slot re-paint failed',
          status: false,
        });
      }
    });
  });

  createEffect(() => {
    if (!alive || !isActive()) return;
    const type = store.chartType;
    void type;
    if (!getManager()) return;
    untrack(() => {
      if (!alive || !store.bars.length) return;
      safePaint(
        barsForPaint(store.bars),
        { fit: false, clearMarkers: false },
        'Chart type paint',
      );
    });
  });

  createEffect(() => {
    void store.panelChrome;
    void store.chartLayout?.mode;
    scheduleReflow();
  });

  // Chart theme (preset / overrides) + document theme → re-apply LWC options
  createEffect(() => {
    const ct = store.chartTheme;
    void ct?.presetId;
    void JSON.stringify(ct?.overrides || {});
    void store.theme;
    untrack(() => {
      try {
        localManager?.applyChartTheme?.();
      } catch {
        /* theme optional */
      }
    });
  });

  createEffect(() => {
    if (!isActive()) return;
    const tool = store.drawingTool;
    try {
      getDrawingLayer()?.setTool(tool);
    } catch (err: unknown) {
      reportUiError(err, {
        source: 'chart',
        context: 'Drawing tool apply failed',
        status: false,
      });
    }
  });

  // Pane corner badges track applied scripts (settings / eye / re-run / remove)
  createEffect(() => {
    if (!isActive()) return;
    void store.scripts;
    void store.panes;
    const mgr = getManager() || localManager;
    if (!mgr) return;
    untrack(() => {
      try {
        mgr.refreshBadges?.();
      } catch (err: unknown) {
        reportUiError(err, {
          source: 'chart',
          context: 'Pane badge refresh failed',
          status: false,
        });
      }
    });
  });

  // Debug pins from last-run logs (bar_index / time) — markers on price series
  createEffect(() => {
    if (!isActive()) return;
    void store.debugPinsEnabled;
    void store.lastRun;
    void store.chartDataGen;
    void store.bars.length;
    if (!getManager()) return;
    untrack(() => {
      try {
        applyDebugPinsToChart();
      } catch (err: unknown) {
        // applyDebugPinsToChart already reports; boundary for unexpected throws
        reportUiError(err, {
          source: 'chart',
          context: 'Debug pins effect failed',
          status: false,
        });
      }
    });
  });

  // Compare / second-symbol overlay (active slot only — multi-chart safe)
  createEffect(() => {
    if (!alive || !isActive()) return;
    const enabled = store.compare?.enabled;
    const mode = store.compare?.mode ?? 'percent';
    const normalizeMain = !!store.compare?.normalizeMain;
    const compareSym = store.compare?.symbol || '';
    const compareBars = store.compare?.bars || [];
    void store.compare?.gen;
    void store.chartDataGen;
    void store.bars.length;

    const mgr = localManager || getManager();
    if (!mgr) return;

    untrack(() => {
      if (!alive) return;
      try {
        if (!enabled || !compareSym || !compareBars.length || !store.bars.length) {
          clearCompareOverlay(mgr);
          return;
        }
        applyCompareOverlay(mgr, {
          mainBars: store.bars,
          compareBars,
          symbol: compareSym,
          mode,
          normalizeMain,
        });
      } catch (err: unknown) {
        reportUiError(err, {
          source: 'chart',
          context: 'Compare overlay failed',
          status: true,
        });
      }
    });
  });

  // Refetch compare when main interval/source/history reloads while enabled
  createEffect(() => {
    if (!alive || !isActive()) return;
    if (!store.compare?.enabled) return;
    const sym = (store.compare.symbol || '').trim().toUpperCase();
    if (!sym) return;
    const interval = store.interval;
    const source = store.source;
    void store.historyBars;
    void store.chartDataGen;

    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });

    untrack(() => {
      if (!alive || !store.bars.length) return;
      if (sym === store.symbol.toUpperCase()) return;
      setCompareLoadState({ loading: true, error: null });
      void fetchCompareBars(sym, interval, source)
        .then((bars) => {
          if (cancelled || !alive) return;
          if (!store.compare.enabled || store.compare.symbol.toUpperCase() !== sym) return;
          setCompareBars(bars);
        })
        .catch((err: unknown) => {
          if (cancelled || !alive) return;
          const msg = err instanceof Error ? err.message : String(err);
          setCompareLoadState({ loading: false, error: msg });
          clearCompareBars();
        });
    });
  });

  onCleanup(() => {
    const id = slotId();
    const owned = localManager;
    alive = false;
    cancelReflow();

    // Optional subsystems first (need live LWC charts).
    try {
      if (isActive() || getActiveSlotId() === id) {
        const layer = getDrawingLayer();
        if (layer) {
          try {
            layer.destroy();
          } catch {
            /* ignore */
          }
          setDrawingLayer(undefined, id);
        }
      }
      try {
        clearCompareOverlay(owned);
      } catch {
        /* ignore */
      }
    } catch {
      /* ignore */
    }

    // disposeSlotChart nulls the registry entry *before* calling dispose(), so
    // getSlotManager is already clean mid-teardown. Clear legacy/theme after.
    disposeSlotChart(id);
    // Drop getManager() module fallback when this host owned the active manager
    // (avoids zombie after activeSlotId is later cleared).
    if (
      getActiveSlotId() === id ||
      isActive() ||
      (owned != null && getManager() === owned)
    ) {
      setManager(undefined, id);
    }
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
        <VolumeProfileOverlay />
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
