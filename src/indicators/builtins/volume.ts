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
 * Original AXIS volume built-ins.
 *
 * @module indicators/builtins/volume
 */

import { COL, def, pineIndicator } from './pine';
import type { BuiltinScript } from './types';

export const VOLUME_BUILTINS: readonly BuiltinScript[] = [
  def({
    id: 'volume',
    title: 'AXIS Volume',
    shorttitle: 'Vol',
    description: 'Volume columns vs SMA',
    category: 'volume',
    overlay: false,
    covers: 'Volume',
    tags: ['volume'],
    code: pineIndicator(
      'AXIS Volume',
      'Vol',
      false,
      `len = input.int(20, "MA", minval=1)
up = close >= open
plot(volume, "Volume", style=plot.style_columns, color=up ? ${COL.emerald} : ${COL.rose})
plot(ta.sma(volume, len), "Vol MA", color=${COL.amber})`,
    ),
  }),
  def({
    id: 'obv',
    title: 'AXIS OBV',
    shorttitle: 'OBV',
    description: 'On-balance volume',
    category: 'volume',
    overlay: false,
    covers: 'On-Balance Volume',
    tags: ['obv', 'volume'],
    code: pineIndicator(
      'AXIS OBV',
      'OBV',
      false,
      `o = ta.obv
plot(o, "OBV", color=${COL.indigo}, linewidth=2)`,
    ),
  }),
  def({
    id: 'vwap',
    title: 'AXIS VWAP',
    shorttitle: 'VWAP',
    description: 'Volume-weighted average price',
    category: 'volume',
    covers: 'VWAP',
    tags: ['vwap', 'overlay'],
    code: pineIndicator(
      'AXIS VWAP',
      'VWAP',
      true,
      `src = input.source(hlc3, "Source")
v = ta.vwap(src)
plot(v, "VWAP", color=${COL.amber}, linewidth=2)`,
    ),
  }),
  def({
    id: 'vwap-bands',
    title: 'AXIS VWAP Bands',
    shorttitle: 'VWAP σ',
    description: 'VWAP ± rolling stdev of (source − VWAP)',
    category: 'volume',
    covers: 'VWAP standard-deviation bands',
    tags: ['vwap', 'bands', 'overlay'],
    code: pineIndicator(
      'AXIS VWAP Bands',
      'VWAP σ',
      true,
      `src = input.source(hlc3, "Source")
n1 = input.float(1.0, "Band 1", minval=0.1, step=0.1)
n2 = input.float(2.0, "Band 2", minval=0.1, step=0.1)
basis = ta.vwap(src)
dev = ta.stdev(src - basis, 20)
plot(basis, "VWAP", color=${COL.amber}, linewidth=2)
u1 = plot(basis + n1 * dev, "Upper1", color=${COL.cyan})
l1 = plot(basis - n1 * dev, "Lower1", color=${COL.cyan})
plot(basis + n2 * dev, "Upper2", color=color.new(${COL.cyan}, 40))
plot(basis - n2 * dev, "Lower2", color=color.new(${COL.cyan}, 40))
fill(u1, l1, color=color.new(${COL.amber}, 92))`,
    ),
  }),
  def({
    id: 'twap',
    title: 'AXIS TWAP',
    shorttitle: 'TWAP',
    description: 'Session time-weighted average of hlc3',
    category: 'volume',
    covers: 'Time-weighted average price',
    tags: ['twap', 'overlay'],
    code: pineIndicator(
      'AXIS TWAP',
      'TWAP',
      true,
      `src = input.source(hlc3, "Source")
newSess = timeframe.change("D")
var float acc = 0.0
var int n = 0
if newSess
    acc := src
    n := 1
else
    acc += src
    n += 1
tw = n == 0 ? na : acc / n
plot(tw, "TWAP", color=${COL.cyan}, linewidth=2)`,
    ),
  }),
  def({
    id: 'cmf',
    title: 'AXIS CMF',
    shorttitle: 'CMF',
    description: 'Chaikin Money Flow',
    category: 'volume',
    overlay: false,
    covers: 'Chaikin Money Flow',
    tags: ['cmf', 'volume'],
    code: pineIndicator(
      'AXIS CMF',
      'CMF',
      false,
      `len = input.int(20, "Length", minval=1)
c = ta.cmf(len)
plot(c, "CMF", color=${COL.indigo}, linewidth=2)
hline(0, "Zero", color=${COL.slate})`,
    ),
  }),
  def({
    id: 'chaikin-osc',
    title: 'AXIS Chaikin Osc',
    shorttitle: 'CHO',
    description: 'EMA difference of accumulation/distribution',
    category: 'volume',
    overlay: false,
    covers: 'Chaikin Oscillator',
    tags: ['chaikin', 'volume'],
    code: pineIndicator(
      'AXIS Chaikin Osc',
      'CHO',
      false,
      `fast = input.int(3, "Fast", minval=1)
slow = input.int(10, "Slow", minval=1)
ad = ta.accdist
cho = ta.ema(ad, fast) - ta.ema(ad, slow)
plot(cho, "CHO", color=${COL.cyan}, linewidth=2)
hline(0, "Zero", color=${COL.slate})`,
    ),
  }),
  def({
    id: 'mfi',
    title: 'AXIS MFI',
    shorttitle: 'MFI',
    description: 'Money Flow Index',
    category: 'volume',
    overlay: false,
    covers: 'Money Flow Index',
    tags: ['mfi', 'volume'],
    code: pineIndicator(
      'AXIS MFI',
      'MFI',
      false,
      `len = input.int(14, "Length", minval=1)
m = ta.mfi(len)
plot(m, "MFI", color=${COL.indigo}, linewidth=2)
hline(80, "OB", color=${COL.rose}, linestyle=hline.style_dashed)
hline(20, "OS", color=${COL.emerald}, linestyle=hline.style_dashed)`,
    ),
  }),
  def({
    id: 'ad',
    title: 'AXIS A/D',
    shorttitle: 'AD',
    description: 'Accumulation / Distribution',
    category: 'volume',
    overlay: false,
    covers: 'Accumulation/Distribution',
    tags: ['ad', 'volume'],
    code: pineIndicator(
      'AXIS A/D',
      'AD',
      false,
      `a = ta.accdist
plot(a, "A/D", color=${COL.indigo}, linewidth=2)`,
    ),
  }),
  def({
    id: 'emv',
    title: 'AXIS EMV',
    shorttitle: 'EMV',
    description: 'Ease of Movement',
    category: 'volume',
    overlay: false,
    covers: 'Ease of Movement',
    tags: ['emv', 'volume'],
    code: pineIndicator(
      'AXIS EMV',
      'EMV',
      false,
      `len = input.int(14, "Length", minval=1)
e = ta.emv(len)
plot(e, "EMV", color=${COL.amber}, linewidth=2)
hline(0, "Zero", color=${COL.slate})`,
    ),
  }),
  def({
    id: 'efi',
    title: 'AXIS Force',
    shorttitle: 'EFI',
    description: 'Elder Force Index',
    category: 'volume',
    overlay: false,
    covers: 'Elder Force Index',
    tags: ['elder', 'force', 'volume'],
    code: pineIndicator(
      'AXIS Force',
      'EFI',
      false,
      `len = input.int(13, "EMA", minval=1)
raw = ta.change(close) * volume
f = ta.ema(raw, len)
plot(f, "Force", color=${COL.indigo})
hline(0, "Zero", color=${COL.slate})`,
    ),
  }),
  def({
    id: 'klinger',
    title: 'AXIS Klinger',
    shorttitle: 'KO',
    description: 'Klinger Oscillator',
    category: 'volume',
    overlay: false,
    covers: 'Klinger Oscillator',
    tags: ['klinger', 'volume'],
    code: pineIndicator(
      'AXIS Klinger',
      'KO',
      false,
      `fast = input.int(34, "Fast", minval=1)
slow = input.int(55, "Slow", minval=1)
sig = input.int(13, "Signal", minval=1)
// Signed volume force (public idea: volume × HLC trend), EMA difference.
trend = hlc3 >= nz(hlc3[1]) ? 1.0 : -1.0
sv = volume * trend
k = ta.ema(sv, fast) - ta.ema(sv, slow)
s = ta.ema(k, sig)
plot(k, "KO", color=${COL.indigo})
plot(s, "Signal", color=${COL.amber})
hline(0, "Zero", color=${COL.slate})`,
    ),
  }),
  def({
    id: 'nvi',
    title: 'AXIS NVI',
    shorttitle: 'NVI',
    description: 'Negative Volume Index',
    category: 'volume',
    overlay: false,
    covers: 'Negative Volume Index',
    tags: ['nvi', 'volume'],
    code: pineIndicator(
      'AXIS NVI',
      'NVI',
      false,
      `n = ta.nvi
plot(n, "NVI", color=${COL.cyan}, linewidth=2)
plot(ta.ema(n, 255), "EMA", color=${COL.amber})`,
    ),
  }),
  def({
    id: 'pvi',
    title: 'AXIS PVI',
    shorttitle: 'PVI',
    description: 'Positive Volume Index',
    category: 'volume',
    overlay: false,
    covers: 'Positive Volume Index',
    tags: ['pvi', 'volume'],
    code: pineIndicator(
      'AXIS PVI',
      'PVI',
      false,
      `p = ta.pvi
plot(p, "PVI", color=${COL.indigo}, linewidth=2)
plot(ta.ema(p, 255), "EMA", color=${COL.amber})`,
    ),
  }),
  def({
    id: 'net-volume',
    title: 'AXIS Net Volume',
    shorttitle: 'NetVol',
    description: 'Cumulative signed volume (close vs prior close)',
    category: 'volume',
    overlay: false,
    covers: 'Net Volume',
    tags: ['volume', 'net'],
    code: pineIndicator(
      'AXIS Net Volume',
      'NetVol',
      false,
      `signed = close > close[1] ? volume : close < close[1] ? -volume : 0.0
nv = ta.cum(signed)
plot(nv, "Net vol", color=${COL.indigo}, linewidth=2)`,
    ),
  }),
  def({
    id: 'pvt',
    title: 'AXIS PVT',
    shorttitle: 'PVT',
    description: 'Price-volume trend',
    category: 'volume',
    overlay: false,
    covers: 'Price Volume Trend',
    tags: ['pvt', 'volume'],
    code: pineIndicator(
      'AXIS PVT',
      'PVT',
      false,
      `p = ta.pvt
plot(p, "PVT", color=${COL.cyan}, linewidth=2)`,
    ),
  }),
];
