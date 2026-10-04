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
 * Current-price overlay card (chart top-left): big price + trend arrow from
 * the live tick against the last N closes. Reads store only — no new subscriptions.
 *
 * @module ui/extras/CurrentPriceCard
 */

import { type Component, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { store } from '../../store';
import { trendOverTicks } from './trend';
import { formatExtraPrice } from './format';
import {
  barCloseRemainingMs,
  formatClockLocal,
  formatClockUtc,
  formatCountdown,
} from './timebadge';

/** Current-price overlay card (chart top-left). Reads store only. */
export const CurrentPriceCard: Component = () => {
  /** Wall-clock tick so the left time badge counts down live. */
  const [now, setNow] = createSignal(Date.now());
  onMount(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => window.clearInterval(id));
  });
  /**
   * Stream-scoped live tick price (NaN when absent or belonging to a previous
   * symbol — e.g. symbol switch before the first new tick arrives).
   */
  const livePrice = () => {
    const tick = store.telemetry?.lastTick;
    return tick &&
      (tick.symbol === undefined || tick.symbol === store.symbol) &&
      Number.isFinite(tick.price)
      ? (tick.price as number)
      : NaN;
  };
  const price = () => {
    const live = livePrice();
    const bars = store.bars;
    const last = bars.length ? bars[bars.length - 1]?.close : NaN;
    if (Number.isFinite(live)) return live as number;
    return Number.isFinite(last) ? (last as number) : NaN;
  };
  /** Trend head is the live tick when available — the arrow reacts to every tick, not just bar closes. */
  const trend = () => trendOverTicks(store.bars, store.extras.priceCard.tickLength, livePrice());
  /**
   * Left name badge: remaining time to the current-bar close (dash-prefixed,
   * e.g. `-4:32`); live local clock while no bars are loaded. Tooltip carries
   * local + UTC time.
   */
  const badge = () => {
    const bars = store.bars;
    const last = bars.length ? bars[bars.length - 1] : undefined;
    const remaining =
      last && Number.isFinite(last.time)
        ? barCloseRemainingMs(last.time * 1000, store.interval, now())
        : NaN;
    const d = new Date(now());
    const tip = `Local ${formatClockLocal(d)} · UTC ${formatClockUtc(d)}`;
    if (Number.isFinite(remaining)) {
      const text = `-${formatCountdown(remaining as number)}`;
      return { text, title: `Bar closes in ${text} · ${tip}` };
    }
    return { text: formatClockLocal(d), title: tip };
  };
  return (
    <Show when={store.extras.priceCard.enabled && store.bars.length > 0}>
      <div class="axis-extra-price" data-testid="axis-extra-price">
        <span class="axis-extra-price-badge" title={badge().title} data-testid="axis-extra-price-badge">
          {badge().text}
        </span>
        <span class="axis-extra-price-value">{formatExtraPrice(price())}</span>
        <span class={`axis-extra-trend axis-extra-trend-${trend()}`}>
          {trend() === 'up' ? '▲' : trend() === 'down' ? '▼' : '●'}
        </span>
        <span class="axis-extra-n">N={store.extras.priceCard.tickLength}</span>
      </div>
    </Show>
  );
};
