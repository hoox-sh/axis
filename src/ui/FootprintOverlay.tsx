// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Per-candle footprint cells on the active price pane (A1.3.2).
 *
 * Uses {@link approximateFootprintFromOhlcv} until a real feed lands (P1.1).
 * Visible bars only; row count scales down when many candles are on screen.
 *
 * Toggle: {@link footprintEnabled} (Layers panel).
 *
 * @module ui/FootprintOverlay
 */

import {
  type Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { store } from '../store';
import { barPlane } from '../stores/bars';
import { getManager } from '../chart/manager-access';
import { barIndexRangeForTimeWindow } from '../chart/heavy-data';
import {
  approximateFootprintFromOhlcv,
  footprintEnabled,
  footprintLayoutKey,
  footprintPaintCells,
  numTicksForPixelHeight,
} from '../chart/footprint';
import { measureChartPlotRect } from '../chart/plot-rect';
import { RIGHT_PRICE_SCALE_WIDTH } from '../chart/series-factory';

type PaintCell = {
  x: number;
  y: number;
  w: number;
  h: number;
  buy: number;
  sell: number;
  poc: boolean;
};

/** One painted candle. Identity is stable across polls when nothing changed. */
interface FpBarLayout {
  key: string;
  time: number;
  cells: PaintCell[];
  rows: number;
  delta: number;
}

interface FpLayout {
  bars: FpBarLayout[];
  width: number;
  height: number;
  top: number;
  left: number;
  source: 'approx' | 'feed';
  /** Rows on the last painted bar (badge / diagnostics). */
  rows: number;
  /** Delta of the last painted bar (badge arrow). */
  delta: number;
}

const MAX_VISIBLE_BARS = 80;
/** Reuse budget for the per-bar layout cache (≈ several screens of bars). */
const BAR_CACHE_MAX = 1024;

/**
 * Per-candle footprint cells drawn over the active price pane, aligned to the
 * chart's plot rect. Reads the current bars and renders nothing when the
 * footprint toggle is off.
 */
export const FootprintOverlay: Component = (): JSX.Element => {
  const [tick, setTick] = createSignal(0);
  const [paneBox, setPaneBox] = createSignal<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);

  let hostRef: HTMLDivElement | undefined;
  const bump = () => setTick((t) => t + 1);

  /**
   * Per-bar layout cache. The 400 ms poll (and every live tick) rebuilds the
   * memo; without this, 80 bars × ~12 rows were re-created as fresh objects and
   * Solid re-rendered every `<rect>` each time. Reusing the object when its key
   * is unchanged lets keyed `<For>` skip the whole subtree.
   */
  const barCache = new Map<string, FpBarLayout>();

  /** Live pan/zoom → immediate repaint (the 400 ms poll is the fallback). */
  let rangeUnsub: (() => void) | null = null;
  let rangeTs: unknown = null;
  const syncRangeSub = () => {
    let ts: {
      subscribeVisibleLogicalRangeChange?: (fn: () => void) => void;
      unsubscribeVisibleLogicalRangeChange?: (fn: () => void) => void;
    } | null = null;
    try {
      ts = getManager()?.getPane?.('price')?.chart?.timeScale?.() ?? null;
    } catch {
      ts = null;
    }
    if (!ts || ts === rangeTs) return;
    rangeUnsub?.();
    rangeUnsub = null;
    rangeTs = ts;
    const handler = () => bump();
    try {
      ts.subscribeVisibleLogicalRangeChange?.(handler);
      rangeUnsub = () => {
        try {
          ts.unsubscribeVisibleLogicalRangeChange?.(handler);
        } catch {
          /* chart disposed */
        }
      };
    } catch {
      /* time scale optional in tests */
    }
  };

  const measurePane = () => {
    const mgr = getManager();
    if (!mgr || !hostRef) {
      setPaneBox(null);
      return;
    }
    let paneEl: HTMLElement | null = null;
    try {
      paneEl = document.getElementById(mgr.paneDomId('price'));
    } catch {
      paneEl = null;
    }
    if (!paneEl) {
      setPaneBox(null);
      return;
    }
    const hostRect = hostRef.getBoundingClientRect();
    const paneRect = paneEl.getBoundingClientRect();
    try {
      const plot = measureChartPlotRect(mgr.getPane?.('price')?.chart, paneEl);
      setPaneBox({
        top: paneRect.top - hostRect.top,
        left: paneRect.left - hostRect.left,
        width: plot.width > 0 ? plot.width : Math.max(0, paneRect.width - RIGHT_PRICE_SCALE_WIDTH),
        height: plot.height > 0 ? plot.height : paneRect.height,
      });
      return;
    } catch {
      /* fall through */
    }
    setPaneBox({
      top: paneRect.top - hostRect.top,
      left: paneRect.left - hostRect.left,
      width: Math.max(0, paneRect.width - RIGHT_PRICE_SCALE_WIDTH),
      height: paneRect.height,
    });
  };

  onMount(() => {
    measurePane();
    syncRangeSub();
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            measurePane();
            bump();
          })
        : null;
    if (hostRef && ro) ro.observe(hostRef);
    const onVis = () => {
      measurePane();
      syncRangeSub();
      bump();
    };
    window.addEventListener('resize', onVis);
    // Fallback poll: live ticks and price autoscale changes do not fire the
    // visible-range subscription.
    const iv = window.setInterval(() => {
      if (!footprintEnabled()) return;
      measurePane();
      syncRangeSub();
      bump();
    }, 400);
    onCleanup(() => {
      ro?.disconnect();
      window.removeEventListener('resize', onVis);
      clearInterval(iv);
      rangeUnsub?.();
      rangeUnsub = null;
      rangeTs = null;
    });
  });

  createEffect(() => {
    void store.chartDataGen;
    void barPlane.length;
    void footprintEnabled();
    measurePane();
    syncRangeSub();
    bump();
  });

  const layout = createMemo((): FpLayout | null => {
    void tick();
    if (!footprintEnabled()) return null;
    const bars = barPlane.bars;
    if (!bars.length) return null;
    const box = paneBox();
    if (!box || box.height <= 0 || box.width <= 0) return null;

    const mgr = getManager();
    const chart = mgr?.getPane?.('price')?.chart;
    const series = mgr?.getPane('price')?.series['candle'];
    const ts = chart?.timeScale?.();
    if (!ts || !series) return null;

    let fromIndex = Math.max(0, bars.length - 40);
    let toIndex = bars.length - 1;
    try {
      const vr = ts.getVisibleRange?.() as { from?: number; to?: number } | null | undefined;
      if (vr && Number.isFinite(vr.from as number) && Number.isFinite(vr.to as number)) {
        const win = barIndexRangeForTimeWindow(bars, Number(vr.from), Number(vr.to));
        if (win.to > win.from) {
          fromIndex = win.from;
          toIndex = win.to - 1;
        }
      }
    } catch {
      /* keep default window */
    }

    const span = toIndex - fromIndex + 1;
    if (span > MAX_VISIBLE_BARS) {
      // Too dense for readable cells — show the rightmost window only.
      fromIndex = toIndex - MAX_VISIBLE_BARS + 1;
    }

    let barWidth = 6;
    try {
      const spacing = Number(
        (ts as { options?: () => { barSpacing?: number } }).options?.()?.barSpacing,
      );
      if (Number.isFinite(spacing) && spacing > 0) barWidth = Math.max(3, spacing * 0.85);
    } catch {
      /* default */
    }

    const priceToY = (price: number): number => {
      try {
        const y = series.priceToCoordinate?.(price);
        if (y != null && Number.isFinite(y)) return y;
      } catch {
        /* fall through */
      }
      return box.height / 2;
    };

    const painted: FpBarLayout[] = [];
    let source: 'approx' | 'feed' = 'approx';
    for (let i = fromIndex; i <= toIndex; i++) {
      const bar = bars[i];
      if (!bar) continue;
      let xCenter: number | null = null;
      try {
        const cx = ts.timeToCoordinate?.(bar.time as never);
        if (cx != null && Number.isFinite(cx)) xCenter = cx;
      } catch {
        xCenter = null;
      }
      if (xCenter == null) continue;

      // Rows fit the candle's pixel height: a fixed row count painted into a
      // 6 px body forces every cell to 1 px and spills over its neighbours.
      // Narrow bars (zoomed out) also cap the row count — 24 one-pixel rows in
      // a 4 px slot reads as noise, not volume.
      const bodyPx = Math.abs(priceToY(Number(bar.high)) - priceToY(Number(bar.low)));
      const widthCap = barWidth < 5 ? 8 : barWidth < 8 ? 12 : 24;
      const numTicks = numTicksForPixelHeight(bodyPx, { min: 3, max: widthCap });

      // Cache key: bar identity + geometry + OHLCV (the split and row
      // volumes change with the print even when the pixels do not).
      const key = footprintLayoutKey(
        {
          time: bar.time,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
        },
        {
          numTicks,
          xCenter,
          barWidth,
          yHigh: priceToY(Number(bar.high)),
          yLow: priceToY(Number(bar.low)),
        },
      );
      const cached = barCache.get(key);
      if (cached) {
        painted.push(cached);
        continue;
      }

      const fp = approximateFootprintFromOhlcv(
        {
          time: bar.time,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
        },
        { numTicks },
      );
      if (!fp) continue;
      source = fp.source;
      const entry: FpBarLayout = {
        key,
        time: bar.time,
        cells: footprintPaintCells(fp, {
          barLeft: xCenter - barWidth / 2,
          barWidth,
          priceToY,
        }),
        rows: fp.rows.length,
        delta: fp.delta,
      };
      if (barCache.size >= BAR_CACHE_MAX) barCache.clear();
      barCache.set(key, entry);
      painted.push(entry);
    }

    if (!painted.length) return null;
    const last = painted[painted.length - 1]!;
    // Badge row count = the densest painted bar (the last bar may be a doji
    // with only 3 rows, which reads as "the overlay is off").
    let maxRows = 0;
    for (const b of painted) if (b.rows > maxRows) maxRows = b.rows;
    return {
      bars: painted,
      width: box.width,
      height: box.height,
      top: box.top,
      left: box.left,
      source,
      rows: maxRows,
      delta: last.delta,
    };
  });

  return (
    <div
      ref={(el) => {
        hostRef = el;
      }}
      class="absolute inset-0 z-[7] pointer-events-none overflow-hidden"
      data-testid="axis-footprint-root"
      aria-hidden={!footprintEnabled()}
    >
      <Show when={layout()}>
        {(lay) => (
          <div
            class="absolute pointer-events-none"
            style={{
              top: `${lay().top}px`,
              left: `${lay().left}px`,
              width: `${lay().width}px`,
              height: `${lay().height}px`,
            }}
            data-testid="axis-footprint"
          >
            <svg
              width={lay().width}
              height={lay().height}
              class="absolute inset-0 overflow-hidden"
              aria-label={
                lay().source === 'feed'
                  ? 'Footprint volume cells'
                  : 'Footprint volume cells (OHLCV estimate)'
              }
            >
              {/* Keyed by bar layout object: the cache reuses identity across
                  polls, so Solid only touches bars whose geometry changed. */}
              <For each={lay().bars}>
                {(b) => (
                  <g data-bar-time={b.time}>
                    <For each={b.cells}>
                      {(c) => {
                        const total = c.buy + c.sell;
                        const buyW = total > 0 ? (c.buy / total) * c.w : 0;
                        const sellW = Math.max(0, c.w - buyW);
                        return (
                          <g>
                            {/* Mute the candle underneath so the split reads
                                even when the cell hue matches the bar. */}
                            <rect
                              x={c.x}
                              y={c.y}
                              width={Math.max(0.5, c.w)}
                              height={c.h}
                              style={{
                                fill: 'color-mix(in srgb, var(--color-bg-base) 72%, transparent)',
                              }}
                            />
                            <rect
                              x={c.x}
                              y={c.y}
                              width={Math.max(0.5, sellW)}
                              height={c.h}
                              style={{
                                fill: 'color-mix(in srgb, var(--color-down) 78%, transparent)',
                              }}
                            />
                            <rect
                              x={c.x + sellW}
                              y={c.y}
                              width={Math.max(0.5, buyW)}
                              height={c.h}
                              style={{
                                fill: 'color-mix(in srgb, var(--color-up) 78%, transparent)',
                              }}
                            />
                            <Show when={c.poc}>
                              <rect
                                x={c.x}
                                y={c.y}
                                width={c.w}
                                height={c.h}
                                fill="none"
                                style={{
                                  stroke:
                                    'color-mix(in srgb, var(--color-accent) 90%, transparent)',
                                }}
                                stroke-width={1}
                              />
                            </Show>
                          </g>
                        );
                      }}
                    </For>
                  </g>
                )}
              </For>
            </svg>
            <div
              class="absolute left-1 bottom-1 px-1 py-0.5 text-[8px] font-mono uppercase tracking-wider text-text-faint bg-bg-base/80 border border-border-soft pointer-events-none"
              data-testid="axis-footprint-badge"
              data-rows={lay().rows}
            >
              FP · {lay().source === 'feed' ? 'feed' : 'OHLCV est.'} · {lay().rows}×{' '}
              <span
                style={{
                  color: lay().delta >= 0 ? 'var(--color-up)' : 'var(--color-down)',
                }}
              >
                {lay().delta >= 0 ? '▲' : '▼'}
              </span>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
};
