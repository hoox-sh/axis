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
 * Original AXIS pivot / session built-ins.
 *
 * @module indicators/builtins/pivots
 */

import { COL, def, pineIndicator } from './pine';
import type { BuiltinScript } from './types';

export const PIVOT_BUILTINS: readonly BuiltinScript[] = [
  def({
    id: 'pivot-standard',
    title: 'AXIS Floor Pivots',
    shorttitle: 'Pivots',
    description: 'Classic floor pivots from the prior completed day',
    category: 'pivot',
    covers: 'Pivot Points (standard / floor)',
    tags: ['pivot', 'overlay'],
    code: pineIndicator(
      'AXIS Floor Pivots',
      'Pivots',
      true,
      `newDay = timeframe.change("D")
var float yHigh = na
var float yLow = na
var float yClose = na
var float dHigh = high
var float dLow = low
if newDay
    yHigh := dHigh
    yLow := dLow
    yClose := close[1]
    dHigh := high
    dLow := low
else
    dHigh := math.max(dHigh, high)
    dLow := math.min(dLow, low)
pp = (yHigh + yLow + yClose) / 3.0
r1 = 2.0 * pp - yLow
s1 = 2.0 * pp - yHigh
r2 = pp + (yHigh - yLow)
s2 = pp - (yHigh - yLow)
plot(pp, "PP", color=${COL.indigo}, linewidth=2)
plot(r1, "R1", color=${COL.rose})
plot(r2, "R2", color=color.new(${COL.rose}, 30))
plot(s1, "S1", color=${COL.emerald})
plot(s2, "S2", color=color.new(${COL.emerald}, 30))`,
    ),
  }),
  def({
    id: 'pivot-hl',
    title: 'AXIS Pivot HL',
    shorttitle: 'PHL',
    description: 'Confirmed pivot highs and lows',
    category: 'pivot',
    covers: 'Pivot Points High/Low',
    tags: ['pivot', 'overlay'],
    code: pineIndicator(
      'AXIS Pivot HL',
      'PHL',
      true,
      `left = input.int(5, "Left bars", minval=1)
right = input.int(5, "Right bars", minval=1)
ph = ta.pivothigh(high, left, right)
pl = ta.pivotlow(low, left, right)
plot(ph, "Pivot high", color=${COL.rose}, style=plot.style_circles, linewidth=2, offset=-right)
plot(pl, "Pivot low", color=${COL.emerald}, style=plot.style_circles, linewidth=2, offset=-right)`,
    ),
  }),
  def({
    id: 'correlation',
    title: 'AXIS Correlation',
    shorttitle: 'Corr',
    description: 'Rolling correlation of close vs volume',
    category: 'oscillator',
    overlay: false,
    covers: 'Correlation coefficient (close vs volume)',
    tags: ['correlation'],
    code: pineIndicator(
      'AXIS Correlation',
      'Corr',
      false,
      `len = input.int(20, "Length", minval=2)
c = ta.correlation(close, volume, len)
plot(c, "Corr", color=${COL.indigo}, linewidth=2)
hline(0, "Zero", color=${COL.slate})
hline(1, "+1", color=${COL.emerald}, linestyle=hline.style_dotted)
hline(-1, "-1", color=${COL.rose}, linestyle=hline.style_dotted)`,
    ),
  }),
  def({
    id: 'sessions',
    title: 'AXIS Sessions',
    shorttitle: 'Sess',
    description: 'Background highlight for a session window',
    category: 'session',
    overlay: true,
    covers: 'Trading session highlight',
    tags: ['session', 'overlay'],
    code: pineIndicator(
      'AXIS Sessions',
      'Sess',
      true,
      `sess = input.session("0930-1600", "Session")
tz = input.string("America/New_York", "Timezone")
// PYNE time() ignores session args — compare clock in tz instead.
hhmm = hour(time, tz) * 100 + minute(time, tz)
start = str.tonumber(str.substring(sess, 0, 4))
stop = str.tonumber(str.substring(sess, 5, 9))
wrap = not na(start) and not na(stop) and stop <= start
inSess = na(start) or na(stop) ? false : wrap ? hhmm >= start or hhmm < stop : hhmm >= start and hhmm < stop
bgcolor(inSess ? color.new(${COL.indigo}, 92) : na, title="Session")`,
    ),
  }),
];
