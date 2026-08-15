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
 * Curated Unicode / ASCII catalog for the Pine editor (TV-editor style).
 *
 * `monoSafe` ≈ one cell in IBM Plex Mono / typical TV editor fonts (box
 * drawing, geometric, arrows). Emoji are usually two cells — still valid in
 * `plotchar` / `label.new` / table cells (`use: 'chart'`).
 *
 * Sources: TradingView “Exploring Unicode”, plotchar/plotshape docs
 * (▲ ▼ 🠅 🠇 •), box-drawing U+2500, community UNICODE CHEAT SHEET.
 *
 * @module editor/pine-symbols
 */

export type PineSymbolCategory =
  | 'insert'
  | 'arrows'
  | 'box'
  | 'blocks'
  | 'shapes'
  | 'checks'
  | 'stars'
  | 'finance'
  | 'math'
  | 'spaces'
  | 'emoji';

export type PineSymbolUse = 'editor' | 'chart' | 'both';

export type PineSymbol = {
  id: string;
  /** Glyph to insert. */
  char: string;
  name: string;
  hex?: string;
  category: PineSymbolCategory;
  /** True when the glyph is ~1em in a monospace editor. */
  monoSafe: boolean;
  use: PineSymbolUse;
  notes?: string;
};

export const PINE_SYMBOL_CATEGORIES: Array<{
  id: PineSymbolCategory;
  label: string;
  hint: string;
}> = [
  { id: 'insert', label: 'Text', hint: 'Bullets and punctuation' },
  { id: 'arrows', label: 'Arrows', hint: 'plotchar / labels' },
  { id: 'box', label: 'Box', hint: 'Monospace frames' },
  { id: 'blocks', label: 'Blocks', hint: 'Shade / bars' },
  { id: 'shapes', label: 'Shapes', hint: 'Markers' },
  { id: 'checks', label: 'Marks', hint: 'Pass / fail' },
  { id: 'stars', label: 'Stars', hint: 'Ratings' },
  { id: 'finance', label: 'Finance', hint: 'Price / trend' },
  { id: 'math', label: 'Math', hint: 'Compare' },
  { id: 'spaces', label: 'Spaces', hint: 'TV label padding' },
  { id: 'emoji', label: 'Emoji', hint: 'Chart text (wide)' },
];

function s(
  id: string,
  char: string,
  name: string,
  category: PineSymbolCategory,
  opts?: Partial<Pick<PineSymbol, 'hex' | 'monoSafe' | 'use' | 'notes'>>,
): PineSymbol {
  const cp = [...char][0]?.codePointAt(0);
  return {
    id,
    char,
    name,
    hex: opts?.hex ?? (cp != null ? `U+${cp.toString(16).toUpperCase()}` : undefined),
    category,
    monoSafe: opts?.monoSafe ?? true,
    use: opts?.use ?? 'both',
    notes: opts?.notes,
  };
}

