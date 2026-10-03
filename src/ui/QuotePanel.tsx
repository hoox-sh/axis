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
 * Quote panel — full quote sheet for the current symbol: price + trend,
 * 24h change / range, last-bar OHLCV, tick time, venue.
 *
 * Rows from {@link buildQuoteRows} using `store.bars`, `telemetry.lastTick`,
 * and a REST 24h seed for the change row. FloatableShell id `quote`
 * (docks right, stacks multirow with other right-dock panels).
 */

import { type Component, For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { store, isPanelOpen } from '../store';
import { FloatableShell } from './panels/FloatableShell';
import { buildQuoteRows, type QuoteRow } from './extras/quote';
import { fetchWatchlistTickers } from '../data/watchlist-tickers';

/** Full quote sheet dock panel for the current symbol. */
export const QuotePanel: Component = () => {
  const [change24h, setChange24h] = createSignal<number | undefined>(undefined);

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

  const rows = createMemo((): QuoteRow[] => {
    if (!isPanelOpen('quote')) return [];
    void store.bars.length;
    void store.chartDataGen;
    void store.telemetry?.lastTick;
    void store.symbol;
    void store.interval;
    const tick = store.telemetry?.lastTick;
    const bars = store.bars;
    const last = bars.length ? bars[bars.length - 1] : null;
    const live = tick && Number.isFinite(tick.price) ? (tick.price as number) : NaN;
    const price = Number.isFinite(live) ? live : (last && Number.isFinite(last.close) ? (last.close as number) : NaN);
    const venue =
      store.provider?.venue && store.provider.venue !== 'generic' && store.provider.venue !== 'cache'
        ? store.provider.venue
        : store.exchange;
    return buildQuoteRows({
      symbol: store.symbol,
      venue,
      bars,
      lastPrice: price,
      lastTickAt: tick && Number.isFinite(tick.at) ? (tick.at as number) : null,
      change24h: change24h(),
    });
  });

  return (
    <Show when={isPanelOpen('quote')}>
      <FloatableShell id="quote" testId="axis-quote">
        <div class="flex-1 overflow-y-auto min-h-0 text-[12px]">
          <Show
            when={store.bars.length > 0}
            fallback={
              <div class="axis-empty-state text-[12px] text-text-dim py-2">No data loaded</div>
            }
          >
            <div class="axis-quote-sym">{store.symbol}</div>
            <For each={rows()}>
              {(row) => (
                <div class="axis-quote-row">
                  <span class="axis-quote-label">{row.label}</span>
                  <span class={`axis-quote-value axis-quote-${row.tone ?? 'flat'}`}>{row.value}</span>
                </div>
              )}
            </For>
          </Show>
        </div>
      </FloatableShell>
    </Show>
  );
};
