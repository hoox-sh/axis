// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Symbols panel catalog and local messages.
 * Not part of axis.webview.v1. listSymbols / filterSymbols never throw.
 */

export const SYMBOL_CATEGORIES = ['arrows', 'shapes', 'box', 'checks', 'stars'] as const;

export type SymbolCategory = (typeof SYMBOL_CATEGORIES)[number];

/** Glyph row. Stable `id`. BMP / TV-editor-safe `char`. */
export type AxisSymbol = {
  id: string;
  category: SymbolCategory;
  char: string;
  name: string;
};

export const SYMBOL_CATEGORY_LABELS: Readonly<Record<SymbolCategory, string>> = {
  arrows: 'Arrows',
  shapes: 'Shapes',
  box: 'Box',
  checks: 'Checks',
  stars: 'Stars',
};

/** Host → webview. */
export type SymbolsSetMessage = {
  type: 'symbols.set';
  symbols: AxisSymbol[];
  query: string;
  category: string;
};

/** Webview → host. */
export type SymbolsInsertMessage = { type: 'symbols.insert'; text: string };
export type SymbolsCopyMessage = { type: 'symbols.copy'; text: string };
export type SymbolsWebToHost = SymbolsInsertMessage | SymbolsCopyMessage;

/** Cap for insert/copy text and catalog chars. */
export const MAX_SYMBOL_TEXT = 16;

const SYMBOL_CATEGORY_SET: ReadonlySet<string> = new Set(SYMBOL_CATEGORIES);

function sym(id: string, category: SymbolCategory, char: string, name: string): AxisSymbol {
  return { id, category, char, name };
}

/** Focused TV-safe subset of the AXIS editor symbol catalog (BMP only). */
const CATALOG: readonly AxisSymbol[] = [
  sym('arr-u', 'arrows', '\u2191', 'Arrow up'),
  sym('arr-d', 'arrows', '\u2193', 'Arrow down'),
  sym('arr-l', 'arrows', '\u2190', 'Arrow left'),
  sym('arr-r', 'arrows', '\u2192', 'Arrow right'),
  sym('arr-ud', 'arrows', '\u2195', 'Arrow up-down'),
  sym('arr-lr', 'arrows', '\u2194', 'Arrow left-right'),
  sym('arr-ne', 'arrows', '\u2197', 'Arrow up-right'),
  sym('arr-se', 'arrows', '\u2198', 'Arrow down-right'),
  sym('arr-nw', 'arrows', '\u2196', 'Arrow up-left'),
  sym('arr-sw', 'arrows', '\u2199', 'Arrow down-left'),
  sym('tri-u', 'arrows', '\u25B2', 'Triangle up'),
  sym('tri-d', 'arrows', '\u25BC', 'Triangle down'),
  sym('ptr-r', 'arrows', '\u25BA', 'Pointer right'),
  sym('ptr-l', 'arrows', '\u25C4', 'Pointer left'),

  sym('shp-circ', 'shapes', '\u25CF', 'Black circle'),
  sym('shp-circ-o', 'shapes', '\u25CB', 'White circle'),
  sym('shp-circ-d', 'shapes', '\u25C9', 'Fisheye'),
  sym('shp-sq', 'shapes', '\u25A0', 'Black square'),
  sym('shp-sq-o', 'shapes', '\u25A1', 'White square'),
  sym('shp-dia', 'shapes', '\u25C6', 'Black diamond'),
  sym('shp-dia-o', 'shapes', '\u25C7', 'White diamond'),
  sym('shp-loz', 'shapes', '\u25CA', 'Lozenge'),
  sym('shp-dot', 'shapes', '\u25AA', 'Small square'),
  sym('shp-tri-r', 'shapes', '\u25B6', 'Black triangle right'),
  sym('shp-tri-l', 'shapes', '\u25C0', 'Black triangle left'),
  sym('shp-half', 'shapes', '\u25D0', 'Circle left half'),

  sym('box-h', 'box', '\u2500', 'Box light horizontal'),
  sym('box-v', 'box', '\u2502', 'Box light vertical'),
  sym('box-tl', 'box', '\u250C', 'Box down-right'),
  sym('box-tr', 'box', '\u2510', 'Box down-left'),
  sym('box-bl', 'box', '\u2514', 'Box up-right'),
  sym('box-br', 'box', '\u2518', 'Box up-left'),
  sym('box-vr', 'box', '\u251C', 'Box vertical-right'),
  sym('box-vl', 'box', '\u2524', 'Box vertical-left'),
  sym('box-hd', 'box', '\u252C', 'Box horizontal-down'),
  sym('box-hu', 'box', '\u2534', 'Box horizontal-up'),
  sym('box-x', 'box', '\u253C', 'Box cross'),
  sym('box-hh', 'box', '\u2550', 'Box double horizontal'),
  sym('box-vv', 'box', '\u2551', 'Box double vertical'),
  sym('box-dtl', 'box', '\u2554', 'Box double down-right'),
  sym('box-dtr', 'box', '\u2557', 'Box double down-left'),
  sym('box-dbl', 'box', '\u255A', 'Box double up-right'),

  sym('chk-ok', 'checks', '\u2713', 'Check'),
  sym('chk-heavy', 'checks', '\u2714', 'Heavy check'),
  sym('chk-x', 'checks', '\u2715', 'Multiply x'),
  sym('chk-heavy-x', 'checks', '\u2716', 'Heavy x'),
  sym('chk-ballot', 'checks', '\u2611', 'Ballot checked'),
  sym('chk-empty', 'checks', '\u2610', 'Ballot empty'),
  sym('chk-plus', 'checks', '\u271A', 'Heavy plus'),
  sym('chk-ballot-x', 'checks', '\u2612', 'Ballot x'),
  sym('chk-cross', 'checks', '\u2717', 'Ballot cross'),
  sym('chk-heavy-cross', 'checks', '\u2718', 'Heavy ballot cross'),

  sym('st-black', 'stars', '\u2605', 'Black star'),
  sym('st-white', 'stars', '\u2606', 'White star'),
  sym('st-spark', 'stars', '\u2726', 'Four-point star'),
  sym('st-ast', 'stars', '\u2731', 'Heavy asterisk'),
  sym('st-snow', 'stars', '\u2744', 'Snowflake'),
  sym('st-sun', 'stars', '\u2600', 'Sun'),
  sym('st-flag', 'stars', '\u2691', 'Black flag'),
  sym('st-heart', 'stars', '\u2764', 'Heart'),
  sym('st-six', 'stars', '\u2736', 'Six-pointed star'),
  sym('st-eight', 'stars', '\u2737', 'Eight-pointed star'),
];

