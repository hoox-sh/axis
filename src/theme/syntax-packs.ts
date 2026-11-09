// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Editor syntax CSS-var packs per chart preset.
 * Brand packs mirror VS Code tokenColors in pynescript themes.
 *
 * @module theme/syntax-packs
 */

import type { ThemeTokens } from './types';

/** CSS custom properties consumed by `src/editor/cm-void.ts`. */
export type SyntaxPack = Record<string, string>;

const VOID_PACK: SyntaxPack = {
  '--color-accent': '#939FFF',
  '--color-accent-2': '#BCC3F7',
  '--color-orange': '#CACEF5',
  '--color-editor-builtin': '#9D9EA3',
  '--color-editor-lib': '#989FD6',
  '--color-editor-lib-member': '#BCC3F7',
  '--color-editor-type': '#CACEF5',
};

const VOLT_PACK: SyntaxPack = {
  '--color-accent': '#B7EF09',
  '--color-accent-2': '#D0EF70',
  '--color-orange': '#D8EE92',
  '--color-editor-builtin': '#9E9F98',
  '--color-editor-lib': '#ACCB49',
  '--color-editor-lib-member': '#D0EF70',
  '--color-editor-type': '#D8EE92',
};

const SIGNAL_PACK: SyntaxPack = {
  '--color-accent': '#FE6A00',
  '--color-accent-2': '#F7A56B',
  '--color-orange': '#F4B98F',
  '--color-editor-builtin': '#868686',
  '--color-editor-lib': '#C8773C',
  '--color-editor-lib-member': '#F7A56B',
  '--color-editor-type': '#F4B98F',
};

/** Brand + alias → pack. */
const BY_PRESET: Record<string, SyntaxPack> = {
  'void-dark': VOID_PACK,
  axis: VOID_PACK,
  volt: VOLT_PACK,
  pyne: VOLT_PACK,
  signal: SIGNAL_PACK,
  hoox: SIGNAL_PACK,
};

function tok(tokens: ThemeTokens, key: string, fallback: string): string {
  const v = tokens[key];
  return v != null && String(v).trim() ? String(v) : fallback;
}

/**
 * Derive a sensible editor pack from accent / up / down when no brand pack
 * is registered for the preset.
 */
export function deriveSyntaxPack(
  tokens: ThemeTokens,
  base: 'dark' | 'light',
): SyntaxPack {
  const accent = tok(tokens, 'ui.accent', base === 'light' ? '#4A59C4' : '#939FFF');
  const up = tok(tokens, 'ui.up', tok(tokens, 'bar.up.color', '#3DDC97'));
  const down = tok(tokens, 'ui.down', tok(tokens, 'bar.down.color', '#F07178'));
  return {
    '--color-accent': accent,
    '--color-accent-2': up,
    '--color-orange': `color-mix(in srgb, ${accent} 25%, #E8B84A 75%)`,
    '--color-editor-builtin':
      base === 'light'
        ? `color-mix(in srgb, ${up} 30%, #0e8aaa 70%)`
        : `color-mix(in srgb, ${up} 28%, #6ee7f5 72%)`,
    '--color-editor-lib':
      base === 'light'
        ? `color-mix(in srgb, ${accent} 40%, #9b4dca 60%)`
        : `color-mix(in srgb, ${accent} 38%, #d8b4fe 62%)`,
    '--color-editor-lib-member':
      base === 'light'
        ? `color-mix(in srgb, ${accent} 25%, #c026d3 75%)`
        : `color-mix(in srgb, ${accent} 20%, #e879f9 80%)`,
    '--color-editor-type':
      base === 'light'
        ? `color-mix(in srgb, ${accent} 30%, #c47a18 70%)`
        : `color-mix(in srgb, ${accent} 22%, #E8B84A 78%)`,
    // Keep warn/down distinct for invalid tokens
    '--color-red': down,
  };
}

/** Resolve syntax CSS vars for a preset id (brand pack or derived fallback). */
export function syntaxPackForPreset(
  presetId: string | null | undefined,
  tokens: ThemeTokens,
  base: 'dark' | 'light',
): SyntaxPack {
  const id = String(presetId || '').trim();
  if (id && BY_PRESET[id]) return { ...BY_PRESET[id]! };
  return deriveSyntaxPack(tokens, base);
}
