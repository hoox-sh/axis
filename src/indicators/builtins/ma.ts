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
 * Original AXIS moving-average built-ins.
 *
 * @module indicators/builtins/ma
 */

import { COL, def, pineIndicator } from './pine';
import type { BuiltinScript } from './types';

function maPlot(fn: string, short: string): string {
  return `len = input.int(20, "Length", minval=1)
src = input.source(close, "Source")
out = ${fn}
plot(out, "${short}", color=${COL.indigo}, linewidth=2)`;
}

export const MA_BUILTINS: readonly BuiltinScript[] = [
  def({
    id: 'sma',
    title: 'AXIS SMA',
    shorttitle: 'SMA',
    description: 'Simple moving average of source',
    category: 'moving-average',
    covers: 'Simple moving average',
    tags: ['ma', 'sma', 'overlay'],
    code: pineIndicator('AXIS SMA', 'SMA', true, maPlot('ta.sma(src, len)', 'SMA')),
  }),
  def({
    id: 'ema',
    title: 'AXIS EMA',
    shorttitle: 'EMA',
    description: 'Exponential moving average of source',
    category: 'moving-average',
    covers: 'Exponential moving average',
    tags: ['ma', 'ema', 'overlay'],
    code: pineIndicator('AXIS EMA', 'EMA', true, maPlot('ta.ema(src, len)', 'EMA')),
  }),
  def({
    id: 'wma',
    title: 'AXIS WMA',
    shorttitle: 'WMA',
    description: 'Linear-weighted moving average',
    category: 'moving-average',
    covers: 'Weighted moving average',
    tags: ['ma', 'wma', 'overlay'],
    code: pineIndicator('AXIS WMA', 'WMA', true, maPlot('ta.wma(src, len)', 'WMA')),
  }),
  def({
    id: 'rma',
    title: 'AXIS RMA',
    shorttitle: 'RMA',
    description: 'Wilder / smoothed moving average (RMA)',
    category: 'moving-average',
    covers: 'Smoothed moving average (Wilder RMA)',
    tags: ['ma', 'rma', 'smma', 'overlay'],
    code: pineIndicator('AXIS RMA', 'RMA', true, maPlot('ta.rma(src, len)', 'RMA')),
  }),
  def({
    id: 'vwma',
    title: 'AXIS VWMA',
    shorttitle: 'VWMA',
    description: 'Volume-weighted moving average',
    category: 'moving-average',
    covers: 'Volume-weighted moving average',
    tags: ['ma', 'vwma', 'volume', 'overlay'],
    code: pineIndicator('AXIS VWMA', 'VWMA', true, maPlot('ta.vwma(src, len)', 'VWMA')),
  }),
  def({
    id: 'hma',
    title: 'AXIS Hull MA',
    shorttitle: 'HMA',
    description: 'Hull moving average',
    category: 'moving-average',
    covers: 'Hull moving average',
    tags: ['ma', 'hma', 'overlay'],
    code: pineIndicator('AXIS Hull MA', 'HMA', true, maPlot('ta.hma(src, len)', 'HMA')),
  }),
  def({
    id: 'dema',
    title: 'AXIS DEMA',
    shorttitle: 'DEMA',
    description: 'Double exponential moving average',
    category: 'moving-average',
    covers: 'Double exponential moving average',
    tags: ['ma', 'dema', 'overlay'],
    code: pineIndicator('AXIS DEMA', 'DEMA', true, maPlot('ta.dema(src, len)', 'DEMA')),
  }),
  def({
    id: 'tema',
    title: 'AXIS TEMA',
    shorttitle: 'TEMA',
    description: 'Triple exponential moving average',
    category: 'moving-average',
    covers: 'Triple exponential moving average',
    tags: ['ma', 'tema', 'overlay'],
    code: pineIndicator('AXIS TEMA', 'TEMA', true, maPlot('ta.tema(src, len)', 'TEMA')),
  }),
  def({
    id: 'alma',
    title: 'AXIS ALMA',
    shorttitle: 'ALMA',
    description: 'Arnaud Legoux moving average',
    category: 'moving-average',
    covers: 'Arnaud Legoux moving average',
    tags: ['ma', 'alma', 'overlay'],
    code: pineIndicator(
      'AXIS ALMA',
      'ALMA',
      true,
      `len = input.int(9, "Length", minval=1)
offset = input.float(0.85, "Offset", minval=0.0, maxval=1.0, step=0.05)
sigma = input.float(6.0, "Sigma", minval=0.1, step=0.1)
src = input.source(close, "Source")
out = ta.alma(src, len, offset, sigma)
plot(out, "ALMA", color=${COL.indigo}, linewidth=2)`,
    ),
  }),
  def({
    id: 'kama',
    title: 'AXIS KAMA',
    shorttitle: 'KAMA',
    description: 'Kaufman adaptive moving average',
    category: 'moving-average',
    covers: 'Kaufman adaptive moving average',
    tags: ['ma', 'kama', 'overlay'],
    code: pineIndicator(
      'AXIS KAMA',
      'KAMA',
      true,
      `len = input.int(10, "Length", minval=1)
fast = input.int(2, "Fast", minval=1)
slow = input.int(30, "Slow", minval=1)
src = input.source(close, "Source")
out = ta.kama(src, len, fast, slow)
plot(out, "KAMA", color=${COL.indigo}, linewidth=2)`,
    ),
  }),
  def({
    id: 'lsma',
    title: 'AXIS LSMA',
    shorttitle: 'LSMA',
    description: 'Least-squares (linear regression) moving average',
    category: 'moving-average',
    covers: 'Least-squares moving average',
    tags: ['ma', 'linreg', 'lsma', 'overlay'],
    code: pineIndicator(
      'AXIS LSMA',
      'LSMA',
      true,
      `len = input.int(25, "Length", minval=1)
src = input.source(close, "Source")
out = ta.linreg(src, len, 0)
plot(out, "LSMA", color=${COL.indigo}, linewidth=2)`,
    ),
  }),
  def({
    id: 'median',
    title: 'AXIS Median',
    shorttitle: 'MED',
    description: 'Rolling median of source',
    category: 'moving-average',
    covers: 'Rolling median',
    tags: ['ma', 'median', 'overlay'],
    code: pineIndicator('AXIS Median', 'MED', true, maPlot('ta.median(src, len)', 'Median')),
  }),
  def({
    id: 'swma',
    title: 'AXIS SWMA',
    shorttitle: 'SWMA',
    description: 'Symmetrically weighted moving average',
    category: 'moving-average',
    covers: 'Symmetrically weighted moving average',
    tags: ['ma', 'swma', 'overlay'],
    code: pineIndicator(
      'AXIS SWMA',
      'SWMA',
      true,
      `src = input.source(close, "Source")
out = ta.swma(src)
plot(out, "SWMA", color=${COL.indigo}, linewidth=2)`,
    ),
  }),
  def({
    id: 'mcginley',
    title: 'AXIS McGinley',
    shorttitle: 'MD',
    description: 'McGinley Dynamic (public recursive formula)',
    category: 'moving-average',
    covers: 'McGinley Dynamic',
    tags: ['ma', 'mcginley', 'overlay'],
    code: pineIndicator(
      'AXIS McGinley',
      'MD',
      true,
      `len = input.int(12, "Length", minval=1)
src = input.source(close, "Source")
var float md = na
float ratio = na(md) or md == 0.0 ? 1.0 : src / md
float k = len * math.pow(ratio, 4)
md := na(md) ? src : md + (src - md) / k
plot(md, "McGinley", color=${COL.cyan}, linewidth=2)`,
    ),
  }),
  def({
    id: 'ma-ribbon',
    title: 'AXIS MA Ribbon',
    shorttitle: 'Ribbon',
    description: 'Four EMAs as a trend ribbon',
    category: 'moving-average',
    covers: 'Moving-average ribbon',
    tags: ['ma', 'ema', 'ribbon', 'overlay'],
    code: pineIndicator(
      'AXIS MA Ribbon',
      'Ribbon',
      true,
      `src = input.source(close, "Source")
l1 = input.int(8, "EMA 1", minval=1)
l2 = input.int(13, "EMA 2", minval=1)
l3 = input.int(21, "EMA 3", minval=1)
l4 = input.int(34, "EMA 4", minval=1)
e1 = ta.ema(src, l1)
e2 = ta.ema(src, l2)
e3 = ta.ema(src, l3)
e4 = ta.ema(src, l4)
p1 = plot(e1, "EMA 8", color=${COL.cyan})
p2 = plot(e2, "EMA 13", color=${COL.indigo})
p3 = plot(e3, "EMA 21", color=${COL.amber})
p4 = plot(e4, "EMA 34", color=${COL.rose})
fill(p1, p2, color=color.new(${COL.cyan}, 88))
fill(p3, p4, color=color.new(${COL.rose}, 90))`,
    ),
  }),
  def({
    id: 'envelope',
    title: 'AXIS Envelope',
    shorttitle: 'Env',
    description: 'Percent envelope around an SMA',
    category: 'moving-average',
    covers: 'Moving-average envelope',
    tags: ['ma', 'envelope', 'overlay'],
    code: pineIndicator(
      'AXIS Envelope',
      'Env',
      true,
      `len = input.int(20, "Length", minval=1)
pct = input.float(2.5, "Percent", minval=0.1, step=0.1)
src = input.source(close, "Source")
basis = ta.sma(src, len)
k = pct / 100.0
upper = basis * (1.0 + k)
lower = basis * (1.0 - k)
plot(basis, "Basis", color=${COL.indigo})
u = plot(upper, "Upper", color=${COL.cyan})
l = plot(lower, "Lower", color=${COL.cyan})
fill(u, l, color=color.new(${COL.indigo}, 92))`,
    ),
  }),
  def({
    id: 'ma-cross',
    title: 'AXIS MA Cross',
    shorttitle: 'MA X',
    description: 'Fast / slow SMA with cross markers',
    category: 'moving-average',
    covers: 'Moving-average crossover (study)',
    tags: ['ma', 'cross', 'overlay'],
    code: pineIndicator(
      'AXIS MA Cross',
      'MA X',
      true,
      `fastLen = input.int(9, "Fast", minval=1)
slowLen = input.int(21, "Slow", minval=1)
src = input.source(close, "Source")
fast = ta.sma(src, fastLen)
slow = ta.sma(src, slowLen)
plot(fast, "Fast", color=${COL.cyan})
plot(slow, "Slow", color=${COL.amber})
bull = ta.crossover(fast, slow)
bear = ta.crossunder(fast, slow)
plotshape(bull, "Up", shape.triangleup, location.belowbar, ${COL.emerald}, size=size.tiny)
plotshape(bear, "Down", shape.triangledown, location.abovebar, ${COL.rose}, size=size.tiny)`,
    ),
  }),
];
