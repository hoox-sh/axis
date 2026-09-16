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
 * Pine scaffolding for AXIS first-party built-ins.
 *
 * Banner is the license/origin marker tests assert on. Void-theme hex tokens
 * keep plots readable on the default chart without copying any vendor palette.
 *
 * @module indicators/builtins/pine
 */

import type { BuiltinCategory, BuiltinKind, BuiltinScript } from './types';

/** First line of every shipped built-in — original AXIS source. */
export const AXIS_PINE_BANNER =
  '//@version=6\n// AXIS first-party built-in. Original source — not a TradingView® template.\n';

/** Void-theme plot colors used by built-ins. */
export const COL = {
  indigo: '#6366f1',
  cyan: '#22d3ee',
  rose: '#fb7185',
  emerald: '#34d399',
  amber: '#fbbf24',
  slate: '#94a3b8',
} as const;

/** Wrap an `indicator()` script with the AXIS banner. */
export function pineIndicator(
  title: string,
  shorttitle: string,
  overlay: boolean,
  body: string,
  extraArgs = '',
): string {
  const extra = extraArgs ? `, ${extraArgs}` : '';
  return `${AXIS_PINE_BANNER}indicator("${title}", shorttitle="${shorttitle}", overlay=${overlay}${extra})\n${body.trim()}\n`;
}

/** Wrap a `strategy()` script with the AXIS banner + percent-of-equity sizing. */
export function pineStrategy(title: string, overlay: boolean, body: string): string {
  return `${AXIS_PINE_BANNER}strategy("${title}", overlay=${overlay}, initial_capital=100000,
     default_qty_type=strategy.percent_of_equity, default_qty_value=10)
${body.trim()}
`;
}

/** Build a catalog row. */
export function def(spec: {
  id: string;
  title: string;
  shorttitle: string;
  description: string;
  category: BuiltinCategory;
  covers: string;
  overlay?: boolean;
  kind?: BuiltinKind;
  tags?: readonly string[];
  code: string;
}): BuiltinScript {
  const kind = spec.kind ?? 'indicator';
  const overlay = spec.overlay ?? kind !== 'strategy';
  return {
    id: spec.id,
    title: spec.title,
    shorttitle: spec.shorttitle,
    description: spec.description,
    category: spec.category,
    kind,
    overlay,
    covers: spec.covers,
    tags: spec.tags ?? [spec.category, kind],
    code: spec.code,
  };
}