/** High-signal set used in Pine scripts + the TV editor. */
export const PINE_SYMBOLS: readonly PineSymbol[] = [
  s('bullet', '•', 'Bullet', 'insert', { hex: 'U+2022' }),
  s('middot', '·', 'Middle dot', 'insert', { hex: 'U+00B7' }),
  s('ellipsis', '…', 'Ellipsis', 'insert', { hex: 'U+2026' }),

  s('arr-u', '↑', 'Arrow up', 'arrows', { hex: 'U+2191' }),
  s('arr-d', '↓', 'Arrow down', 'arrows', { hex: 'U+2193' }),
  s('arr-l', '←', 'Arrow left', 'arrows', { hex: 'U+2190' }),
  s('arr-r', '→', 'Arrow right', 'arrows', { hex: 'U+2192' }),
  s('arr-ud', '↕', 'Arrow up-down', 'arrows', { hex: 'U+2195' }),
  s('arr-lr', '↔', 'Arrow left-right', 'arrows', { hex: 'U+2194' }),
  s('tri-u', '▲', 'Triangle up', 'arrows', {
    hex: 'U+25B2',
    notes: 'TV plotchar long example',
  }),
  s('tri-d', '▼', 'Triangle down', 'arrows', { hex: 'U+25BC' }),
  s('ptr-u', '🠅', 'Heavy arrow up', 'arrows', {
    hex: 'U+1F805',
    monoSafe: false,
    use: 'chart',
    notes: 'TV text-and-shapes plotchar (SMP, wide in editor)',
  }),
  s('ptr-d', '🠇', 'Heavy arrow down', 'arrows', {
    hex: 'U+1F807',
    monoSafe: false,
    use: 'chart',
    notes: 'TV text-and-shapes plotshape (SMP, wide in editor)',
  }),
  s('ptr-r', '►', 'Pointer right', 'arrows', { hex: 'U+25BA' }),
  s('ptr-l', '◄', 'Pointer left', 'arrows', { hex: 'U+25C4' }),
  s('arr-fat-u', '⬆', 'Black arrow up', 'arrows', { hex: 'U+2B06' }),
  s('arr-fat-d', '⬇', 'Black arrow down', 'arrows', { hex: 'U+2B07' }),
  s('arr-dbl-u', '⇑', 'Double arrow up', 'arrows', { hex: 'U+21D1' }),
  s('arr-dbl-d', '⇓', 'Double arrow down', 'arrows', { hex: 'U+21D3' }),

  s('box-h', '─', 'Box light horizontal', 'box', { hex: 'U+2500' }),
  s('box-v', '│', 'Box light vertical', 'box', { hex: 'U+2502' }),
  s('box-tl', '┌', 'Box down-right', 'box', { hex: 'U+250C' }),
  s('box-tr', '┐', 'Box down-left', 'box', { hex: 'U+2510' }),
  s('box-bl', '└', 'Box up-right', 'box', { hex: 'U+2514' }),
  s('box-br', '┘', 'Box up-left', 'box', { hex: 'U+2518' }),
  s('box-vr', '├', 'Box vertical-right', 'box', { hex: 'U+251C' }),
  s('box-vl', '┤', 'Box vertical-left', 'box', { hex: 'U+2524' }),
  s('box-hd', '┬', 'Box horizontal-down', 'box', { hex: 'U+252C' }),
  s('box-hu', '┴', 'Box horizontal-up', 'box', { hex: 'U+2534' }),
  s('box-x', '┼', 'Box cross', 'box', { hex: 'U+253C' }),
  s('box-hh', '═', 'Box double horizontal', 'box', { hex: 'U+2550' }),
  s('box-vv', '║', 'Box double vertical', 'box', { hex: 'U+2551' }),
  s('box-dtl', '╔', 'Box double down-right', 'box', { hex: 'U+2554' }),
  s('box-dtr', '╗', 'Box double down-left', 'box', { hex: 'U+2557' }),
  s('box-dbl', '╚', 'Box double up-right', 'box', { hex: 'U+255A' }),
  s('box-dbr', '╝', 'Box double up-left', 'box', { hex: 'U+255D' }),
  s('box-dash-h', '╌', 'Box dashed horizontal', 'box', { hex: 'U+254C' }),
  s('box-dash-v', '╎', 'Box dashed vertical', 'box', { hex: 'U+254E' }),

  s('blk-full', '█', 'Full block', 'blocks', { hex: 'U+2588' }),
  s('blk-up', '▀', 'Upper half', 'blocks', { hex: 'U+2580' }),
  s('blk-dn', '▄', 'Lower half', 'blocks', { hex: 'U+2584' }),
  s('blk-l', '▌', 'Left half', 'blocks', { hex: 'U+258C' }),
  s('blk-r', '▐', 'Right half', 'blocks', { hex: 'U+2590' }),
  s('blk-light', '░', 'Light shade', 'blocks', { hex: 'U+2591' }),
  s('blk-med', '▒', 'Medium shade', 'blocks', { hex: 'U+2592' }),
  s('blk-dark', '▓', 'Dark shade', 'blocks', { hex: 'U+2593' }),
  s('blk-bar', '▮', 'Vertical bar', 'blocks', { hex: 'U+25AE' }),

  s('shp-circ', '●', 'Black circle', 'shapes', { hex: 'U+25CF' }),
  s('shp-circ-o', '○', 'White circle', 'shapes', { hex: 'U+25CB' }),
  s('shp-circ-d', '◉', 'Fisheye', 'shapes', { hex: 'U+25C9' }),
  s('shp-sq', '■', 'Black square', 'shapes', { hex: 'U+25A0' }),
  s('shp-sq-o', '□', 'White square', 'shapes', { hex: 'U+25A1' }),
  s('shp-dia', '◆', 'Black diamond', 'shapes', { hex: 'U+25C6' }),
  s('shp-dia-o', '◇', 'White diamond', 'shapes', { hex: 'U+25C7' }),
  s('shp-loz', '◊', 'Lozenge', 'shapes', { hex: 'U+25CA' }),
  s('shp-dot', '▪', 'Small square', 'shapes', { hex: 'U+25AA' }),
  s('shp-tri-r', '▶', 'Black triangle right', 'shapes', { hex: 'U+25B6' }),
  s('shp-tri-l', '◀', 'Black triangle left', 'shapes', { hex: 'U+25C0' }),

  s('chk-ok', '✓', 'Check', 'checks', { hex: 'U+2713' }),
  s('chk-heavy', '✔', 'Heavy check', 'checks', { hex: 'U+2714' }),
  s('chk-x', '✕', 'Multiply x', 'checks', { hex: 'U+2715' }),
  s('chk-heavy-x', '✖', 'Heavy x', 'checks', { hex: 'U+2716' }),
  s('chk-ballot', '☑', 'Ballot checked', 'checks', { hex: 'U+2611' }),
  s('chk-empty', '☐', 'Ballot empty', 'checks', { hex: 'U+2610' }),
  s('chk-plus', '✚', 'Heavy plus', 'checks', { hex: 'U+271A' }),

  s('st-black', '★', 'Black star', 'stars', { hex: 'U+2605' }),
  s('st-white', '☆', 'White star', 'stars', { hex: 'U+2606' }),
  s('st-spark', '✦', 'Four-point star', 'stars', { hex: 'U+2726' }),
  s('st-ast', '✱', 'Heavy asterisk', 'stars', { hex: 'U+2731' }),
  s('st-snow', '❄', 'Snowflake', 'stars', {
    hex: 'U+2744',
    notes: 'Official plotchar example',
  }),
  s('st-sun', '☀', 'Sun', 'stars', { hex: 'U+2600', notes: 'Official plotchar example' }),
  s('st-flag', '⚑', 'Black flag', 'stars', {
    hex: 'U+2691',
    notes: 'Official plotchar example',
  }),
  s('st-heart', '❤', 'Heart', 'stars', {
    hex: 'U+2764',
    notes: 'Official plotchar example',
  }),

  s('fin-usd', '$', 'Dollar', 'finance', { hex: 'U+0024' }),
  s('fin-eur', '€', 'Euro', 'finance', { hex: 'U+20AC' }),
  s('fin-gbp', '£', 'Pound', 'finance', { hex: 'U+00A3' }),
  s('fin-yen', '¥', 'Yen', 'finance', { hex: 'U+00A5' }),
  s('fin-btc', '₿', 'Bitcoin', 'finance', { hex: 'U+20BF' }),
  s('fin-cent', '¢', 'Cent', 'finance', { hex: 'U+00A2' }),
  s('fin-pct', '%', 'Percent', 'finance', { hex: 'U+0025' }),

  s('m-times', '×', 'Times', 'math', { hex: 'U+00D7' }),
  s('m-div', '÷', 'Divide', 'math', { hex: 'U+00F7' }),
  s('m-pm', '±', 'Plus-minus', 'math', { hex: 'U+00B1' }),
  s('m-ne', '≠', 'Not equal', 'math', { hex: 'U+2260' }),
  s('m-le', '≤', 'Less or equal', 'math', { hex: 'U+2264' }),
  s('m-ge', '≥', 'Greater or equal', 'math', { hex: 'U+2265' }),
  s('m-approx', '≈', 'Approximately', 'math', { hex: 'U+2248' }),
  s('m-inf', '∞', 'Infinity', 'math', { hex: 'U+221E' }),
  s('m-sqrt', '√', 'Square root', 'math', { hex: 'U+221A' }),
  s('m-deg', '°', 'Degree', 'math', { hex: 'U+00B0' }),

  s('sp-nbsp', '\u00A0', 'No-break space', 'spaces', {
    hex: 'U+00A0',
    notes: 'Holds a gap in labels without wrapping',
  }),
  s('sp-en', '\u2002', 'En space', 'spaces', { hex: 'U+2002', use: 'chart' }),
  s('sp-em', '\u2003', 'Em space', 'spaces', {
    hex: 'U+2003',
    use: 'chart',
    notes: 'Common TV settings-menu pad',
  }),
  s('sp-thin', '\u2009', 'Thin space', 'spaces', { hex: 'U+2009', use: 'chart' }),
  s('sp-fig', '\u2007', 'Figure space', 'spaces', {
    hex: 'U+2007',
    notes: 'Digit-wide; good for column align',
  }),
  s('sp-ideog', '\u3000', 'Ideographic space', 'spaces', {
    hex: 'U+3000',
    use: 'chart',
    notes: 'Wide pad in proportional TV labels',
  }),

  s('em-fire', '🔥', 'Fire', 'emoji', { hex: 'U+1F525', monoSafe: false, use: 'chart' }),
  s('em-rocket', '🚀', 'Rocket', 'emoji', { hex: 'U+1F680', monoSafe: false, use: 'chart' }),
  s('em-up', '📈', 'Chart up', 'emoji', { hex: 'U+1F4C8', monoSafe: false, use: 'chart' }),
  s('em-dn', '📉', 'Chart down', 'emoji', { hex: 'U+1F4C9', monoSafe: false, use: 'chart' }),
  s('em-ok', '✅', 'Check box', 'emoji', { hex: 'U+2705', monoSafe: false, use: 'chart' }),
  s('em-no', '❌', 'Cross mark', 'emoji', { hex: 'U+274C', monoSafe: false, use: 'chart' }),
  s('em-warn', '⚠️', 'Warning', 'emoji', { hex: 'U+26A0', monoSafe: false, use: 'chart' }),
  s('em-gem', '💎', 'Gem', 'emoji', { hex: 'U+1F48E', monoSafe: false, use: 'chart' }),
  s('em-tgt', '🎯', 'Target', 'emoji', { hex: 'U+1F3AF', monoSafe: false, use: 'chart' }),
  s('em-green', '🟢', 'Green circle', 'emoji', { hex: 'U+1F7E2', monoSafe: false, use: 'chart' }),
  s('em-red', '🔴', 'Red circle', 'emoji', { hex: 'U+1F534', monoSafe: false, use: 'chart' }),
  s('em-yel', '🟡', 'Yellow circle', 'emoji', { hex: 'U+1F7E1', monoSafe: false, use: 'chart' }),
  s('em-white', '⚪', 'White circle', 'emoji', { hex: 'U+26AA', monoSafe: false, use: 'chart' }),
  s('em-black', '⚫', 'Black circle', 'emoji', { hex: 'U+26AB', monoSafe: false, use: 'chart' }),
  s('em-bell', '🔔', 'Bell', 'emoji', { hex: 'U+1F514', monoSafe: false, use: 'chart' }),
  s('em-pin', '📌', 'Pin', 'emoji', { hex: 'U+1F4CC', monoSafe: false, use: 'chart' }),
];

export function quotePineString(inner: string): string {
  const escaped = inner.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

export function plotcharSnippet(char: string): string {
  return `plotchar(cond, "mark", ${quotePineString(char)}, location.belowbar)`;
}

export function filterPineSymbols(
  query: string,
  opts?: { category?: PineSymbolCategory | 'all'; monoOnly?: boolean },
): PineSymbol[] {
  const q = query.trim().toLowerCase();
  const cat = opts?.category && opts.category !== 'all' ? opts.category : null;
  return PINE_SYMBOLS.filter((sym) => {
    if (cat && sym.category !== cat) return false;
    if (opts?.monoOnly && !sym.monoSafe) return false;
    if (!q) return true;
    return (
      sym.name.toLowerCase().includes(q) ||
      sym.id.toLowerCase().includes(q) ||
      (sym.hex && sym.hex.toLowerCase().includes(q)) ||
      (sym.notes && sym.notes.toLowerCase().includes(q)) ||
      sym.char.includes(query.trim())
    );
  });
}
