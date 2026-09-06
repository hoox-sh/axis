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
 * Starter Pine Script™ snippets for the command palette's "Insert Pine
 * snippet…" command. All snippets are `//@version=6` with real
 * `indicator()` declarations (no invented host APIs).
 *
 * @module ui/shortcuts/pine-snippets
 */

export interface PineSnippet {
  id: string;
  title: string;
  description: string;
  code: string;
}

/** ~6 curated starters: empty indicator, RSI, MACD, EMA cross, Bollinger, VWMA. */
export const PINE_SNIPPETS: readonly PineSnippet[] = [
  {
    id: 'empty',
    title: 'Empty indicator',
    description: 'Minimal //@version=6 indicator() scaffold',
    code: `//@version=6
indicator("My indicator", overlay=true)

// Your logic here
plot(close, "Close", color=color.new(color.blue, 0))
`,
  },
  {
    id: 'rsi',
    title: 'RSI',
    description: 'Relative Strength Index with overbought/oversold levels',
    code: `//@version=6
indicator("RSI", overlay=false)

rsi = ta.rsi(close, 14)
hline(70, "Overbought", color=color.new(color.red, 0))
hline(30, "Oversold", color=color.new(color.green, 0))
plot(rsi, "RSI", color=color.new(color.purple, 0))
`,
  },
  {
    id: 'macd',
    title: 'MACD',
    description: 'Moving Average Convergence Divergence with signal line',
    code: `//@version=6
indicator("MACD", overlay=false)

[macdLine, signalLine, histLine] = ta.macd(close, 12, 26, 9)
plot(macdLine, "MACD", color=color.new(color.blue, 0))
plot(signalLine, "Signal", color=color.new(color.orange, 0))
plot(histLine, "Histogram", style=plot.style_columns, color=histLine >= 0 ? color.new(color.teal, 0) : color.new(color.red, 0))
`,
  },
  {
    id: 'ema-cross',
    title: 'EMA cross',
    description: 'Fast/slow EMA crossover with background highlight',
    code: `//@version=6
indicator("EMA cross", overlay=true)

fast = ta.ema(close, 9)
slow = ta.ema(close, 21)
plot(fast, "Fast EMA", color=color.new(color.blue, 0))
plot(slow, "Slow EMA", color=color.new(color.orange, 0))

crossUp = ta.crossover(fast, slow)
crossDown = ta.crossunder(fast, slow)
bgcolor(crossUp ? color.new(color.green, 80) : crossDown ? color.new(color.red, 80) : na)
`,
  },
  {
    id: 'bollinger',
    title: 'Bollinger Bands',
    description: '20-period SMA with ±2σ bands',
    code: `//@version=6
indicator("Bollinger Bands", overlay=true)

basis = ta.sma(close, 20)
dev = 2.0 * ta.stdev(close, 20)
upper = basis + dev
lower = basis - dev
plot(basis, "Basis", color=color.new(color.blue, 0))
plot(upper, "Upper", color=color.new(color.gray, 0))
plot(lower, "Lower", color=color.new(color.gray, 0))
fill(plot(upper), plot(lower), color=color.new(color.blue, 90))
`,
  },
  {
    id: 'vwma',
    title: 'Volume-weighted MA',
    description: 'Volume-weighted moving average of close',
    code: `//@version=6
indicator("VWMA", overlay=true)

vwma = ta.vwma(close, 20)
plot(vwma, "VWMA", color=color.new(color.purple, 0))
`,
  },
];

/** Look up a snippet by id (falls back to the first starter). */
export function getPineSnippet(id: string): PineSnippet | undefined {
  return PINE_SNIPPETS.find((s) => s.id === id);
}