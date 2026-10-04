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
 * Price panel — float-only compact quote for the current symbol: big last
 * price, 24h change + venue below. Same live-tick scoping and REST change
 * seed as the full {@link QuotePanel} sheet.
 *
 * FloatableShell id `price` (`floatOnly` — no layout docks).
 */

import { type Component, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { store, isPanelOpen } from '../store';
import { FloatableShell } from './panels/FloatableShell';
import { formatExtraPrice } from './extras/format';
import { fetchWatchlistTickers } from '../data/watchlist-tickers';

/** Float-only price panel (big last price + 24h change). */
export const PricePanel: Component = () => {
  const [change24h, setChange24h] = createSignal<number | undefined>(undefined);

  // REST seed for the 24h change row (mirrors QuotePanel).
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

  const price = () => {
    const tick = store.telemetry?.lastTick;
    const bars = store.bars;
    // Live tick is stream-scoped: ignore it when it belongs to a previous
    // symbol (symbol switch before the first new tick arrives).
    const live =
      tick && (tick.symbol === undefined || tick.symbol === store.symbol) && Number.isFinite(tick.price)
        ? (tick.price as number)
        : NaN;
    const last = bars.length ? bars[bars.length - 1]?.close : NaN;
    if (Number.isFinite(live)) return live as number;
    return Number.isFinite(last) ? (last as number) : NaN;
  };

  const change = () => {
    const c = change24h();
    return c != null && Number.isFinite(c) ? c : undefined;
  };

  const changeText = () => {
    const c = change();
    if (c == null) return '—';
    return `${c >= 0 ? '+' : ''}${c.toFixed(2)}%`;
  };

  const venue = () =>
    store.provider?.venue && store.provider.venue !== 'generic' && store.provider.venue !== 'cache'
      ? store.provider.venue
      : store.exchange;

  return (
    <Show when={isPanelOpen('price')}>
      <FloatableShell id="price" testId="axis-price" floatOnly>
        <div class="axis-mini-panel">
          <div class="axis-mini-big" data-testid="axis-price-value">
            <span class="tabular-nums">{formatExtraPrice(price())}</span>
          </div>
          <div class="axis-mini-sub" data-testid="axis-price-sub">
            <span
              class={`tabular-nums ${
                change() == null ? '' : (change() ?? 0) >= 0 ? 'axis-quote-up' : 'axis-quote-down'
              }`}
            >
              {changeText()}
            </span>
            <span class="axis-mini-dim">
              {store.symbol} · {venue()}
            </span>
          </div>
        </div>
      </FloatableShell>
    </Show>
  );
};
