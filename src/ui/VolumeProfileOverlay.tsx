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
 * Right-side volume profile histogram + numeric summary on the active chart.
 *
 * Uses {@link computeVolumeProfile} (OHLCV approximation). Y placement tries
 * the live price series via {@link getManager}; falls back to a linear map of
 * the profile price range when the scale is unavailable.
 *
 * Toggle: {@link volumeProfileEnabled} (shared with Layers panel).
 *
 * @module ui/VolumeProfileOverlay
 */

import {
  Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { store } from '../store';
import { getManager } from '../chart/manager-access';
import {
  computeVolumeProfile,
  formatVpPrice,
  formatVpVolume,
  volumeProfileEnabled,
  type VolumeProfileResult,
} from '../chart/volume-profile';
import { RIGHT_PRICE_SCALE_WIDTH } from '../chart/series-factory';

const HIST_WIDTH = 88;

interface LayoutBin {
  yTop: number;
  yBot: number;
  volume: number;
  inVa: boolean;
  isPoc: boolean;
}

interface VpLayout {
  bins: LayoutBin[];
  maxVol: number;
  height: number;
  top: number;
  profile: VolumeProfileResult;
}

/**
 * Price-pane aligned volume profile strip (histogram + POC/VA summary).
 * Mounted by ChartHost when bars exist; renders only when toggle is on.
 */
export const VolumeProfileOverlay: Component = () => {
  const [tick, setTick] = createSignal(0);
  const [paneBox, setPaneBox] = createSignal<{
    top: number;
    height: number;
  } | null>(null);

  let hostRef: HTMLDivElement | undefined;

  const bump = () => setTick((t) => t + 1);

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
    setPaneBox({
      top: paneRect.top - hostRect.top,
      height: paneRect.height,
    });
  };

  onMount(() => {
    measurePane();
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
      bump();
    };
    window.addEventListener('resize', onVis);
    // LWC visible range / scale changes — light poll while enabled
    const iv = window.setInterval(() => {
      if (!volumeProfileEnabled()) return;
      measurePane();
      bump();
    }, 400);
    onCleanup(() => {
      ro?.disconnect();
      window.removeEventListener('resize', onVis);
      clearInterval(iv);
    });
  });

  createEffect(() => {
    void store.chartDataGen;
    void store.bars.length;
    void volumeProfileEnabled();
    measurePane();
    bump();
  });

  const layout = createMemo((): VpLayout | null => {
    void tick();
    if (!volumeProfileEnabled()) return null;
    const bars = store.bars;
    if (!bars.length) return null;
    const profile = computeVolumeProfile(bars, { mode: 'uniform', rows: 24 });
    const box = paneBox();
    if (!profile.bins.length || !box || box.height <= 0) return null;

    const height = box.height;
    const mgr = getManager();
    const series = mgr?.getPane('price')?.series['candle'];

    const priceToY = (price: number): number | null => {
      if (series && typeof series.priceToCoordinate === 'function') {
        try {
          const y = series.priceToCoordinate(price);
          if (y != null && Number.isFinite(y)) return y;
        } catch {
          /* fall through */
        }
      }
      return null;
    };

    const pMin = profile.bins[0]!.priceLow;
    const pMax = profile.bins[profile.bins.length - 1]!.priceHigh;
    const span = pMax - pMin || 1;
    const linearY = (price: number) => ((pMax - price) / span) * height;

    let maxVol = 0;
    const bins: LayoutBin[] = [];
    for (let i = 0; i < profile.bins.length; i++) {
      const b = profile.bins[i]!;
      if (b.volume > maxVol) maxVol = b.volume;
      let yTop = priceToY(b.priceHigh);
      let yBot = priceToY(b.priceLow);
      if (yTop == null || yBot == null) {
        yTop = linearY(b.priceHigh);
        yBot = linearY(b.priceLow);
      }
      if (yTop > yBot) {
        const t = yTop;
        yTop = yBot;
        yBot = t;
      }
      const inVa =
        profile.vaLow != null &&
        profile.vaHigh != null &&
        b.priceLow >= profile.vaLow - 1e-12 &&
        b.priceHigh <= profile.vaHigh + 1e-12;
      bins.push({
        yTop,
        yBot,
        volume: b.volume,
        inVa,
        isPoc: i === profile.pocIndex,
      });
    }

    return {
      bins,
      maxVol: maxVol || 1,
      height,
      top: box.top,
      profile,
    };
  });

  const pocY = createMemo(() => {
    const lay = layout();
    if (!lay || lay.profile.pocIndex < 0) return null;
    const b = lay.bins[lay.profile.pocIndex];
    if (!b) return null;
    return (b.yTop + b.yBot) / 2;
  });

  return (
    <div
      ref={(el) => {
        hostRef = el;
      }}
      class="absolute inset-0 z-[8] pointer-events-none overflow-hidden"
      data-testid="axis-volume-profile-root"
      aria-hidden={!volumeProfileEnabled()}
    >
      <Show when={layout()}>
        {(lay) => (
          <div
            class="absolute pointer-events-none"
            style={{
              top: `${lay().top}px`,
              height: `${lay().height}px`,
              right: `${RIGHT_PRICE_SCALE_WIDTH + 4}px`,
              width: `${HIST_WIDTH}px`,
            }}
            data-testid="axis-volume-profile"
          >
            <svg
              width={HIST_WIDTH}
              height={lay().height}
              class="absolute inset-0 overflow-visible"
              aria-label="Volume profile histogram (OHLCV estimate)"
            >
              <For each={lay().bins}>
                {(b) => {
                  const h = Math.max(1, b.yBot - b.yTop - 0.5);
                  const w =
                    b.volume > 0
                      ? Math.max(2, (b.volume / lay().maxVol) * (HIST_WIDTH - 4))
                      : 0;
                  const x = HIST_WIDTH - w;
                  const fill = b.isPoc
                    ? 'rgba(147, 159, 255, 0.75)'
                    : b.inVa
                      ? 'rgba(147, 159, 255, 0.38)'
                      : 'rgba(139, 142, 156, 0.22)';
                  return (
                    <rect
                      x={x}
                      y={b.yTop}
                      width={w}
                      height={h}
                      fill={fill}
                      stroke={b.isPoc ? 'rgba(147, 159, 255, 0.9)' : 'none'}
                      stroke-width={b.isPoc ? 1 : 0}
                    />
                  );
                }}
              </For>
              <Show when={pocY() != null}>
                <line
                  x1={0}
                  x2={HIST_WIDTH}
                  y1={pocY()!}
                  y2={pocY()!}
                  stroke="rgba(147, 159, 255, 0.85)"
                  stroke-width={1}
                  stroke-dasharray="3 2"
                />
              </Show>
            </svg>

            <div
              class="absolute left-0 right-0 bottom-1 px-0.5 pointer-events-none"
              data-testid="axis-volume-profile-summary"
            >
              <div class="bg-bg-base/90 border border-border-soft px-1 py-0.5 text-[9px] font-mono leading-tight text-text-dim">
                <div class="text-text-faint uppercase tracking-wider text-[8px] mb-0.5">
                  VP · OHLCV est.
                </div>
                <div>
                  <span class="text-text-faint">POC</span>{' '}
                  <span class="text-accent">
                    {formatVpPrice(lay().profile.poc ?? NaN)}
                  </span>
                </div>
                <div>
                  <span class="text-text-faint">VA</span>{' '}
                  <span class="text-text">
                    {formatVpPrice(lay().profile.vaLow ?? NaN)}–
                    {formatVpPrice(lay().profile.vaHigh ?? NaN)}
                  </span>
                </div>
                <div>
                  <span class="text-text-faint">Σ</span>{' '}
                  <span class="text-text">
                    {formatVpVolume(lay().profile.totalVolume)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
};
