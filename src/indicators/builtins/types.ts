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
 * First-party AXIS built-in script catalog types.
 *
 * These are original Pine sources AXIS ships so operators can apply common
 * studies without importing third-party (including TradingView®) templates.
 *
 * @module indicators/builtins/types
 */

/** Pine declaration kind for a built-in. */
export type BuiltinKind = 'indicator' | 'strategy';

/** Grouping used by the Scripts picker and docs inventory. */
export type BuiltinCategory =
  | 'moving-average'
  | 'channel'
  | 'oscillator'
  | 'trend'
  | 'volume'
  | 'volatility'
  | 'pivot'
  | 'session'
  | 'strategy';

/** One original AXIS built-in script. */
export interface BuiltinScript {
  /** Stable id (`sma`, `rsi`, `strat-macd`, …). */
  id: string;
  /** Chart / Scripts panel title. */
  title: string;
  /** Pine `shorttitle`. */
  shorttitle: string;
  /** One-line picker description. */
  description: string;
  category: BuiltinCategory;
  kind: BuiltinKind;
  /** Matches `indicator(..., overlay=)`. */
  overlay: boolean;
  /**
   * Public TA idea this covers (formula name, not a vendor product title).
   * Used in the inventory so we can map “needed studies” without cloning
   * anyone else’s source.
   */
  covers: string;
  tags: readonly string[];
  /** `//@version=6` Pine body. */
  code: string;
}

/** A common charting-host study we do **not** ship, and why. */
export interface SkippedStudy {
  /** Informal name used on other hosts (documentation only). */
  name: string;
  reason: string;
}
