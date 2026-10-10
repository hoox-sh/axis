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
 * Live-bar hook: evaluate stored price / drawing / indicator alerts.
 *
 * Called from the stream multiplex after a bar is applied. Failures are
 * swallowed so a webhook or Notification error cannot tear down live ticks.
 *
 * @module alerts/tick
 */

import { store } from '../store';
import { drawingsForSymbol } from '../chart/drawings/sync';
import { drawingPricesById } from './drawing-levels';
import { plotSamplesFromCache } from './indicator';
import {
  evaluateAlerts,
  loadAlerts,
  normalizeSymbol,
  type EvaluateBar,
  type EvaluateContext,
} from './index';

const LAST_BARS = 8;

/** Stream-side identity of the bar being evaluated (F2). */
export interface LiveBarStreamCtx {
  symbol?: string;
  interval?: string;
}

function lastBars(): EvaluateBar[] {
  const bars = store.bars;
  if (!Array.isArray(bars) || bars.length === 0) return [];
  const slice = bars.length > LAST_BARS ? bars.slice(-LAST_BARS) : bars;
  const out: EvaluateBar[] = [];
  for (const b of slice) {
    if (!b) continue;
    const open = Number(b.open);
    const high = Number(b.high);
    const low = Number(b.low);
    const close = Number(b.close);
    if (![open, high, low, close].every(Number.isFinite)) continue;
    const row: EvaluateBar = { open, high, low, close };
    if (typeof b.time === 'number' && Number.isFinite(b.time)) row.time = b.time;
    out.push(row);
  }
  return out;
}

function buildContext(price: number, stream?: LiveBarStreamCtx): EvaluateContext {
  const symbol =
    (stream?.symbol && stream.symbol.trim() ? stream.symbol.trim() : store.symbol) ||
    'BTCUSDT';
  const drawings = drawingsForSymbol(store.drawings, symbol, { includeUntagged: true });
  const ctx: EvaluateContext = {
    symbol,
    price,
    interval: stream?.interval || store.interval || undefined,
    bars: lastBars(),
    time: Date.now(),
    drawingPricesById: drawingPricesById(drawings),
    plotSamples: plotSamplesFromCache(store.indicatorSeries),
  };
  return ctx;
}

/**
 * True when the delivering stream still matches the open chart (F2).
 * A stale stream (e.g. after a symbol switch) must not evaluate its bars
 * against the new symbol's alerts.
 */
export function liveBarMatchesChart(stream?: LiveBarStreamCtx): boolean {
  if (!stream) return true;
  if (stream.symbol && normalizeSymbol(stream.symbol) !== normalizeSymbol(store.symbol || 'BTCUSDT')) {
    return false;
  }
  if (stream.interval && store.interval && String(stream.interval) !== String(store.interval)) {
    return false;
  }
  return true;
}

/**
 * Evaluate persisted alerts against a live last price.
 * @returns fired alerts (empty when nothing is armed)
 */
export async function evaluateLiveAlerts(price: number, stream?: LiveBarStreamCtx): Promise<void> {
  if (!Number.isFinite(price)) return;
  if (!liveBarMatchesChart(stream)) return;
  const alerts = loadAlerts();
  if (alerts.length === 0) return;
  await evaluateAlerts(buildContext(price, stream));
}

/**
 * Fire-and-forget entry from the live multiplex. Never throws.
 */
export function noteLiveBarForAlerts(
  bar: { close?: number } | null | undefined,
  stream?: LiveBarStreamCtx,
): void {
  const close = bar && typeof bar.close === 'number' ? bar.close : NaN;
  if (!Number.isFinite(close)) return;
  void evaluateLiveAlerts(close, stream).catch(() => {
    /* delivery / storage must not break the live session */
  });
}
