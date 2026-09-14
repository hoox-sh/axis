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
  type EvaluateBar,
  type EvaluateContext,
} from './index';

const LAST_BARS = 8;

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

function buildContext(price: number): EvaluateContext {
  const symbol = store.symbol || 'BTCUSDT';
  const drawings = drawingsForSymbol(store.drawings, symbol, { includeUntagged: true });
  const ctx: EvaluateContext = {
    symbol,
    price,
    interval: store.interval || undefined,
    bars: lastBars(),
    time: Date.now(),
    drawingPricesById: drawingPricesById(drawings),
    plotSamples: plotSamplesFromCache(store.indicatorSeries),
  };
  return ctx;
}

/**
 * Evaluate persisted alerts against a live last price.
 * @returns fired alerts (empty when nothing is armed)
 */
export async function evaluateLiveAlerts(price: number): Promise<void> {
  if (!Number.isFinite(price)) return;
  const alerts = loadAlerts();
  if (alerts.length === 0) return;
  await evaluateAlerts(buildContext(price));
}

/**
 * Fire-and-forget entry from the live multiplex. Never throws.
 */
export function noteLiveBarForAlerts(bar: { close?: number } | null | undefined): void {
  const close = bar && typeof bar.close === 'number' ? bar.close : NaN;
  if (!Number.isFinite(close)) return;
  void evaluateLiveAlerts(close).catch(() => {
    /* delivery / storage must not break the live session */
  });
}
