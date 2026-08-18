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
 * Price-scale toggles on the **main (price) pane** corner:
 * left of the right price scale, above the time (month) axis.
 *
 * **[A]** auto-scale · **[L]** logarithmic · **[$]** right scale labels ·
 * **[N]** series last-value labels · **[T]** plot names on those labels ·
 * **[.n]** price decimals (auto/0–8).
 *
 * Mounted via portal into the price pane DOM (`paneDomId('price')`) so volume
 * / indicator panes do not push the cluster to the host bottom-right.
 *
 * @module chart/ChartScaleControls
 */

import {
  Component,
  Show,
  createEffect,
  createSignal,
  createMemo,
  onMount,
  onCleanup,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { store, setStore, persist, setPriceScaleDecimals } from '../store';
import { applyPriceScaleDecimals, getManager } from './manager-access';
import { RIGHT_PRICE_SCALE_WIDTH } from './series-factory';
import {
  cyclePriceScaleDecimalsMode,
  normalizePriceScaleDecimalsMode,
  priceScaleDecimalsLabel,
  resolvePriceDecimals,
} from './price-precision';

/** Fallback time-axis height when LWC `timeScale().height()` is unavailable. */
const TIME_SCALE_FALLBACK_PX = 26;
/** Gap between controls and the scale gutters. */
const GUTTER_GAP_PX = 4;

/**
 * [A][L][$][N][T] cluster for the price pane — sits in the plot-area corner
 * (above time scale, left of right price scale).
 */
export const ChartScaleControls: Component = () => {
  const [autoOn, setAutoOn] = createSignal(true);
  const [logOn, setLogOn] = createSignal(false);
  const [labelsOn, setLabelsOn] = createSignal(true);
  const [namesOn, setNamesOn] = createSignal(true);
  const [titlesOn, setTitlesOn] = createSignal(true);
  /** Price pane host for portal mount (null until manager creates it). */
  const [paneEl, setPaneEl] = createSignal<HTMLElement | null>(null);
  /** Dynamic offsets so we clear the LWC time axis + price gutter. */
  const [inset, setInset] = createSignal({
    right: RIGHT_PRICE_SCALE_WIDTH + GUTTER_GAP_PX,
    bottom: TIME_SCALE_FALLBACK_PX + GUTTER_GAP_PX,
  });

  const syncFromManager = () => {
    const m = getManager();
    if (!m) {
      // Fall back to persisted preference before manager is ready
      setLabelsOn(store.priceScaleLabelsVisible !== false);
      setNamesOn(store.lastValueLabelsVisible !== false);
      setTitlesOn(store.lastValueNamesVisible !== false);
      return;
    }
    setAutoOn(m.isPriceAutoScale());
    setLogOn(m.isPriceLogScale());
    setLabelsOn(m.isPriceScaleLabelsVisible());
    setNamesOn(m.isLastValueLabelsVisible());
    setTitlesOn(m.isLastValueNamesVisible());
  };

  /** Resolve price-pane host + measure scale gutters for corner placement. */
  const measure = () => {
    const m = getManager();
    if (!m) {
      setPaneEl(null);
      return;
    }
    let el: HTMLElement | null = null;
    try {
      el = document.getElementById(m.paneDomId('price'));
    } catch {
      el = null;
    }
    setPaneEl(el);

    let timeH = TIME_SCALE_FALLBACK_PX;
    try {
      const pricePane = m.getPane?.('price');
      const ts = pricePane?.chart?.timeScale?.();
      const h = typeof ts?.height === 'function' ? Number(ts.height()) : NaN;
      if (Number.isFinite(h) && h > 0) timeH = h;
    } catch {
      /* keep fallback */
    }

    const labels = store.priceScaleLabelsVisible !== false;
    // Match PaneManager right-gutter width so we sit flush left of price labels
    const rightW = labels ? RIGHT_PRICE_SCALE_WIDTH : 0;
    setInset({
      right: rightW + GUTTER_GAP_PX,
      bottom: timeH + GUTTER_GAP_PX,
    });
  };

  onMount(() => {
    // Apply persisted label prefs as soon as manager exists
    const m = getManager();
    if (m) {
      if (store.priceScaleLabelsVisible === false) m.setPriceScaleLabelsVisible(false);
      if (store.lastValueLabelsVisible === false) m.setLastValueLabelsVisible(false);
      if (store.lastValueNamesVisible === false) m.setLastValueNamesVisible(false);
    }
    syncFromManager();
    measure();

    // Manager / panes mount slightly after ChartHost; retry a few frames
    const t0 = window.setTimeout(() => {
      syncFromManager();
      measure();
    }, 0);
    const t1 = window.setTimeout(measure, 50);
    const t2 = window.setTimeout(measure, 200);

    const onResize = () => measure();
    window.addEventListener('resize', onResize);

    // Pane height / multi-pane layout changes
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure());
      const host = document.querySelector('[data-axis-panes]');
      if (host) ro.observe(host);
    }

    onCleanup(() => {
      clearTimeout(t0);
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
    });
  });

  // Symbol/history reloads re-enable auto-scale via afterDataReload
  createEffect(() => {
    void store.chartDataGen;
    syncFromManager();
    measure();
  });

  // Labels on/off changes the right gutter — re-inset the cluster
  createEffect(() => {
    const want = store.priceScaleLabelsVisible !== false;
    const m = getManager();
    if (m && m.isPriceScaleLabelsVisible() !== want) {
      m.setPriceScaleLabelsVisible(want);
    }
    setLabelsOn(want);
    measure();
  });

  createEffect(() => {
    const want = store.lastValueLabelsVisible !== false;
    const m = getManager();
    if (m && m.isLastValueLabelsVisible() !== want) {
      m.setLastValueLabelsVisible(want);
    }
    setNamesOn(want);
  });

  createEffect(() => {
    const want = store.lastValueNamesVisible !== false;
    const m = getManager();
    if (m && m.isLastValueNamesVisible() !== want) {
      m.setLastValueNamesVisible(want);
    }
    setTitlesOn(want);
  });

  // Multi-pane layout / volume height can move the price pane
  createEffect(() => {
    void store.panes;
    void store.chartLayout?.mode;
    measure();
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

  const onLabels = () => {
    const m = getManager();
    const next = m
      ? m.togglePriceScaleLabelsVisible()
      : !(store.priceScaleLabelsVisible !== false);
    setLabelsOn(next);
    setStore('priceScaleLabelsVisible', next);
    persist();
    // Gutter width changes after LWC applies options
    queueMicrotask(() => measure());
  };

  const onNames = () => {
    const m = getManager();
    const next = m
      ? m.toggleLastValueLabelsVisible()
      : !(store.lastValueLabelsVisible !== false);
    setNamesOn(next);
    setStore('lastValueLabelsVisible', next);
    persist();
  };

  const onTitles = () => {
    const m = getManager();
    const next = m
      ? m.toggleLastValueNamesVisible()
      : !(store.lastValueNamesVisible !== false);
    setTitlesOn(next);
    setStore('lastValueNamesVisible', next);
    persist();
  };

  const decimalsMode = createMemo(() =>
    normalizePriceScaleDecimalsMode(store.priceScaleDecimals),
  );
  const decimalsEffective = createMemo(() =>
    resolvePriceDecimals(decimalsMode(), {
      symbol: store.symbol,
      bars: store.bars,
    }),
  );

  const onDecimals = () => {
    const next = cyclePriceScaleDecimalsMode(store.priceScaleDecimals);
    setPriceScaleDecimals(next);
    try {
      applyPriceScaleDecimals();
    } catch {
      /* chart optional */
    }
  };

  // Re-apply when symbol / history / mode changes (auto re-detect)
  createEffect(() => {
    void store.priceScaleDecimals;
    void store.symbol;
    void store.chartDataGen;
    try {
      applyPriceScaleDecimals();
    } catch {
      /* ignore */
    }
  });

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

  const cluster = () => (
    <div
      class="absolute z-[15] flex items-center gap-0.5 pointer-events-auto"
      style={{
        right: `${inset().right}px`,
        bottom: `${inset().bottom}px`,
      }}
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
      <button
        type="button"
        class={btnClass(labelsOn())}
        title="Show right price scale labels ($)"
        aria-pressed={labelsOn()}
        aria-label="Price scale labels"
        data-testid="axis-chart-scale-labels"
        onClick={onLabels}
      >
        $
      </button>
      <button
        type="button"
        class={btnClass(namesOn())}
        title="Show series last-value labels on the right (N)"
        aria-pressed={namesOn()}
        aria-label="Series last-value labels"
        data-testid="axis-chart-scale-names"
        onClick={onNames}
      >
        N
      </button>
      <button
        type="button"
        class={btnClass(titlesOn())}
        title="Show plot names on last-value labels (T)"
        aria-pressed={titlesOn()}
        aria-label="Plot name labels"
        data-testid="axis-chart-scale-titles"
        onClick={onTitles}
      >
        T
      </button>
      <button
        type="button"
        class={btnClass(decimalsMode() === 'auto')}
        title={
          decimalsMode() === 'auto'
            ? `Price scale decimals: auto (currently ${decimalsEffective()} from symbol/data) — click to fix 0…8`
            : `Price scale decimals: fixed ${decimalsMode()} — click to cycle (auto → 0…8)`
        }
        aria-label="Price scale decimals"
        aria-pressed={decimalsMode() === 'auto'}
        data-testid="axis-chart-scale-decimals"
        onClick={onDecimals}
      >
        .{priceScaleDecimalsLabel(decimalsMode())}
      </button>
    </div>
  );

  return (
    <Show when={paneEl()} fallback={null}>
      {(el) => (
        <Portal mount={el()}>
          {cluster()}
        </Portal>
      )}
    </Show>
  );
};
