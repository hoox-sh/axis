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
 * The price doubles as a copy button; the header shows the symbol, venue, and
 * live stream state.
 *
 * FloatableShell id `price` (`floatOnly` — no layout docks).
 */

import { type Component, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { store, isPanelOpen } from '../store';
import { barPlane } from '../stores/bars';
import { FloatableShell } from './panels/FloatableShell';
import { Icons } from './icons';
import { copyToClipboard } from './clipboard';
import { formatExtraPrice } from './extras/format';
import { displayedLastPrice } from './extras/quote';
import { fetchWatchlistTickers } from '../data/watchlist-tickers';

/** Float-only price panel (big last price + 24h change). */
export const PricePanel: Component = () => {
  const [change24h, setChange24h] = createSignal<number | undefined>(undefined);
  const [copied, setCopied] = createSignal(false);
  let copyTimer: number | undefined;

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

  onCleanup(() => {
    if (copyTimer) window.clearTimeout(copyTimer);
  });

  const price = () => {
    const tick = store.telemetry?.lastTick;
    // Prefer the narrow plane tip — it updates on every live tick without
    // pulling the full store.bars array into the reactive graph.
    const tip = barPlane.tip;
    const tickPrice =
      tick &&
      (tick.symbol === undefined || tick.symbol === store.symbol) &&
      Number.isFinite(tick.price)
        ? (tick.price as number)
        : NaN;
    const last = tip?.close ?? (barPlane.length ? barPlane.bars[barPlane.length - 1]?.close : NaN);
    return displayedLastPrice({
      tickPrice,
      barClose: Number.isFinite(last) ? (last as number) : NaN,
      streamState: store.telemetry?.stream?.state,
    });
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

  const liveState = () => store.telemetry?.stream?.state ?? 'idle';
  const isLive = () => liveState() === 'open' || liveState() === 'idle';

  const copyPrice = async () => {
    if (await copyToClipboard(formatExtraPrice(price()))) {
      setCopied(true);
      if (copyTimer) window.clearTimeout(copyTimer);
      copyTimer = window.setTimeout(() => setCopied(false), 1300);
    }
  };

  return (
    <Show when={isPanelOpen('price')}>
      <FloatableShell id="price" testId="axis-price" floatOnly>
        <div class="ax-price">
          <div class="ax-price-top">
            <span class="ax-price-symbol" title="Chart symbol">
              {store.symbol}
            </span>
            <span class="ax-price-venue" title="Venue">
              {venue() || '—'}
            </span>
            <span class="ax-price-spacer" />
            <span
              class="ax-price-live"
              classList={{ 'is-live': isLive() }}
              title={`Stream state: ${liveState()}`}
            >
              <span class="ax-price-live-dot" />
              {liveState()}
            </span>
          </div>

          <button
            type="button"
            class="ax-price-value"
            classList={{
              'is-up': (change() ?? 0) >= 0 && change() != null,
              'is-down': (change() ?? 0) < 0,
              'is-copied': copied(),
            }}
            title="Copy price"
            aria-label={`Copy ${store.symbol} price`}
            data-testid="axis-price-value"
            onClick={() => void copyPrice()}
          >
            <span class="tabular-nums">{formatExtraPrice(price())}</span>
            <span class="ax-price-copy" aria-hidden="true">
              {copied() ? <Icons.check size={11} /> : <Icons.copy size={11} />}
            </span>
          </button>

          <div class="ax-price-sub" data-testid="axis-price-sub">
            <span
              class="ax-price-change"
              classList={{
                'is-up': change() != null && (change() ?? 0) >= 0,
                'is-down': change() != null && (change() ?? 0) < 0,
              }}
            >
              <Show when={change() != null} fallback={<span>—</span>}>
                <span class="ax-price-arrow">{(change() ?? 0) >= 0 ? '▲' : '▼'}</span>
                {changeText()}
              </Show>
            </span>
            <span class="ax-price-window">24h</span>
          </div>
        </div>
      </FloatableShell>
    </Show>
  );
};
