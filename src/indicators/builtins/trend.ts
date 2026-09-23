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
 * Original AXIS trend built-ins.
 *
 * @module indicators/builtins/trend
 */

import { COL, def, pineIndicator } from './pine';
import type { BuiltinScript } from './types';

export const TREND_BUILTINS: readonly BuiltinScript[] = [
  def({
    id: 'supertrend',
    title: 'AXIS Supertrend',
    shorttitle: 'ST',
    description: 'ATR Supertrend (mid ± factor · ATR)',
    category: 'trend',
    covers: 'Supertrend',
    tags: ['supertrend', 'atr', 'overlay'],
    code: pineIndicator(
      'AXIS Supertrend',
      'ST',
      true,
      `atrLen = input.int(10, "ATR length", minval=1)
factor = input.float(3.0, "Factor", minval=0.1, step=0.1)
[st, dirRaw] = ta.supertrend(factor, atrLen)
bull = dirRaw < 0
bear = dirRaw > 0
plot(bull ? st : na, "ST Up", color=${COL.emerald}, linewidth=2, style=plot.style_linebr)
plot(bear ? st : na, "ST Down", color=${COL.rose}, linewidth=2, style=plot.style_linebr)
plotshape(bull and not bull[1], "Flip up", shape.triangleup, location.belowbar, ${COL.emerald}, size=size.small)
plotshape(bear and not bear[1], "Flip down", shape.triangledown, location.abovebar, ${COL.rose}, size=size.small)`,
    ),
  }),
  def({
    id: 'adx',
    title: 'AXIS ADX',
    shorttitle: 'ADX',
    description: 'Average Directional Index',
    category: 'trend',
    overlay: false,
    covers: 'Average Directional Index',
    tags: ['adx', 'dmi'],
    code: pineIndicator(
      'AXIS ADX',
      'ADX',
      false,
      `len = input.int(14, "DI length", minval=1)
smooth = input.int(14, "ADX smooth", minval=1)
a = ta.adx(len, smooth)
plot(a, "ADX", color=${COL.indigo}, linewidth=2)
hline(25, "Trend", color=${COL.amber}, linestyle=hline.style_dashed)`,
    ),
  }),
  def({
    id: 'dmi',
    title: 'AXIS DMI',
    shorttitle: 'DMI',
    description: '+DI / −DI / ADX',
    category: 'trend',
    overlay: false,
    covers: 'Directional Movement Index',
    tags: ['dmi', 'adx'],
    code: pineIndicator(
      'AXIS DMI',
      'DMI',
      false,
      `len = input.int(14, "DI length", minval=1)
smooth = input.int(14, "ADX smooth", minval=1)
[plusDi, minusDi, adx] = ta.dmi(len, smooth)
plot(plusDi, "+DI", color=${COL.emerald})
plot(minusDi, "-DI", color=${COL.rose})
plot(adx, "ADX", color=${COL.indigo}, linewidth=2)
hline(25, "Trend", color=${COL.slate}, linestyle=hline.style_dotted)`,
    ),
  }),
  def({
    id: 'aroon',
    title: 'AXIS Aroon',
    shorttitle: 'Aroon',
    description: 'Aroon up / down',
    category: 'trend',
    overlay: false,
    covers: 'Aroon',
    tags: ['aroon'],
    code: pineIndicator(
      'AXIS Aroon',
      'Aroon',
      false,
      `len = input.int(14, "Length", minval=1)
[dn, up] = ta.aroon(len)
plot(up, "Up", color=${COL.emerald})
plot(dn, "Down", color=${COL.rose})`,
    ),
  }),
  def({
    id: 'aroon-osc',
    title: 'AXIS Aroon Osc',
    shorttitle: 'AroonOsc',
    description: 'Aroon up − Aroon down',
    category: 'trend',
    overlay: false,
    covers: 'Aroon Oscillator',
    tags: ['aroon'],
    code: pineIndicator(
      'AXIS Aroon Osc',
      'AroonOsc',
      false,
      `len = input.int(14, "Length", minval=1)
[dn, up] = ta.aroon(len)
osc = up - dn
plot(osc, "Aroon Osc", color=${COL.indigo}, linewidth=2)
hline(0, "Zero", color=${COL.slate})`,
    ),
  }),
  def({
    id: 'sar',
    title: 'AXIS SAR',
    shorttitle: 'SAR',
    description: 'Parabolic SAR',
    category: 'trend',
    covers: 'Parabolic SAR',
    tags: ['sar', 'overlay'],
    code: pineIndicator(
      'AXIS SAR',
      'SAR',
      true,
      `start = input.float(0.02, "Start", minval=0.001, step=0.01)
inc = input.float(0.02, "Increment", minval=0.001, step=0.01)
maxAf = input.float(0.2, "Max", minval=0.01, step=0.01)
s = ta.sar(start, inc, maxAf)
plot(s, "SAR", color=${COL.amber}, style=plot.style_cross, linewidth=2)`,
    ),
  }),
  def({
    id: 'vortex',
    title: 'AXIS Vortex',
    shorttitle: 'VI',
    description: 'Vortex Indicator (+VI / −VI)',
    category: 'trend',
    overlay: false,
    covers: 'Vortex Indicator',
    tags: ['vortex'],
    code: pineIndicator(
      'AXIS Vortex',
      'VI',
      false,
      `len = input.int(14, "Length", minval=1)
vmp = math.abs(high - low[1])
vmm = math.abs(low - high[1])
str = ta.atr(1)
plusVi = ta.sum(vmp, len) / ta.sum(str, len)
minusVi = ta.sum(vmm, len) / ta.sum(str, len)
plot(plusVi, "+VI", color=${COL.emerald})
plot(minusVi, "-VI", color=${COL.rose})`,
    ),
  }),
  def({
    id: 'ichimoku',
    title: 'AXIS Ichimoku',
    shorttitle: 'Ichimoku',
    description: 'Conversion, base, spans, lagging line',
    category: 'trend',
    covers: 'Ichimoku Cloud',
    tags: ['ichimoku', 'overlay'],
    code: pineIndicator(
      'AXIS Ichimoku',
      'Ichimoku',
      true,
      `convLen = input.int(9, "Conversion", minval=1)
baseLen = input.int(26, "Base", minval=1)
spanBLen = input.int(52, "Span B", minval=1)
displace = input.int(26, "Displacement", minval=1)
mid(len) =>
    (ta.highest(high, len) + ta.lowest(low, len)) / 2.0
conversion = mid(convLen)
base = mid(baseLen)
spanA = (conversion + base) / 2.0
spanB = mid(spanBLen)
plot(conversion, "Conversion", color=${COL.cyan})
plot(base, "Base", color=${COL.amber})
pA = plot(spanA, "Span A", offset=displace, color=${COL.emerald})
pB = plot(spanB, "Span B", offset=displace, color=${COL.rose})
fill(pA, pB, color=spanA > spanB ? color.new(${COL.emerald}, 85) : color.new(${COL.rose}, 85), title="Cloud")
plot(close, "Lagging", offset=-displace, color=${COL.slate})`,
    ),
  }),
  def({
    id: 'chande-kroll',
    title: 'AXIS Chande Kroll',
    shorttitle: 'CKS',
    description: 'Chande Kroll stop (ATR trailing extremes)',
    category: 'trend',
    covers: 'Chande Kroll Stop',
    tags: ['stop', 'atr', 'overlay'],
    code: pineIndicator(
      'AXIS Chande Kroll',
      'CKS',
      true,
      `p = input.int(10, "Period", minval=1)
q = input.int(9, "Stop period", minval=1)
x = input.float(1.0, "ATR mult", minval=0.1, step=0.1)
atr = ta.atr(p)
firstHigh = ta.highest(high, p) - x * atr
firstLow = ta.lowest(low, p) + x * atr
stopShort = ta.highest(firstHigh, q)
stopLong = ta.lowest(firstLow, q)
plot(stopLong, "Long stop", color=${COL.emerald})
plot(stopShort, "Short stop", color=${COL.rose})`,
    ),
  }),
  def({
    id: 'chandelier',
    title: 'AXIS Chandelier',
    shorttitle: 'CE',
    description: 'Chandelier exit (highest/lowest ± ATR)',
    category: 'trend',
    covers: 'Chandelier Exit',
    tags: ['chandelier', 'atr', 'overlay'],
    code: pineIndicator(
      'AXIS Chandelier',
      'CE',
      true,
      `len = input.int(22, "Length", minval=1)
mult = input.float(3.0, "ATR mult", minval=0.1, step=0.1)
atr = ta.atr(len)
longStop = ta.highest(high, len) - atr * mult
shortStop = ta.lowest(low, len) + atr * mult
plot(longStop, "Long exit", color=${COL.emerald})
plot(shortStop, "Short exit", color=${COL.rose})`,
    ),
  }),
  def({
    id: 'vol-stop',
    title: 'AXIS Vol Stop',
    shorttitle: 'VStop',
    description: 'ATR trailing stop around close',
    category: 'trend',
    covers: 'Volatility Stop',
    tags: ['atr', 'stop', 'overlay'],
    code: pineIndicator(
      'AXIS Vol Stop',
      'VStop',
      true,
      `len = input.int(20, "ATR", minval=1)
mult = input.float(2.0, "Mult", minval=0.1, step=0.1)
atr = ta.atr(len)
up = close - atr * mult
dn = close + atr * mult
var float stop = na
var int dir = 1
stop := na(stop) ? up : dir == 1 ? math.max(up, nz(stop)) : math.min(dn, nz(stop))
if dir == 1 and close < stop
    dir := -1
    stop := dn
else if dir == -1 and close > stop
    dir := 1
    stop := up
plot(dir == 1 ? stop : na, "Long stop", color=${COL.emerald}, style=plot.style_linebr, linewidth=2)
plot(dir == -1 ? stop : na, "Short stop", color=${COL.rose}, style=plot.style_linebr, linewidth=2)`,
    ),
  }),
  def({
    id: 'alligator',
    title: 'AXIS Alligator',
    shorttitle: 'Gator',
    description: 'Three smoothed MAs of median price (jaw / teeth / lips)',
    category: 'trend',
    covers: 'Williams Alligator',
    tags: ['alligator', 'overlay'],
    code: pineIndicator(
      'AXIS Alligator',
      'Gator',
      true,
      `jawLen = input.int(13, "Jaw", minval=1)
teethLen = input.int(8, "Teeth", minval=1)
lipsLen = input.int(5, "Lips", minval=1)
jawOff = input.int(8, "Jaw offset")
teethOff = input.int(5, "Teeth offset")
lipsOff = input.int(3, "Lips offset")
src = hl2
jaw = ta.rma(src, jawLen)
teeth = ta.rma(src, teethLen)
lips = ta.rma(src, lipsLen)
plot(jaw, "Jaw", offset=jawOff, color=${COL.indigo})
plot(teeth, "Teeth", offset=teethOff, color=${COL.rose})
plot(lips, "Lips", offset=lipsOff, color=${COL.emerald})`,
    ),
  }),
  def({
    id: 'fractals',
    title: 'AXIS Fractals',
    shorttitle: 'Frac',
    description: '5-bar Williams fractals',
    category: 'trend',
    covers: 'Williams Fractals',
    tags: ['fractal', 'overlay'],
    code: pineIndicator(
      'AXIS Fractals',
      'Frac',
      true,
      `up = high[2] > high[1] and high[2] > high[0] and high[2] > high[3] and high[2] > high[4]
dn = low[2] < low[1] and low[2] < low[0] and low[2] < low[3] and low[2] < low[4]
plotshape(up, "Up fractal", shape.triangledown, location.abovebar, ${COL.rose}, offset=-2, size=size.tiny)
plotshape(dn, "Down fractal", shape.triangleup, location.belowbar, ${COL.emerald}, offset=-2, size=size.tiny)`,
    ),
  }),
  def({
    id: 'zigzag',
    title: 'AXIS ZigZag',
    shorttitle: 'ZZ',
    description: 'Percent-reversal zigzag of close',
    category: 'trend',
    covers: 'ZigZag',
    tags: ['zigzag', 'overlay'],
    code: pineIndicator(
      'AXIS ZigZag',
      'ZZ',
      true,
      `dev = input.float(5.0, "Reversal %", minval=0.1, step=0.1)
src = input.source(close, "Source")
var float pivot = na
var int dir = 0
// Plot only confirmed pivots (na elsewhere) so linebr connects swings.
// The last bar also plots the live extreme, otherwise a rally never
// leaves the previous confirmed pivot.
float point = na
float thresh = nz(pivot) * dev / 100.0
if na(pivot)
    pivot := src
    point := src
else if dir >= 0
    if src > pivot
        pivot := src
    else if src <= pivot - thresh
        point := pivot
        dir := -1
        pivot := src
else
    if src < pivot
        pivot := src
    else if src >= pivot + thresh
        point := pivot
        dir := 1
        pivot := src
if barstate.islast
    point := pivot
plot(point, "ZigZag", color=${COL.amber}, linewidth=2, style=plot.style_linebr)`,
    ),
  }),
];
