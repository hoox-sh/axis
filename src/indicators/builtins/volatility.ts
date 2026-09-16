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
 * Original AXIS volatility built-ins.
 *
 * @module indicators/builtins/volatility
 */

import { COL, def, pineIndicator } from './pine';
import type { BuiltinScript } from './types';

export const VOLATILITY_BUILTINS: readonly BuiltinScript[] = [
  def({
    id: 'atr',
    title: 'AXIS ATR',
    shorttitle: 'ATR',
    description: 'Average True Range and ATR%',
    category: 'volatility',
    overlay: false,
    covers: 'Average True Range',
    tags: ['atr', 'volatility'],
    code: pineIndicator(
      'AXIS ATR',
      'ATR',
      false,
      `len = input.int(14, "Length", minval=1)
a = ta.atr(len)
atrPct = close == 0 ? na : a / close * 100.0
plot(a, "ATR", color=${COL.indigo}, linewidth=2)
plot(atrPct, "ATR%", color=${COL.cyan})`,
    ),
  }),
  def({
    id: 'true-range',
    title: 'AXIS True Range',
    shorttitle: 'TR',
    description: 'Per-bar true range',
    category: 'volatility',
    overlay: false,
    covers: 'True Range',
    tags: ['tr', 'volatility'],
    code: pineIndicator(
      'AXIS True Range',
      'TR',
      false,
      `tr = ta.tr(true)
plot(tr, "TR", color=${COL.amber}, style=plot.style_columns)`,
    ),
  }),
  def({
    id: 'hist-vol',
    title: 'AXIS Hist Vol',
    shorttitle: 'HV',
    description: 'Annualized log-return standard deviation',
    category: 'volatility',
    overlay: false,
    covers: 'Historical Volatility',
    tags: ['hv', 'volatility'],
    code: pineIndicator(
      'AXIS Hist Vol',
      'HV',
      false,
      `len = input.int(20, "Length", minval=2)
ann = input.float(365.0, "Periods / year", minval=1)
src = input.source(close, "Source")
ret = math.log(src / src[1])
hv = ta.stdev(ret, len) * math.sqrt(ann) * 100.0
plot(hv, "HV %", color=${COL.rose}, linewidth=2)`,
    ),
  }),
  def({
    id: 'adr',
    title: 'AXIS Avg Range',
    shorttitle: 'ADR',
    description: 'SMA of high − low (average range)',
    category: 'volatility',
    overlay: false,
    covers: 'Average Daily Range (same-TF range SMA)',
    tags: ['adr', 'range'],
    code: pineIndicator(
      'AXIS Avg Range',
      'ADR',
      false,
      `len = input.int(14, "Length", minval=1)
rng = high - low
avg = ta.sma(rng, len)
plot(rng, "Range", color=${COL.slate}, style=plot.style_columns)
plot(avg, "Avg range", color=${COL.indigo}, linewidth=2)`,
    ),
  }),
];
