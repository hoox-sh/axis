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
 * AXIS first-party built-in script catalog.
 *
 * Concatenates original studies by category. Lookup / search stay pure so the
 * Scripts picker and command palette can share them without Solid.
 *
 * @module indicators/builtins/catalog
 */

import { CHANNEL_BUILTINS } from './channels';
import { MA_BUILTINS } from './ma';
import { OSCILLATOR_BUILTINS } from './oscillators';
import { PIVOT_BUILTINS } from './pivots';
import { STRATEGY_BUILTINS } from './strategies';
import { TREND_BUILTINS } from './trend';
import { VOLATILITY_BUILTINS } from './volatility';
import { VOLUME_BUILTINS } from './volume';
import type { BuiltinCategory, BuiltinScript } from './types';

/** All shipped original built-ins (indicators + strategies). */
export const BUILTIN_SCRIPTS: readonly BuiltinScript[] = [
  ...MA_BUILTINS,
  ...CHANNEL_BUILTINS,
  ...OSCILLATOR_BUILTINS,
  ...TREND_BUILTINS,
  ...VOLUME_BUILTINS,
  ...VOLATILITY_BUILTINS,
  ...PIVOT_BUILTINS,
  ...STRATEGY_BUILTINS,
];

const BY_ID = new Map<string, BuiltinScript>();
for (const s of BUILTIN_SCRIPTS) {
  BY_ID.set(s.id, s);
}

/** Look up a built-in by id. */
export function getBuiltinScript(id: string): BuiltinScript | undefined {
  return BY_ID.get(String(id || ''));
}

/** Distinct categories in catalog order. */
export function listBuiltinCategories(): BuiltinCategory[] {
  const seen = new Set<BuiltinCategory>();
  const out: BuiltinCategory[] = [];
  for (const s of BUILTIN_SCRIPTS) {
    if (seen.has(s.category)) continue;
    seen.add(s.category);
    out.push(s.category);
  }
  return out;
}

export function builtinsInCategory(category: BuiltinCategory): BuiltinScript[] {
  return BUILTIN_SCRIPTS.filter((s) => s.category === category);
}

function haystack(s: BuiltinScript): string {
  return `${s.id} ${s.title} ${s.shorttitle} ${s.description} ${s.covers} ${s.tags.join(' ')} ${s.category}`.toLowerCase();
}

/**
 * Filter built-ins by a free-text query (substring, case-insensitive).
 * Empty query returns the full catalog.
 */
export function filterBuiltinScripts(query: string): BuiltinScript[] {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (!q) return [...BUILTIN_SCRIPTS];
  const parts = q.split(/\s+/).filter(Boolean);
  return BUILTIN_SCRIPTS.filter((s) => {
    const h = haystack(s);
    return parts.every((p) => h.includes(p));
  });
}

/** Human label for a category chip. */
export function builtinCategoryLabel(category: BuiltinCategory): string {
  switch (category) {
    case 'moving-average':
      return 'Moving averages';
    case 'channel':
      return 'Channels';
    case 'oscillator':
      return 'Oscillators';
    case 'trend':
      return 'Trend';
    case 'volume':
      return 'Volume';
    case 'volatility':
      return 'Volatility';
    case 'pivot':
      return 'Pivots';
    case 'session':
      return 'Session';
    case 'strategy':
      return 'Strategies';
    default:
      return category;
  }
}
