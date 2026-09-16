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
 * Original AXIS strategy built-ins (classic public setups, not vendor templates).
 *
 * @module indicators/builtins/strategies
 */

import { COL, def, pineStrategy } from './pine';
import type { BuiltinScript } from './types';

export const STRATEGY_BUILTINS: readonly BuiltinScript[] = [
  def({
    id: 'strat-ma-cross',
    title: 'AXIS SMA Cross Strat',
    shorttitle: 'SMA X',
    description: 'Long on fast/slow SMA cross',
    category: 'strategy',
    kind: 'strategy',
    overlay: true,
    covers: 'SMA crossover strategy',
    tags: ['strategy', 'sma', 'cross'],
    code: pineStrategy(
      'AXIS SMA Cross Strat',
      true,
      `fastLen = input.int(9, "Fast", minval=1)
slowLen = input.int(21, "Slow", minval=1)
src = input.source(close, "Source")
fast = ta.sma(src, fastLen)
slow = ta.sma(src, slowLen)
if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)
if ta.crossunder(fast, slow)
    strategy.close("Long")
plot(fast, "Fast", color=${COL.cyan})
plot(slow, "Slow", color=${COL.amber})`,
    ),
  }),
  def({
    id: 'strat-macd',
    title: 'AXIS MACD Strat',
    shorttitle: 'MACD X',
    description: 'Long on MACD / signal cross',
    category: 'strategy',
    kind: 'strategy',
    overlay: true,
    covers: 'MACD crossover strategy',
    tags: ['strategy', 'macd'],
    code: pineStrategy(
      'AXIS MACD Strat',
      true,
      `fastLen = input.int(12, "Fast")
slowLen = input.int(26, "Slow")
sigLen = input.int(9, "Signal")
[macdLine, signalLine, hist] = ta.macd(close, fastLen, slowLen, sigLen)
if ta.crossover(macdLine, signalLine)
    strategy.entry("Long", strategy.long)
if ta.crossunder(macdLine, signalLine)
    strategy.close("Long")
plot(hist, "Hist", display=display.data_window)`,
    ),
  }),
  def({
    id: 'strat-rsi',
    title: 'AXIS RSI Strat',
    shorttitle: 'RSI MR',
    description: 'Long when RSI exits oversold',
    category: 'strategy',
    kind: 'strategy',
    overlay: false,
    covers: 'RSI mean-reversion strategy',
    tags: ['strategy', 'rsi'],
    code: pineStrategy(
      'AXIS RSI Strat',
      false,
      `len = input.int(14, "RSI", minval=2)
os = input.float(30, "Oversold")
ob = input.float(70, "Overbought")
r = ta.rsi(close, len)
if ta.crossover(r, os)
    strategy.entry("Long", strategy.long)
if ta.crossunder(r, ob)
    strategy.close("Long")
plot(r, "RSI", color=${COL.indigo})
hline(os, "OS", color=${COL.emerald})
hline(ob, "OB", color=${COL.rose})`,
    ),
  }),
  def({
    id: 'strat-bb',
    title: 'AXIS BB Bounce Strat',
    shorttitle: 'BB Bounce',
    description: 'Fade the lower band; exit at basis',
    category: 'strategy',
    kind: 'strategy',
    overlay: true,
    covers: 'Bollinger bounce strategy',
    tags: ['strategy', 'bb'],
    code: pineStrategy(
      'AXIS BB Bounce Strat',
      true,
      `len = input.int(20, "Length")
mult = input.float(2.0, "StdDev", step=0.1)
basis = ta.sma(close, len)
dev = mult * ta.stdev(close, len)
upper = basis + dev
lower = basis - dev
if ta.crossover(close, lower)
    strategy.entry("Long", strategy.long)
if close > basis and strategy.position_size > 0
    strategy.close("Long")
plot(basis, "Basis", color=${COL.indigo})
plot(upper, "Upper", color=${COL.cyan})
plot(lower, "Lower", color=${COL.cyan})`,
    ),
  }),
  def({
    id: 'strat-supertrend',
    title: 'AXIS Supertrend Strat',
    shorttitle: 'ST Follow',
    description: 'Flip with Supertrend direction',
    category: 'strategy',
    kind: 'strategy',
    overlay: true,
    covers: 'Supertrend follow strategy',
    tags: ['strategy', 'supertrend'],
    code: pineStrategy(
      'AXIS Supertrend Strat',
      true,
      `atrLen = input.int(10, "ATR")
factor = input.float(3.0, "Factor", step=0.1)
[st, dir] = ta.supertrend(factor, atrLen)
bull = dir < 0
bear = dir > 0
if bull and not bull[1]
    strategy.entry("Long", strategy.long)
if bear and not bear[1]
    strategy.close("Long")
plot(bull ? st : na, "ST Up", color=${COL.emerald}, linewidth=2, style=plot.style_linebr)
plot(bear ? st : na, "ST Down", color=${COL.rose}, linewidth=2, style=plot.style_linebr)`,
    ),
  }),
  def({
    id: 'strat-sar',
    title: 'AXIS SAR Strat',
    shorttitle: 'SAR Flip',
    description: 'Flip long/flat on SAR vs close',
    category: 'strategy',
    kind: 'strategy',
    overlay: true,
    covers: 'Parabolic SAR strategy',
    tags: ['strategy', 'sar'],
    code: pineStrategy(
      'AXIS SAR Strat',
      true,
      `start = input.float(0.02, "Start", step=0.01)
inc = input.float(0.02, "Increment", step=0.01)
maxAf = input.float(0.2, "Max", step=0.01)
s = ta.sar(start, inc, maxAf)
if ta.crossover(close, s)
    strategy.entry("Long", strategy.long)
if ta.crossunder(close, s)
    strategy.close("Long")
plot(s, "SAR", color=${COL.amber}, style=plot.style_cross)`,
    ),
  }),
  def({
    id: 'strat-keltner',
    title: 'AXIS Keltner Strat',
    shorttitle: 'KC Break',
    description: 'Long on close through upper Keltner',
    category: 'strategy',
    kind: 'strategy',
    overlay: true,
    covers: 'Keltner breakout strategy',
    tags: ['strategy', 'keltner'],
    code: pineStrategy(
      'AXIS Keltner Strat',
      true,
      `len = input.int(20, "EMA")
atrLen = input.int(10, "ATR")
mult = input.float(2.0, "Mult", step=0.1)
basis = ta.ema(close, len)
rng = ta.atr(atrLen) * mult
upper = basis + rng
lower = basis - rng
if ta.crossover(close, upper)
    strategy.entry("Long", strategy.long)
if ta.crossunder(close, lower)
    strategy.close("Long")
plot(basis, "Basis", color=${COL.indigo})
plot(upper, "Upper", color=${COL.amber})
plot(lower, "Lower", color=${COL.amber})`,
    ),
  }),
  def({
    id: 'strat-donchian',
    title: 'AXIS Donchian Strat',
    shorttitle: 'DC Break',
    description: 'Break prior Donchian high; exit mid',
    category: 'strategy',
    kind: 'strategy',
    overlay: true,
    covers: 'Donchian / channel breakout strategy',
    tags: ['strategy', 'donchian'],
    code: pineStrategy(
      'AXIS Donchian Strat',
      true,
      `len = input.int(20, "Length", minval=2)
upper = ta.highest(high, len)
lower = ta.lowest(low, len)
mid = (upper + lower) / 2.0
if ta.crossover(close, upper[1])
    strategy.entry("Long", strategy.long)
if ta.crossunder(close, mid)
    strategy.close("Long")
plot(upper, "Upper", color=${COL.cyan})
plot(lower, "Lower", color=${COL.cyan})
plot(mid, "Mid", color=${COL.slate})`,
    ),
  }),
  def({
    id: 'strat-momentum',
    title: 'AXIS Momentum Strat',
    shorttitle: 'MOM X',
    description: 'Long while momentum is positive',
    category: 'strategy',
    kind: 'strategy',
    overlay: true,
    covers: 'Momentum strategy',
    tags: ['strategy', 'momentum'],
    code: pineStrategy(
      'AXIS Momentum Strat',
      true,
      `len = input.int(10, "Length", minval=1)
m = ta.mom(close, len)
if ta.crossover(m, 0)
    strategy.entry("Long", strategy.long)
if ta.crossunder(m, 0)
    strategy.close("Long")`,
    ),
  }),
  def({
    id: 'strat-stoch',
    title: 'AXIS Stoch Strat',
    shorttitle: 'Stoch X',
    description: '%K/%D cross in oversold',
    category: 'strategy',
    kind: 'strategy',
    overlay: false,
    covers: 'Stochastic crossover strategy',
    tags: ['strategy', 'stoch'],
    code: pineStrategy(
      'AXIS Stoch Strat',
      false,
      `kLen = input.int(14, "K")
kSmooth = input.int(3, "K smooth")
dSmooth = input.int(3, "D")
os = input.float(20, "Oversold")
ob = input.float(80, "Overbought")
k = ta.sma(ta.stoch(close, high, low, kLen), kSmooth)
d = ta.sma(k, dSmooth)
if ta.crossover(k, d) and k < os
    strategy.entry("Long", strategy.long)
if ta.crossunder(k, d) and k > ob
    strategy.close("Long")
plot(k, "%K", color=${COL.indigo})
plot(d, "%D", color=${COL.amber})`,
    ),
  }),
  def({
    id: 'strat-bar-updown',
    title: 'AXIS Bar Up/Down Strat',
    shorttitle: 'Bar UD',
    description: 'Long on bull bar; exit on bear bar',
    category: 'strategy',
    kind: 'strategy',
    overlay: true,
    covers: 'Bar up/down strategy',
    tags: ['strategy', 'price-action'],
    code: pineStrategy(
      'AXIS Bar Up/Down Strat',
      true,
      `if close > open
    strategy.entry("Long", strategy.long)
if close < open
    strategy.close("Long")`,
    ),
  }),
  def({
    id: 'strat-consecutive',
    title: 'AXIS Consecutive Strat',
    shorttitle: 'N Up',
    description: 'Long after N consecutive up closes',
    category: 'strategy',
    kind: 'strategy',
    overlay: true,
    covers: 'Consecutive up/down strategy',
    tags: ['strategy', 'price-action'],
    code: pineStrategy(
      'AXIS Consecutive Strat',
      true,
      `n = input.int(3, "Closes", minval=1)
up = close > close[1]
dn = close < close[1]
ups = 0
dns = 0
for i = 0 to n - 1
    if up[i]
        ups += 1
    if dn[i]
        dns += 1
if ups == n
    strategy.entry("Long", strategy.long)
if dns == n
    strategy.close("Long")`,
    ),
  }),
  def({
    id: 'strat-inside',
    title: 'AXIS Inside Bar Strat',
    shorttitle: 'Inside',
    description: 'Long break of an inside bar high',
    category: 'strategy',
    kind: 'strategy',
    overlay: true,
    covers: 'Inside bar strategy',
    tags: ['strategy', 'price-action'],
    code: pineStrategy(
      'AXIS Inside Bar Strat',
      true,
      `inside = high < high[1] and low > low[1]
if inside[1] and close > high[1]
    strategy.entry("Long", strategy.long)
if strategy.position_size > 0 and close < low[1]
    strategy.close("Long")`,
    ),
  }),
  def({
    id: 'strat-outside',
    title: 'AXIS Outside Bar Strat',
    shorttitle: 'Outside',
    description: 'Fade a bearish outside bar',
    category: 'strategy',
    kind: 'strategy',
    overlay: true,
    covers: 'Outside bar strategy',
    tags: ['strategy', 'price-action'],
    code: pineStrategy(
      'AXIS Outside Bar Strat',
      true,
      `outside = high > high[1] and low < low[1]
bearOut = outside and close < open
if bearOut
    strategy.entry("Long", strategy.long)
if strategy.position_size > 0 and close > high[1]
    strategy.close("Long")`,
    ),
  }),
  def({
    id: 'strat-pivot-rev',
    title: 'AXIS Pivot Reversal Strat',
    shorttitle: 'Piv Rev',
    description: 'Long a confirmed pivot low',
    category: 'strategy',
    kind: 'strategy',
    overlay: true,
    covers: 'Pivot reversal strategy',
    tags: ['strategy', 'pivot'],
    code: pineStrategy(
      'AXIS Pivot Reversal Strat',
      true,
      `left = input.int(3, "Left", minval=1)
right = input.int(3, "Right", minval=1)
pl = ta.pivotlow(low, left, right)
var float lastPl = na
if not na(pl)
    lastPl := pl
    strategy.entry("Long", strategy.long)
if strategy.position_size > 0 and not na(lastPl) and close < lastPl
    strategy.close("Long")`,
    ),
  }),
  def({
    id: 'strat-atr-exp',
    title: 'AXIS ATR Expansion Strat',
    shorttitle: 'ATR Exp',
    description: 'Long when range expands vs ATR and close is strong',
    category: 'strategy',
    kind: 'strategy',
    overlay: true,
    covers: 'Volatility expansion close strategy',
    tags: ['strategy', 'atr'],
    code: pineStrategy(
      'AXIS ATR Expansion Strat',
      true,
      `len = input.int(14, "ATR", minval=1)
mult = input.float(1.5, "Range / ATR", step=0.1)
atr = ta.atr(len)
wide = (high - low) > atr * mult
strong = close > open and close > (high + low) / 2.0
if wide and strong
    strategy.entry("Long", strategy.long)
if ta.crossunder(close, ta.ema(close, 20))
    strategy.close("Long")`,
    ),
  }),
];