export function isSymbolCategory(value: string): value is SymbolCategory {
  return SYMBOL_CATEGORY_SET.has(value);
}

function readFilterText(value: unknown): string {
  if (typeof value === 'string') return value;
  return '';
}

/** Chip label. Empty / "all" / non-strings are "All". Unknown categories are "". */
export function symbolCategoryLabel(category: unknown): string {
  const raw = readFilterText(category).trim().toLowerCase();
  if (raw === '' || raw === 'all') return 'All';
  if (!isSymbolCategory(raw)) return '';
  return SYMBOL_CATEGORY_LABELS[raw];
}

/** Copy of the catalog. Never throws. */
export function listSymbols(): AxisSymbol[] {
  const out: AxisSymbol[] = [];
  for (const symbol of CATALOG) {
    out.push({
      id: symbol.id,
      category: symbol.category,
      char: symbol.char,
      name: symbol.name,
    });
  }
  return out;
}

function symbolMatchesQuery(symbol: AxisSymbol, query: string): boolean {
  if (symbol.name.toLowerCase().includes(query)) return true;
  if (symbol.id.toLowerCase().includes(query)) return true;
  return symbol.char.toLowerCase().includes(query);
}

/**
 * Filter the catalog. Empty query returns the category, or every symbol when
 * category is empty / "all". Unknown categories return []. Never throws.
 */
export function filterSymbols(query: unknown, category: unknown): AxisSymbol[] {
  const q = readFilterText(query).trim().toLowerCase();
  const catRaw = readFilterText(category).trim().toLowerCase();
  const cat = catRaw === 'all' ? '' : catRaw;
  if (cat !== '' && !isSymbolCategory(cat)) return [];
  const symbols = listSymbols();
  const scoped = cat === '' ? symbols : symbols.filter((symbol) => symbol.category === cat);
  if (q === '') return scoped;
  return scoped.filter((symbol) => symbolMatchesQuery(symbol, q));
}

function canonicalQuery(query: unknown): string {
  return readFilterText(query).trim();
}

/** Unknown categories become "" (all) so a posted view state stays on a chip. */
function canonicalCategory(category: unknown): string {
  const raw = readFilterText(category).trim().toLowerCase();
  if (raw === '' || raw === 'all') return '';
  if (isSymbolCategory(raw)) return raw;
  return '';
}

function sanitizeSymbol(raw: unknown): AxisSymbol | null {
  try {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const rec = raw as Record<string, unknown>;
    const id = rec.id;
    const category = rec.category;
    const char = rec.char;
    const name = rec.name;
    if (typeof id !== 'string') return null;
    const trimmedId = id.trim();
    if (trimmedId === '') return null;
    if (typeof category !== 'string') return null;
    const cat = category.trim().toLowerCase();
    if (!isSymbolCategory(cat)) return null;
    if (typeof char !== 'string') return null;
    if (char.length === 0 || char.length > MAX_SYMBOL_TEXT) return null;
    if (typeof name !== 'string') return null;
    const trimmedName = name.trim();
    if (trimmedName === '') return null;
    return { id: trimmedId, category: cat, char, name: trimmedName };
  } catch {
    return null;
  }
}

/** Host → view snapshot. Drops hostile rows. Never throws. */
export function encodeSymbolsSet(symbols: unknown, query: unknown, category: unknown): SymbolsSetMessage {
  const text = canonicalQuery(query);
  const cat = canonicalCategory(category);
  try {
    const list: AxisSymbol[] = [];
    if (Array.isArray(symbols)) {
      for (const item of symbols) {
        const symbol = sanitizeSymbol(item);
        if (symbol) list.push(symbol);
      }
    }
    return { type: 'symbols.set', symbols: list, query: text, category: cat };
  } catch {
    return { type: 'symbols.set', symbols: [], query: text, category: cat };
  }
}

/** Decode view → host. Hostile input returns null. Never throws. */
export function parseSymbolsWebMessage(raw: unknown): SymbolsWebToHost | null {
  try {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const rec = raw as Record<string, unknown>;
    const type = rec.type;
    if (type !== 'symbols.insert' && type !== 'symbols.copy') return null;
    const text = rec.text;
    if (typeof text !== 'string') return null;
    if (text.length === 0 || text.length > MAX_SYMBOL_TEXT) return null;
    return { type, text };
  } catch {
    return null;
  }
}
