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
 * Charting-host studies AXIS does **not** ship as built-ins.
 *
 * Inventory of “needed” scripts lives in the original catalog. This list is
 * the complement: names that show up on closed hosts but that we skip because
 * they need proprietary scoring, extra market data, tick aggressor feeds, or
 * are drawing/layout chrome AXIS already covers elsewhere.
 *
 * Do not add scraped third-party Pine here.
 *
 * @module indicators/builtins/skipped
 */

import type { SkippedStudy } from './types';

/** Studies we will not clone (copyright, data, or product-boundary). */
export const SKIPPED_STUDIES: readonly SkippedStudy[] = [
  {
    name: 'Technical Ratings',
    reason: 'Proprietary composite scoring, not a public formula',
  },
  {
    name: 'Technical Ratings Strategy',
    reason: 'Depends on proprietary ratings',
  },
  {
    name: 'Dividend Yield',
    reason: 'Needs a dividend / fundamentals feed AXIS does not host',
  },
  {
    name: 'Open Interest',
    reason: 'Needs an OI feed beyond OHLCV',
  },
  {
    name: 'Compare',
    reason: 'Multi-symbol overlay is chart chrome (AXIS Compare control)',
  },
  {
    name: 'Moon Phases',
    reason: 'Calendar overlay, not a TA study on OHLCV',
  },
  {
    name: 'Seasonality',
    reason: 'Needs multi-year calendar aggregation the host does not ship',
  },
  {
    name: 'Price Target',
    reason: 'Analyst / consensus data, not computed from bars',
  },
  {
    name: 'Multi Time Period Charts',
    reason: 'Layout host feature (AXIS multi-chart), not a script',
  },
  {
    name: 'Visible Average Price',
    reason: 'Viewport-dependent; not a bar-series study',
  },
  {
    name: 'Advance / Decline Line',
    reason: 'Market-breadth series, not single-symbol OHLCV',
  },
  {
    name: 'Advance / Decline Ratio',
    reason: 'Market-breadth series, not single-symbol OHLCV',
  },
  {
    name: 'Advance / Decline Ratio (Bars)',
    reason: 'Market-breadth series, not single-symbol OHLCV',
  },
  {
    name: '24-hour Volume',
    reason: 'Exchange session clock / rolling window the host does not define',
  },
  {
    name: 'Volume Delta',
    reason: 'Needs tick / aggressor classification',
  },
  {
    name: 'Cumulative Volume Delta',
    reason: 'Needs tick / aggressor classification',
  },
  {
    name: 'Up/Down Volume',
    reason: 'Needs tick / aggressor classification',
  },
  {
    name: 'Auto Fib Retracement',
    reason: 'Drawing tool — AXIS already has Fib drawings',
  },
  {
    name: 'Auto Fib Extension',
    reason: 'Drawing tool — AXIS already has Fib drawings',
  },
  {
    name: 'Auto Pitchfork',
    reason: 'Drawing tool, not a plot study',
  },
  {
    name: 'Gaps',
    reason: 'Chart annotation; skip as a built-in plot',
  },
  {
    name: 'Performance',
    reason: 'Index / relative-performance needs a second symbol series',
  },
  {
    name: 'Conditional Expressions',
    reason: 'Language tutorial, not an indicator',
  },
  {
    name: 'Chop Zone',
    reason: 'Vendor-specific color mapping; not a public formula we will copy',
  },
];
