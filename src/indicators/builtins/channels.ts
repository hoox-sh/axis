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
 * Original AXIS channel / band built-ins.
 *
 * @module indicators/builtins/channels
 */

import { COL, def, pineIndicator } from './pine';
import type { BuiltinScript } from './types';

export const CHANNEL_BUILTINS: readonly BuiltinScript[] = [
  def({
    id: 'bb',
    title: 'AXIS Bollinger',
    shorttitle: 'BB',
    description: 'SMA ± standard-deviation bands',
    category: 'channel',
    covers: 'Bollinger Bands',
    tags: ['bb', 'volatility', 'overlay'],
    code: pineIndicator(
      'AXIS Bollinger',
      'BB',
      true,
      `len = input.int(20, "Length", minval=1)
mult = input.float(2.0, "StdDev", minval=0.1, step=0.1)
src = input.source(close, "Source")
basis = ta.sma(src, len)
dev = mult * ta.stdev(src, len)
upper = basis + dev
lower = basis - dev
plot(basis, "Basis", color=${COL.indigo})
u = plot(upper, "Upper", color=${COL.cyan})
l = plot(lower, "Lower", color=${COL.cyan})
fill(u, l, color=color.new(${COL.indigo}, 90), title="Band")`,
    ),
  }),
  def({
    id: 'bb-pct',
    title: 'AXIS Bollinger %B',
    shorttitle: '%B',
    description: 'Position of source inside Bollinger Bands',
    category: 'channel',
    overlay: false,
    covers: 'Bollinger %B',
    tags: ['bb', 'percent-b', 'oscillator'],
    code: pineIndicator(
      'AXIS Bollinger %B',
      '%B',
      false,
      `len = input.int(20, "Length", minval=1)
mult = input.float(2.0, "StdDev", minval=0.1, step=0.1)
src = input.source(close, "Source")
basis = ta.sma(src, len)
dev = mult * ta.stdev(src, len)
upper = basis + dev
lower = basis - dev
pctB = upper == lower ? na : (src - lower) / (upper - lower)
plot(pctB, "%B", color=${COL.indigo}, linewidth=2)
hline(1.0, "Upper", color=${COL.rose}, linestyle=hline.style_dashed)
hline(0.0, "Lower", color=${COL.emerald}, linestyle=hline.style_dashed)
hline(0.5, "Mid", color=${COL.slate}, linestyle=hline.style_dotted)`,
    ),
  }),
  def({
    id: 'bb-width',
    title: 'AXIS Bollinger Width',
    shorttitle: 'BBW',
    description: '(upper − lower) / basis',
    category: 'channel',
    overlay: false,
    covers: 'Bollinger Bandwidth',
    tags: ['bb', 'width', 'volatility'],
    code: pineIndicator(
      'AXIS Bollinger Width',
      'BBW',
      false,
      `len = input.int(20, "Length", minval=1)
mult = input.float(2.0, "StdDev", minval=0.1, step=0.1)
src = input.source(close, "Source")
basis = ta.sma(src, len)
dev = mult * ta.stdev(src, len)
bw = basis == 0 ? na : (2.0 * dev) / basis
plot(bw, "Width", color=${COL.cyan}, linewidth=2)`,
    ),
  }),
  def({
    id: 'keltner',
    title: 'AXIS Keltner',
    shorttitle: 'KC',
    description: 'EMA ± ATR multiple',
    category: 'channel',
    covers: 'Keltner Channels',
    tags: ['keltner', 'atr', 'overlay'],
    code: pineIndicator(
      'AXIS Keltner',
      'KC',
      true,
      `len = input.int(20, "EMA Length", minval=1)
atrLen = input.int(10, "ATR Length", minval=1)
mult = input.float(2.0, "ATR mult", minval=0.1, step=0.1)
src = input.source(close, "Source")
basis = ta.ema(src, len)
rng = ta.atr(atrLen) * mult
upper = basis + rng
lower = basis - rng
plot(basis, "Basis", color=${COL.indigo})
u = plot(upper, "Upper", color=${COL.amber})
l = plot(lower, "Lower", color=${COL.amber})
fill(u, l, color=color.new(${COL.amber}, 92))`,
    ),
  }),
  def({
    id: 'donchian',
    title: 'AXIS Donchian',
    shorttitle: 'DC',
    description: 'N-bar high / low channel',
    category: 'channel',
    covers: 'Donchian Channels',
    tags: ['donchian', 'breakout', 'overlay'],
    code: pineIndicator(
      'AXIS Donchian',
      'DC',
      true,
      `len = input.int(20, "Length", minval=1)
upper = ta.highest(high, len)
lower = ta.lowest(low, len)
mid = (upper + lower) / 2.0
u = plot(upper, "Upper", color=${COL.cyan})
l = plot(lower, "Lower", color=${COL.cyan})
plot(mid, "Mid", color=${COL.slate}, style=plot.style_stepline)
fill(u, l, color=color.new(${COL.cyan}, 92))`,
    ),
  }),
  def({
    id: 'linreg-channel',
    title: 'AXIS LinReg Channel',
    shorttitle: 'LRC',
    description: 'Linear regression ± residual deviation',
    category: 'channel',
    covers: 'Linear regression channel',
    tags: ['linreg', 'channel', 'overlay'],
    code: pineIndicator(
      'AXIS LinReg Channel',
      'LRC',
      true,
      `len = input.int(50, "Length", minval=2)
mult = input.float(2.0, "Dev mult", minval=0.1, step=0.1)
src = input.source(close, "Source")
basis = ta.linreg(src, len, 0)
dev = ta.stdev(src - basis, len) * mult
upper = basis + dev
lower = basis - dev
plot(basis, "LinReg", color=${COL.indigo})
u = plot(upper, "Upper", color=${COL.rose})
l = plot(lower, "Lower", color=${COL.emerald})
fill(u, l, color=color.new(${COL.indigo}, 92))`,
    ),
  }),
  def({
    id: 'linreg-curve',
    title: 'AXIS LinReg Curve',
    shorttitle: 'LR',
    description: 'Linear regression value of source',
    category: 'channel',
    covers: 'Linear regression curve',
    tags: ['linreg', 'overlay'],
    code: pineIndicator(
      'AXIS LinReg Curve',
      'LR',
      true,
      `len = input.int(25, "Length", minval=1)
src = input.source(close, "Source")
out = ta.linreg(src, len, 0)
plot(out, "LinReg", color=${COL.amber}, linewidth=2)`,
    ),
  }),
  def({
    id: 'bbtrend',
    title: 'AXIS BB Trend',
    shorttitle: 'BBT',
    description: 'Short vs long Bollinger width (public difference)',
    category: 'channel',
    overlay: false,
    covers: 'Bollinger trend (short vs long width)',
    tags: ['bb', 'trend', 'oscillator'],
    code: pineIndicator(
      'AXIS BB Trend',
      'BBT',
      false,
      `shortLen = input.int(20, "Short", minval=1)
longLen = input.int(50, "Long", minval=2)
mult = input.float(2.0, "StdDev", minval=0.1, step=0.1)
src = input.source(close, "Source")
sDev = ta.stdev(src, shortLen) * mult
lDev = ta.stdev(src, longLen) * mult
bbt = 2.0 * (sDev - lDev)
plot(bbt, "BB Trend", style=plot.style_columns, color=bbt >= 0 ? ${COL.emerald} : ${COL.rose})
hline(0, "Zero", color=${COL.slate})`,
    ),
  }),
];
