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
 * Watchlist price ticker — full-width marquee band under the module bar.
 *
 * REST-seeds instantly, then follows the watchlist quote mux for the selected
 * symbols only. Pauses on hover/focus; collapses when disabled or empty.
 *
 * The track holds two identical `.axis-extra-ticker-set` halves and scrolls
 * `translateX(-50%)`, so one period is exactly one half. Spacing lives on the
 * set (not a flex `gap`) — a gap would make the half a gap-width short and the
 * band would visibly skip every cycle. The clone half is `aria-hidden` so
 * assistive tech does not hear every symbol twice.
 *
 * @module ui/extras/PriceTicker
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
import { store } from '../../store';
import { startWatchlistQuotes, type QuoteMuxHandle, type QuoteUpdate } from '../../data/watchlist-live';
import { fetchWatchlistTickers } from '../../data/watchlist-tickers';
import { buildTickerRows, formatTickerRow, type TickerRow } from './format';

export { formatTickerRow };

/** One band item: dim symbol, tabular price, colored change. */
const TickerItem: Component<{ row: TickerRow }> = (props) => (
  <span
    class="axis-extra-tick"
    classList={{
      'is-up': props.row.up,
      'is-down': !props.row.up,
      'is-pending': !props.row.hasPrice,
    }}
  >
    <span class="axis-extra-tick-sym">{props.row.symbol}</span>
    <span class="axis-extra-tick-price">{props.row.price}</span>
    <Show when={props.row.change}>
      {(change) => (
        <span class="axis-extra-tick-change">
          <span class="axis-extra-tick-arrow" aria-hidden="true">
            {props.row.up ? '▲' : '▼'}
          </span>
          {change()}
        </span>
      )}
    </Show>
  </span>
);

/** Watchlist price ticker marquee band. */
export const PriceTicker: Component = () => {
  const [quotes, setQuotes] = createSignal<Record<string, QuoteUpdate>>({});
  let mux: QuoteMuxHandle | null = null;

  const stop = () => {
    try {
      mux?.stop();
    } catch {
      /* ignore */
    }
    mux = null;
  };

  const start = () => {
    stop();
    const symbols = store.extras.ticker.symbols;
    if (!symbols.length) {
      // Clear stale quotes so a later re-enable never flashes old prices.
      setQuotes({});
      return;
    }
    const requested = [...symbols];
    const sourceId = store.source;
    // REST seed so the band paints instantly. Merge under live quotes so
    // WS ticks that arrive before the fetch resolves are not wiped.
    void fetchWatchlistTickers(requested, sourceId)
      .then((seed) => {
        const next: Record<string, QuoteUpdate> = {};
        for (const [k, t] of Object.entries(seed)) {
          next[k] = { symbol: k, price: t.price, change: t.change };
        }
        setQuotes((q) => {
          const merged: Record<string, QuoteUpdate> = { ...next };
          for (const s of requested) {
            const live = q[s];
            if (live) merged[s] = live;
          }
          return merged;
        });
      })
      .catch(() => {});
    mux = startWatchlistQuotes({
      sourceId,
      symbols: requested,
      onQuote: (u) => setQuotes((q) => ({ ...q, [u.symbol]: u })),
    });
  };

  // Single effect owns the lifecycle (runs on mount too) — a separate
  // onMount start would open a second mux on every mount.
  createEffect(() => {
    // Restart when symbols / source change (runs once on mount too).
    void store.extras.ticker.symbols.join(',');
    void store.source;
    start();
  });
  onCleanup(stop);

  const rows = createMemo(() =>
    buildTickerRows(store.extras.ticker.symbols, quotes(), {
      showChange: store.extras.ticker.showChange,
    }),
  );

  return (
    <div
      class="axis-extra-ticker"
      data-testid="axis-extra-ticker"
      data-ticker-dir={store.extras.ticker.direction}
      style={{ '--ticker-speed': `${30 / store.extras.ticker.speed}s` }}
    >
      <div class="axis-extra-ticker-track">
        <div class="axis-extra-ticker-set">
          <For each={rows()}>{(row) => <TickerItem row={row} />}</For>
        </div>
        {/* Clone — hidden from assistive tech, shown only to close the loop. */}
        <div class="axis-extra-ticker-set" aria-hidden="true">
          <For each={rows()}>{(row) => <TickerItem row={row} />}</For>
        </div>
      </div>
    </div>
  );
};
