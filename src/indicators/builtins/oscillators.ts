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
 * Original AXIS oscillator built-ins.
 *
 * @module indicators/builtins/oscillators
 */

import { COL, def, pineIndicator } from './pine';
import type { BuiltinScript } from './types';

export const OSCILLATOR_BUILTINS: readonly BuiltinScript[] = [
  def({
    id: 'rsi',
    title: 'AXIS RSI',
    shorttitle: 'RSI',
    description: 'Relative Strength Index with OB/OS lines',
    category: 'oscillator',
    overlay: false,
    covers: 'Relative Strength Index',
    tags: ['rsi', 'momentum'],
    code: pineIndicator(
      'AXIS RSI',
      'RSI',
      false,
      `len = input.int(14, "Length", minval=1)
ob = input.float(70, "Overbought")
os = input.float(30, "Oversold")
src = input.source(close, "Source")
r = ta.rsi(src, len)
plot(r, "RSI", color=${COL.indigo}, linewidth=2)
hline(ob, "OB", color=${COL.rose}, linestyle=hline.style_dashed)
hline(os, "OS", color=${COL.emerald}, linestyle=hline.style_dashed)
hline(50, "Mid", color=${COL.slate}, linestyle=hline.style_dotted)
bgcolor(r > ob ? color.new(${COL.rose}, 90) : r < os ? color.new(${COL.emerald}, 90) : na)`,
    ),
  }),
  def({
    id: 'stoch',
    title: 'AXIS Stochastic',
    shorttitle: 'Stoch',
    description: 'Slow stochastic %K / %D',
    category: 'oscillator',
    overlay: false,
    covers: 'Stochastic oscillator',
    tags: ['stoch', 'momentum'],
    code: pineIndicator(
      'AXIS Stochastic',
      'Stoch',
      false,
      `kLen = input.int(14, "K length", minval=1)
kSmooth = input.int(3, "K smooth", minval=1)
dSmooth = input.int(3, "D smooth", minval=1)
ob = input.float(80, "Overbought")
os = input.float(20, "Oversold")
k = ta.sma(ta.stoch(close, high, low, kLen), kSmooth)
d = ta.sma(k, dSmooth)
plot(k, "%K", color=${COL.indigo})
plot(d, "%D", color=${COL.amber})
hline(ob, "OB", color=${COL.rose}, linestyle=hline.style_dashed)
hline(os, "OS", color=${COL.emerald}, linestyle=hline.style_dashed)`,
    ),
  }),
  def({
    id: 'stoch-rsi',
    title: 'AXIS Stoch RSI',
    shorttitle: 'StochRSI',
    description: 'Stochastic of RSI',
    category: 'oscillator',
    overlay: false,
    covers: 'Stochastic RSI',
    tags: ['stoch', 'rsi'],
    code: pineIndicator(
      'AXIS Stoch RSI',
      'StochRSI',
      false,
      `rsiLen = input.int(14, "RSI length", minval=1)
stochLen = input.int(14, "Stoch length", minval=1)
kSmooth = input.int(3, "K", minval=1)
dSmooth = input.int(3, "D", minval=1)
r = ta.rsi(close, rsiLen)
k = ta.sma(ta.stoch(r, r, r, stochLen), kSmooth)
d = ta.sma(k, dSmooth)
plot(k, "%K", color=${COL.indigo})
plot(d, "%D", color=${COL.amber})
hline(80, "OB", color=${COL.rose}, linestyle=hline.style_dashed)
hline(20, "OS", color=${COL.emerald}, linestyle=hline.style_dashed)`,
    ),
  }),
  def({
    id: 'macd',
    title: 'AXIS MACD',
    shorttitle: 'MACD',
    description: 'MACD, signal, and histogram',
    category: 'oscillator',
    overlay: false,
    covers: 'MACD',
    tags: ['macd', 'momentum'],
    code: pineIndicator(
      'AXIS MACD',
      'MACD',
      false,
      `fastLen = input.int(12, "Fast", minval=1)
slowLen = input.int(26, "Slow", minval=1)
sigLen = input.int(9, "Signal", minval=1)
src = input.source(close, "Source")
[macdLine, signalLine, hist] = ta.macd(src, fastLen, slowLen, sigLen)
plot(hist, "Hist", style=plot.style_columns, color=hist >= 0 ? ${COL.emerald} : ${COL.rose})
plot(macdLine, "MACD", color=${COL.indigo})
plot(signalLine, "Signal", color=${COL.amber})
hline(0, "Zero", color=${COL.slate})`,
    ),
  }),
  def({
    id: 'cci',
    title: 'AXIS CCI',
    shorttitle: 'CCI',
    description: 'Commodity Channel Index',
    category: 'oscillator',
    overlay: false,
    covers: 'Commodity Channel Index',
    tags: ['cci', 'momentum'],
    code: pineIndicator(
      'AXIS CCI',
      'CCI',
      false,
      `len = input.int(20, "Length", minval=1)
src = input.source(hlc3, "Source")
c = ta.cci(src, len)
plot(c, "CCI", color=${COL.indigo}, linewidth=2)
hline(100, "+100", color=${COL.rose}, linestyle=hline.style_dashed)
hline(-100, "-100", color=${COL.emerald}, linestyle=hline.style_dashed)
hline(0, "Zero", color=${COL.slate})`,
    ),
  }),
  def({
    id: 'mom',
    title: 'AXIS Momentum',
    shorttitle: 'MOM',
    description: 'Price momentum (close − close[n])',
    category: 'oscillator',
    overlay: false,
    covers: 'Momentum',
    tags: ['momentum'],
    code: pineIndicator(
      'AXIS Momentum',
      'MOM',
      false,
      `len = input.int(10, "Length", minval=1)
src = input.source(close, "Source")
m = ta.mom(src, len)
plot(m, "Mom", color=${COL.cyan}, linewidth=2)
hline(0, "Zero", color=${COL.slate})`,
    ),
  }),
  def({
    id: 'roc',
    title: 'AXIS ROC',
    shorttitle: 'ROC',
    description: 'Rate of change (%)',
    category: 'oscillator',
    overlay: false,
    covers: 'Rate of change',
    tags: ['roc', 'momentum'],
    code: pineIndicator(
      'AXIS ROC',
      'ROC',
      false,
      `len = input.int(9, "Length", minval=1)
src = input.source(close, "Source")
r = ta.roc(src, len)
plot(r, "ROC", color=${COL.indigo}, linewidth=2)
hline(0, "Zero", color=${COL.slate})`,
    ),
  }),
  def({
    id: 'willr',
    title: 'AXIS Williams %R',
    shorttitle: '%R',
    description: 'Williams percent range',
    category: 'oscillator',
    overlay: false,
    covers: 'Williams %R',
    tags: ['williams', 'percent-r'],
    code: pineIndicator(
      'AXIS Williams %R',
      '%R',
      false,
      `len = input.int(14, "Length", minval=1)
w = ta.willr(len)
plot(w, "%R", color=${COL.amber}, linewidth=2)
hline(-20, "OB", color=${COL.rose}, linestyle=hline.style_dashed)
hline(-80, "OS", color=${COL.emerald}, linestyle=hline.style_dashed)`,
    ),
  }),
  def({
    id: 'ao',
    title: 'AXIS Awesome',
    shorttitle: 'AO',
    description: 'Awesome Oscillator (SMA 5 − SMA 34 of hl2)',
    category: 'oscillator',
    overlay: false,
    covers: 'Awesome Oscillator',
    tags: ['ao', 'momentum'],
    code: pineIndicator(
      'AXIS Awesome',
      'AO',
      false,
      `fast = input.int(5, "Fast", minval=1)
slow = input.int(34, "Slow", minval=1)
ao = ta.sma(hl2, fast) - ta.sma(hl2, slow)
plot(ao, "AO", style=plot.style_columns, color=ao >= 0 ? ${COL.emerald} : ${COL.rose})
hline(0, "Zero", color=${COL.slate})`,
    ),
  }),
  def({
    id: 'uo',
    title: 'AXIS Ultimate',
    shorttitle: 'UO',
    description: 'Ultimate Oscillator',
    category: 'oscillator',
    overlay: false,
    covers: 'Ultimate Oscillator',
    tags: ['uo', 'momentum'],
    code: pineIndicator(
      'AXIS Ultimate',
      'UO',
      false,
      `s7 = input.int(7, "Short", minval=1)
s14 = input.int(14, "Mid", minval=1)
s28 = input.int(28, "Long", minval=1)
u = ta.uo(s7, s14, s28)
plot(u, "UO", color=${COL.indigo}, linewidth=2)
hline(70, "OB", color=${COL.rose}, linestyle=hline.style_dashed)
hline(30, "OS", color=${COL.emerald}, linestyle=hline.style_dashed)`,
    ),
  }),
  def({
    id: 'trix',
    title: 'AXIS TRIX',
    shorttitle: 'TRIX',
    description: 'Triple-smoothed EMA rate of change',
    category: 'oscillator',
    overlay: false,
    covers: 'TRIX',
    tags: ['trix', 'momentum'],
    code: pineIndicator(
      'AXIS TRIX',
      'TRIX',
      false,
      `len = input.int(18, "Length", minval=1)
sig = input.int(9, "Signal", minval=1)
src = input.source(close, "Source")
t = ta.tema(src, len)
trix = t[1] == 0 ? na : 100.0 * (t - t[1]) / t[1]
signal = ta.ema(trix, sig)
plot(trix, "TRIX", color=${COL.indigo})
plot(signal, "Signal", color=${COL.amber})
hline(0, "Zero", color=${COL.slate})`,
    ),
  }),
  def({
    id: 'tsi',
    title: 'AXIS TSI',
    shorttitle: 'TSI',
    description: 'True Strength Index',
    category: 'oscillator',
    overlay: false,
    covers: 'True Strength Index',
    tags: ['tsi', 'momentum'],
    code: pineIndicator(
      'AXIS TSI',
      'TSI',
      false,
      `longLen = input.int(25, "Long", minval=1)
shortLen = input.int(13, "Short", minval=1)
sigLen = input.int(7, "Signal", minval=1)
src = input.source(close, "Source")
t = ta.tsi(src, shortLen, longLen)
s = ta.ema(t, sigLen)
plot(t, "TSI", color=${COL.indigo})
plot(s, "Signal", color=${COL.amber})
hline(0, "Zero", color=${COL.slate})`,
    ),
  }),
  def({
    id: 'cmo',
    title: 'AXIS CMO',
    shorttitle: 'CMO',
    description: 'Chande Momentum Oscillator',
    category: 'oscillator',
    overlay: false,
    covers: 'Chande Momentum Oscillator',
    tags: ['cmo', 'momentum'],
    code: pineIndicator(
      'AXIS CMO',
      'CMO',
      false,
      `len = input.int(14, "Length", minval=1)
src = input.source(close, "Source")
c = ta.cmo(src, len)
plot(c, "CMO", color=${COL.cyan}, linewidth=2)
hline(50, "OB", color=${COL.rose}, linestyle=hline.style_dashed)
hline(-50, "OS", color=${COL.emerald}, linestyle=hline.style_dashed)
hline(0, "Zero", color=${COL.slate})`,
    ),
  }),
  def({
    id: 'fisher',
    title: 'AXIS Fisher',
    shorttitle: 'Fish',
    description: 'Fisher Transform of a normalized high/low range',
    category: 'oscillator',
    overlay: false,
    covers: 'Fisher Transform',
    tags: ['fisher', 'momentum'],
    code: pineIndicator(
      'AXIS Fisher',
      'Fish',
      false,
      `len = input.int(10, "Length", minval=1)
src = hl2
hi = ta.highest(src, len)
lo = ta.lowest(src, len)
raw = hi == lo ? 0.0 : 2.0 * ((src - lo) / (hi - lo) - 0.5)
var float value = 0.0
value := 0.33 * raw + 0.67 * nz(value[1])
value := math.max(-0.999, math.min(0.999, value))
var float fish = 0.0
fish := 0.5 * math.log((1.0 + value) / (1.0 - value)) + 0.5 * nz(fish[1])
plot(fish, "Fisher", color=${COL.indigo})
plot(fish[1], "Trigger", color=${COL.amber})
hline(0, "Zero", color=${COL.slate})`,
    ),
  }),
  def({
    id: 'coppock',
    title: 'AXIS Coppock',
    shorttitle: 'COP',
    description: 'WMA of two ROC terms',
    category: 'oscillator',
    overlay: false,
    covers: 'Coppock Curve',
    tags: ['coppock', 'roc'],
    code: pineIndicator(
      'AXIS Coppock',
      'COP',
      false,
      `wmaLen = input.int(10, "WMA", minval=1)
rocLong = input.int(14, "ROC long", minval=1)
rocShort = input.int(11, "ROC short", minval=1)
src = input.source(close, "Source")
c = ta.wma(ta.roc(src, rocLong) + ta.roc(src, rocShort), wmaLen)
plot(c, "Coppock", color=${COL.indigo}, linewidth=2)
hline(0, "Zero", color=${COL.slate})`,
    ),
  }),
  def({
    id: 'kst',
    title: 'AXIS KST',
    shorttitle: 'KST',
    description: 'Know Sure Thing (weighted ROC sum)',
    category: 'oscillator',
    overlay: false,
    covers: 'Know Sure Thing',
    tags: ['kst', 'roc'],
    code: pineIndicator(
      'AXIS KST',
      'KST',
      false,
      `r1 = ta.roc(close, 10)
r2 = ta.roc(close, 15)
r3 = ta.roc(close, 20)
r4 = ta.roc(close, 30)
kst = ta.sma(r1, 10) + 2.0 * ta.sma(r2, 10) + 3.0 * ta.sma(r3, 10) + 4.0 * ta.sma(r4, 15)
sig = ta.sma(kst, 9)
plot(kst, "KST", color=${COL.indigo})
plot(sig, "Signal", color=${COL.amber})
hline(0, "Zero", color=${COL.slate})`,
    ),
  }),
  def({
    id: 'rvi',
    title: 'AXIS RVI',
    shorttitle: 'RVI',
    description: 'Relative Vigor Index',
    category: 'oscillator',
    overlay: false,
    covers: 'Relative Vigor Index',
    tags: ['rvi', 'momentum'],
    code: pineIndicator(
      'AXIS RVI',
      'RVI',
      false,
      `len = input.int(10, "Length", minval=1)
num = ta.swma(close - open)
den = ta.swma(high - low)
rvi = ta.sma(den == 0 ? na : num / den, len)
sig = ta.swma(rvi)
plot(rvi, "RVI", color=${COL.indigo})
plot(sig, "Signal", color=${COL.amber})
hline(0, "Zero", color=${COL.slate})`,
    ),
  }),
  def({
    id: 'rvi-vol',
    title: 'AXIS Rel Vol',
    shorttitle: 'RVol',
    description: 'Relative Volatility Index (RSI of stdev)',
    category: 'oscillator',
    overlay: false,
    covers: 'Relative Volatility Index',
    tags: ['rvi', 'volatility'],
    code: pineIndicator(
      'AXIS Rel Vol',
      'RVol',
      false,
      `stdevLen = input.int(10, "Stdev", minval=1)
rsiLen = input.int(14, "RSI", minval=1)
sd = ta.stdev(close, stdevLen)
up = close > close[1] ? sd : 0.0
dn = close < close[1] ? sd : 0.0
r = ta.rsi(up - dn, rsiLen)
plot(r, "RVI", color=${COL.cyan}, linewidth=2)
hline(50, "Mid", color=${COL.slate})`,
    ),
  }),
  def({
    id: 'dpo',
    title: 'AXIS DPO',
    shorttitle: 'DPO',
    description: 'Detrended price oscillator',
    category: 'oscillator',
    overlay: false,
    covers: 'Detrended Price Oscillator',
    tags: ['dpo'],
    code: pineIndicator(
      'AXIS DPO',
      'DPO',
      false,
      `len = input.int(21, "Length", minval=1)
src = input.source(close, "Source")
bars = math.floor(len / 2) + 1
dpo = src[bars] - ta.sma(src, len)
plot(dpo, "DPO", color=${COL.indigo})
hline(0, "Zero", color=${COL.slate})`,
    ),
  }),
  def({
    id: 'ppo',
    title: 'AXIS PPO',
    shorttitle: 'PPO',
    description: 'Percentage price oscillator',
    category: 'oscillator',
    overlay: false,
    covers: 'Percentage Price Oscillator',
    tags: ['ppo', 'macd'],
    code: pineIndicator(
      'AXIS PPO',
      'PPO',
      false,
      `fastLen = input.int(12, "Fast", minval=1)
slowLen = input.int(26, "Slow", minval=1)
sigLen = input.int(9, "Signal", minval=1)
src = input.source(close, "Source")
fast = ta.ema(src, fastLen)
slow = ta.ema(src, slowLen)
ppo = slow == 0 ? na : 100.0 * (fast - slow) / slow
sig = ta.ema(ppo, sigLen)
hist = ppo - sig
plot(hist, "Hist", style=plot.style_columns, color=hist >= 0 ? ${COL.emerald} : ${COL.rose})
plot(ppo, "PPO", color=${COL.indigo})
plot(sig, "Signal", color=${COL.amber})
hline(0, "Zero", color=${COL.slate})`,
    ),
  }),
  def({
    id: 'pvo',
    title: 'AXIS PVO',
    shorttitle: 'PVO',
    description: 'Percentage volume oscillator',
    category: 'oscillator',
    overlay: false,
    covers: 'Percentage Volume Oscillator',
    tags: ['pvo', 'volume'],
    code: pineIndicator(
      'AXIS PVO',
      'PVO',
      false,
      `fastLen = input.int(12, "Fast", minval=1)
slowLen = input.int(26, "Slow", minval=1)
sigLen = input.int(9, "Signal", minval=1)
fast = ta.ema(volume, fastLen)
slow = ta.ema(volume, slowLen)
pvo = slow == 0 ? na : 100.0 * (fast - slow) / slow
sig = ta.ema(pvo, sigLen)
plot(pvo, "PVO", color=${COL.indigo})
plot(sig, "Signal", color=${COL.amber})
hline(0, "Zero", color=${COL.slate})`,
    ),
  }),
  def({
    id: 'bop',
    title: 'AXIS BOP',
    shorttitle: 'BOP',
    description: 'Balance of Power',
    category: 'oscillator',
    overlay: false,
    covers: 'Balance of Power',
    tags: ['bop'],
    code: pineIndicator(
      'AXIS BOP',
      'BOP',
      false,
      `len = input.int(14, "Smooth", minval=1)
raw = high == low ? 0.0 : (close - open) / (high - low)
b = ta.sma(raw, len)
plot(b, "BOP", style=plot.style_columns, color=b >= 0 ? ${COL.emerald} : ${COL.rose})
hline(0, "Zero", color=${COL.slate})`,
    ),
  }),
  def({
    id: 'bull-bear',
    title: 'AXIS Bull Bear',
    shorttitle: 'BBP',
    description: 'Elder bull / bear power',
    category: 'oscillator',
    overlay: false,
    covers: 'Bull Bear Power',
    tags: ['elder', 'power'],
    code: pineIndicator(
      'AXIS Bull Bear',
      'BBP',
      false,
      `len = input.int(13, "EMA", minval=1)
e = ta.ema(close, len)
bull = high - e
bear = low - e
plot(bull, "Bull", color=${COL.emerald}, style=plot.style_histogram)
plot(bear, "Bear", color=${COL.rose}, style=plot.style_histogram)
hline(0, "Zero", color=${COL.slate})`,
    ),
  }),
  def({
    id: 'connors-rsi',
    title: 'AXIS Connors RSI',
    shorttitle: 'CRSI',
    description: 'Mean of RSI, streak RSI, and ROC percentile',
    category: 'oscillator',
    overlay: false,
    covers: 'Connors RSI',
    tags: ['rsi', 'connors'],
    code: pineIndicator(
      'AXIS Connors RSI',
      'CRSI',
      false,
      `rsiLen = input.int(3, "RSI", minval=1)
streakLen = input.int(2, "Streak RSI", minval=1)
prankLen = input.int(100, "Percentile", minval=2)
r = ta.rsi(close, rsiLen)
var float streak = 0.0
streak := close > close[1] ? nz(streak[1]) > 0 ? nz(streak[1]) + 1.0 : 1.0 : close < close[1] ? nz(streak[1]) < 0 ? nz(streak[1]) - 1.0 : -1.0 : 0.0
sr = ta.rsi(streak, streakLen)
chg = ta.change(close)
int beats = 0
for i = 1 to prankLen
    if not na(chg[i]) and chg >= chg[i]
        beats += 1
prank = 100.0 * beats / prankLen
crsi = (r + sr + prank) / 3.0
plot(crsi, "CRSI", color=${COL.indigo}, linewidth=2)
hline(70, "OB", color=${COL.rose}, linestyle=hline.style_dashed)
hline(30, "OS", color=${COL.emerald}, linestyle=hline.style_dashed)`,
    ),
  }),
  def({
    id: 'smi',
    title: 'AXIS SMI',
    shorttitle: 'SMI',
    description: 'Stochastic Momentum Index',
    category: 'oscillator',
    overlay: false,
    covers: 'Stochastic Momentum Index',
    tags: ['smi', 'stoch'],
    code: pineIndicator(
      'AXIS SMI',
      'SMI',
      false,
      `len = input.int(10, "Length", minval=1)
smooth = input.int(3, "Smooth", minval=1)
sigLen = input.int(3, "Signal", minval=1)
ll = ta.lowest(low, len)
hh = ta.highest(high, len)
diff = close - (hh + ll) / 2.0
rge = hh - ll
avgRel = ta.ema(ta.ema(diff, smooth), smooth)
avgRge = ta.ema(ta.ema(rge, smooth), smooth)
smi = avgRge == 0 ? na : 200.0 * avgRel / avgRge
sig = ta.ema(smi, sigLen)
plot(smi, "SMI", color=${COL.indigo})
plot(sig, "Signal", color=${COL.amber})
hline(40, "OB", color=${COL.rose}, linestyle=hline.style_dashed)
hline(-40, "OS", color=${COL.emerald}, linestyle=hline.style_dashed)
hline(0, "Zero", color=${COL.slate})`,
    ),
  }),
  def({
    id: 'woodies-cci',
    title: 'AXIS Woodie CCI',
    shorttitle: 'WCCI',
    description: 'CCI plus a faster CCI',
    category: 'oscillator',
    overlay: false,
    covers: 'Woodie CCI',
    tags: ['cci', 'woodie'],
    code: pineIndicator(
      'AXIS Woodie CCI',
      'WCCI',
      false,
      `len = input.int(14, "CCI", minval=1)
turbo = input.int(6, "Turbo", minval=1)
src = hlc3
c = ta.cci(src, len)
t = ta.cci(src, turbo)
plot(c, "CCI", color=${COL.indigo})
plot(t, "Turbo", color=${COL.amber})
hline(100, "+100", color=${COL.rose}, linestyle=hline.style_dashed)
hline(-100, "-100", color=${COL.emerald}, linestyle=hline.style_dashed)
hline(0, "Zero", color=${COL.slate})`,
    ),
  }),
  def({
    id: 'rci',
    title: 'AXIS RCI',
    shorttitle: 'RCI',
    description: 'Rank correlation index',
    category: 'oscillator',
    overlay: false,
    covers: 'Rank Correlation Index',
    tags: ['rci'],
    code: pineIndicator(
      'AXIS RCI',
      'RCI',
      false,
      `len = input.int(9, "Length", minval=2)
src = input.source(close, "Source")
r = ta.rci(src, len)
plot(r, "RCI", color=${COL.cyan}, linewidth=2)
hline(80, "OB", color=${COL.rose}, linestyle=hline.style_dashed)
hline(-80, "OS", color=${COL.emerald}, linestyle=hline.style_dashed)
hline(0, "Zero", color=${COL.slate})`,
    ),
  }),
  def({
    id: 'ulcer',
    title: 'AXIS Ulcer',
    shorttitle: 'UI',
    description: 'Ulcer Index (drawdown RMS)',
    category: 'oscillator',
    overlay: false,
    covers: 'Ulcer Index',
    tags: ['ulcer', 'risk'],
    code: pineIndicator(
      'AXIS Ulcer',
      'UI',
      false,
      `len = input.int(14, "Length", minval=1)
src = input.source(close, "Source")
peak = ta.highest(src, len)
dd = peak == 0 ? 0.0 : 100.0 * (src - peak) / peak
ui = math.sqrt(ta.sma(dd * dd, len))
plot(ui, "Ulcer", color=${COL.rose}, linewidth=2)`,
    ),
  }),
  def({
    id: 'mass-index',
    title: 'AXIS Mass Index',
    shorttitle: 'Mass',
    description: 'Sum of EMA(high−low) / double EMA',
    category: 'oscillator',
    overlay: false,
    covers: 'Mass Index',
    tags: ['mass', 'volatility'],
    code: pineIndicator(
      'AXIS Mass Index',
      'Mass',
      false,
      `emaLen = input.int(9, "EMA", minval=1)
sumLen = input.int(25, "Sum", minval=1)
hl = high - low
e1 = ta.ema(hl, emaLen)
e2 = ta.ema(e1, emaLen)
ratio = e2 == 0 ? na : e1 / e2
mass = ta.sum(ratio, sumLen)
plot(mass, "Mass", color=${COL.indigo}, linewidth=2)
hline(27, "Bulge", color=${COL.amber}, linestyle=hline.style_dashed)`,
    ),
  }),
  def({
    id: 'choppiness',
    title: 'AXIS Choppiness',
    shorttitle: 'CHOP',
    description: 'Choppiness Index',
    category: 'oscillator',
    overlay: false,
    covers: 'Choppiness Index',
    tags: ['chop', 'trend'],
    code: pineIndicator(
      'AXIS Choppiness',
      'CHOP',
      false,
      `len = input.int(14, "Length", minval=2)
atrSum = ta.sum(ta.tr(true), len)
span = ta.highest(high, len) - ta.lowest(low, len)
chop = span == 0 ? na : 100.0 * math.log(atrSum / span) / math.log(len)
plot(chop, "CHOP", color=${COL.cyan}, linewidth=2)
hline(61.8, "Chop", color=${COL.amber}, linestyle=hline.style_dashed)
hline(38.2, "Trend", color=${COL.emerald}, linestyle=hline.style_dashed)`,
    ),
  }),
  def({
    id: 'trend-strength',
    title: 'AXIS Trend Strength',
    shorttitle: 'TSI2',
    description: 'ADX-style trend strength (ta.adx)',
    category: 'oscillator',
    overlay: false,
    covers: 'Trend Strength Index (ADX)',
    tags: ['adx', 'trend'],
    code: pineIndicator(
      'AXIS Trend Strength',
      'TSI2',
      false,
      `len = input.int(14, "Length", minval=1)
a = ta.adx(len)
plot(a, "ADX", color=${COL.indigo}, linewidth=2)
hline(25, "Trend on", color=${COL.amber}, linestyle=hline.style_dashed)`,
    ),
  }),
];
