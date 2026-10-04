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
 * symbols only. Pauses on hover; collapses when disabled or empty.
 *
 * @module ui/extras/PriceTicker
 */

import { type Component, For, createEffect, createSignal, onCleanup } from 'solid-js';
import { store } from '../../store';
import { startWatchlistQuotes, type QuoteMuxHandle, type QuoteUpdate } from '../../data/watchlist-live';
import { fetchWatchlistTickers } from '../../data/watchlist-tickers';
import { formatTickerRow } from './format';

export { formatTickerRow };

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

  const rows = () =>
    store.extras.ticker.symbols.map((s) => {
      const q = quotes()[s];
      return {
        text: formatTickerRow({ symbol: s, price: q?.price ?? NaN, change: q?.change }),
        up: (q?.change ?? 0) >= 0,
      };
    });

  const doubled = () => {
    const r = rows();
    return [...r, ...r];
  };

  return (
    <div
      class="axis-extra-ticker"
      data-testid="axis-extra-ticker"
      style={{ '--ticker-speed': `${30 / store.extras.ticker.speed}s` }}
    >
      <div class="axis-extra-ticker-track">
        <For each={doubled()}>
          {(r) => <span class={`axis-extra-tick ${r.up ? 'is-up' : 'is-down'}`}>{r.text}</span>}
        </For>
      </div>
    </div>
  );
};
