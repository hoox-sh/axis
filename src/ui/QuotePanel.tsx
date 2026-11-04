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
 * Quote panel — full quote sheet for the current symbol: price + trend,
 * 24h change / range, last-bar OHLCV, tick time, venue.
 *
 * Rows from {@link buildQuoteRows} using `store.bars`, `telemetry.lastTick`,
 * and a REST 24h seed for the change row. FloatableShell id `quote`
 * (docks right, stacks multirow with other right-dock panels).
 *
 * The hero block shows the live price, a 24h change chip, and a range bar
 * with the current price marked; the last bar is split into O/H/L/C tiles.
 */

import {
  type Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from 'solid-js';
import { store, isPanelOpen } from '../store';
import { barPlane } from '../stores/bars';
import { FloatableShell } from './panels/FloatableShell';
import { Icons } from './icons';
import { copyToClipboard } from './clipboard';
import { fetchWatchlistTickers } from '../data/watchlist-tickers';
import {
  buildQuoteRows,
  displayedLastPrice,
  formatCompactVolume,
  quoteStats,
  type QuoteInput,
} from './extras/quote';
import { formatExtraPrice } from './extras/format';

/** Full quote sheet dock panel for the current symbol. */
export const QuotePanel: Component = () => {
  const [change24h, setChange24h] = createSignal<number | undefined>(undefined);
  const [copied, setCopied] = createSignal(false);
  let copyTimer: number | undefined;

  // REST seed for the 24h change row (builder falls back to day-bar math).
  createEffect(() => {
    const sym = store.symbol;
    const src = store.source;
    if (!sym) return;
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    void fetchWatchlistTickers([sym], src)
      .then((seed) => {
        if (cancelled) return;
        const t = seed[sym];
        setChange24h(t && Number.isFinite(t.change) ? t.change : undefined);
      })
      .catch(() => {
        if (!cancelled) setChange24h(undefined);
      });
  });

  onCleanup(() => {
    if (copyTimer) window.clearTimeout(copyTimer);
  });

  const input = createMemo((): QuoteInput | null => {
    if (!isPanelOpen('quote')) return null;
    void barPlane.length;
    void store.chartDataGen;
    void store.telemetry?.lastTick;
    void store.telemetry?.stream?.state;
    void store.symbol;
    void store.interval;
    const tick = store.telemetry?.lastTick;
    const bars = barPlane.bars;
    const tip = barPlane.tip;
    const last = tip ?? (bars.length ? bars[bars.length - 1] : null);
    // Live tick is stream-scoped: ignore it when it belongs to a previous
    // symbol (symbol switch before the first new tick arrives).
    const tickPrice =
      tick &&
      (tick.symbol === undefined || tick.symbol === store.symbol) &&
      Number.isFinite(tick.price)
        ? (tick.price as number)
        : NaN;
    const barClose = last && Number.isFinite(last.close) ? (last.close as number) : NaN;
    const streamState = store.telemetry?.stream?.state;
    const price = displayedLastPrice({ tickPrice, barClose, streamState });
    const showTick = streamState == null || streamState === 'open';
    const venue =
      store.provider?.venue &&
      store.provider.venue !== 'generic' &&
      store.provider.venue !== 'cache'
        ? store.provider.venue
        : store.exchange;
    return {
      symbol: store.symbol,
      venue,
      bars,
      lastPrice: price,
      lastTickAt: showTick && tick && Number.isFinite(tick.at) ? (tick.at as number) : null,
      change24h: change24h(),
    };
  });

  const stats = createMemo(() => {
    const i = input();
    return i ? quoteStats(i) : null;
  });

  const rows = createMemo(() => {
    const i = input();
    return i ? buildQuoteRows(i) : [];
  });

  const liveState = () => store.telemetry?.stream?.state ?? 'idle';
  const isLive = () => liveState() === 'open' || liveState() === 'idle';

  const changeText = createMemo(() => {
    const c = stats()?.change;
    if (c == null || !Number.isFinite(c)) return '—';
    return `${c >= 0 ? '+' : ''}${c.toFixed(1)}%`;
  });

  const rangePct = createMemo(() => {
    const s = stats();
    if (!s || !Number.isFinite(s.high24) || !Number.isFinite(s.low24)) return 50;
    const span = s.high24 - s.low24;
    if (span <= 0) return 50;
    return Math.max(0, Math.min(100, ((s.price - s.low24) / span) * 100));
  });

  const ohlc = createMemo(() => {
    const last = stats()?.last;
    if (!last) return [];
    return [
      { id: 'o', label: 'O', value: last.open },
      { id: 'h', label: 'H', value: last.high },
      { id: 'l', label: 'L', value: last.low },
      { id: 'c', label: 'C', value: last.close },
    ];
  });

  const copyQuote = async () => {
    const s = stats();
    if (!s) return;
    const text = `${store.symbol} ${formatExtraPrice(s.price)} ${changeText()}`;
    if (await copyToClipboard(text)) {
      setCopied(true);
      if (copyTimer) window.clearTimeout(copyTimer);
      copyTimer = window.setTimeout(() => setCopied(false), 1400);
    }
  };

  return (
    <Show when={isPanelOpen('quote')}>
      <FloatableShell id="quote" testId="axis-quote">
        <div class="ax-quote flex flex-col flex-1 min-h-0">
          <Show
            when={barPlane.length > 0 && stats()}
            fallback={
              <div class="ax-quote-empty" data-testid="axis-quote-empty">
                <span class="ax-quote-empty-icon">
                  <Icons.activity size={18} />
                </span>
                <p class="ax-quote-empty-title">No data loaded</p>
                <p class="ax-quote-empty-sub">Load a symbol to see its quote sheet.</p>
              </div>
            }
          >
            <div class="ax-quote-scroll">
              <div class="ax-quote-hero">
                <div class="ax-quote-hero-top">
                  <span class="ax-quote-symbol" title="Chart symbol">
                    {store.symbol}
                  </span>
                  <span class="ax-quote-venue" title="Venue">
                    {stats()?.last ? store.provider?.venue || store.exchange : '—'}
                  </span>
                  <span class="ax-quote-spacer" />
                  <span
                    class="ax-quote-live"
                    classList={{ 'is-live': isLive() }}
                    title={`Stream state: ${liveState()}`}
                  >
                    <span class="ax-quote-live-dot" />
                    {liveState()}
                  </span>
                  <button
                    type="button"
                    class="ax-quote-icon"
                    classList={{ 'is-copied': copied() }}
                    title="Copy symbol, price, and 24h change"
                    aria-label="Copy quote"
                    data-testid="axis-quote-copy"
                    onClick={() => void copyQuote()}
                  >
                    {copied() ? <Icons.check size={11} /> : <Icons.copy size={11} />}
                  </button>
                </div>

                <div class="ax-quote-price-row">
                  <span
                    class="ax-quote-price"
                    classList={{
                      'is-up': stats()?.trend === 'up',
                      'is-down': stats()?.trend === 'down',
                    }}
                    data-testid="axis-quote-price"
                  >
                    {formatExtraPrice(stats()?.price ?? NaN)}
                  </span>
                  <span
                    class="ax-quote-change"
                    classList={{
                      'is-up': (stats()?.change ?? 0) >= 0,
                      'is-down': (stats()?.change ?? 0) < 0,
                    }}
                    data-testid="axis-quote-change"
                  >
                    {changeText()}
                  </span>
                </div>

                <div class="ax-quote-range">
                  <div class="ax-quote-range-head">
                    <span>24h range</span>
                    <span class="ax-quote-range-vals">
                      {formatExtraPrice(stats()?.low24 ?? NaN)}
                      <span class="ax-quote-range-sep">–</span>
                      {formatExtraPrice(stats()?.high24 ?? NaN)}
                    </span>
                  </div>
                  <div class="ax-quote-range-track" aria-hidden="true">
                    <span class="ax-quote-range-marker" style={{ left: `${rangePct()}%` }} />
                  </div>
                </div>
              </div>

              <div class="ax-quote-stats">
                <div class="ax-quote-stat">
                  <span class="ax-quote-stat-label">Day open</span>
                  <span class="ax-quote-stat-value">
                    {formatExtraPrice(stats()?.dayOpen ?? NaN)}
                  </span>
                </div>
                <div class="ax-quote-stat">
                  <span class="ax-quote-stat-label">Volume 24h</span>
                  <span class="ax-quote-stat-value">
                    {formatCompactVolume(stats()?.volume24 ?? NaN)}
                  </span>
                </div>
              </div>

              <div class="ax-quote-section">
                <span class="ax-quote-section-title">Last bar</span>
                <div class="ax-quote-ohlc" data-testid="axis-quote-ohlc">
                  <For each={ohlc()}>
                    {(p) => (
                      <div class="ax-quote-ohlc-cell">
                        <span class="ax-quote-ohlc-label">{p.label}</span>
                        <span class="ax-quote-ohlc-value">{formatExtraPrice(p.value)}</span>
                      </div>
                    )}
                  </For>
                </div>
              </div>

              <div class="ax-quote-meta">
                <For each={rows().filter((r) => r.label === 'Tick time' || r.label === 'Venue')}>
                  {(row) => (
                    <div class="ax-quote-meta-row">
                      <span class="ax-quote-meta-label">{row.label}</span>
                      <span class="ax-quote-meta-value">{row.value}</span>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>
      </FloatableShell>
    </Show>
  );
};
