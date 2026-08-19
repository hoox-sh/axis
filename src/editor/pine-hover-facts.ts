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
 * Pine Script™ hover facts: keywords, types, qualifiers, series builtins,
 * namespaces, literals, and a buffer scan for user symbols.
 *
 * Used by {@link pyneHoverLocal} after named-params, `//@` annotations, and
 * the builtins catalog. Identifiers match the language reference — no invented
 * TradingView host APIs.
 *
 * @module editor/pine-hover-facts
 */

import {
  inferType1,
  inferType2,
  parseAssignLine,
  type PineType2,
} from './pine-declare-types';

/** Badge / kind strings consumed by hover tooltips. */
export type HoverFactKind =
  | 'keyword'
  | 'type'
  | 'qualifier'
  | 'series'
  | 'namespace'
  | 'variable'
  | 'function'
  | 'color'
  | 'parameter';

export type HoverFact = {
  name: string;
  kind: HoverFactKind;
  /** Tooltip title; defaults to `name`. */
  title?: string;
  /** Markdown body (short meaning). */
  body: string;
  /** Optional Pine example (rendered as a fence). */
  example?: string;
};

export type UserSymbolKind = 'variable' | 'input' | 'function' | 'type' | 'enum' | 'parameter';

export type UserSymbol = {
  name: string;
  kind: UserSymbolKind;
  /** Inferred / declared type string (`simple int`, `series float`, …). */
  type?: string;
  /** Declaration line (trimmed). */
  snippet: string;
  /** Function parameter names. */
  params?: string[];
  /** `input.*` title when present. */
  title?: string;
  /** 0-based source line. */
  line: number;
};

const FUNC_DECL =
  /^(?:export\s+)?(?:method\s+)?([A-Za-z_][\w]*)\s*\(([^)]*)\)\s*=>/;
const TYPE_DECL = /^(?:export\s+)?type\s+([A-Za-z_][\w]*)\b/;
const ENUM_DECL = /^(?:export\s+)?enum\s+([A-Za-z_][\w]*)\b/;

const RESERVED = new Set([
  'if',
  'else',
  'for',
  'while',
  'switch',
  'var',
  'varip',
  'import',
  'export',
  'type',
  'enum',
  'method',
  'and',
  'or',
  'not',
  'true',
  'false',
  'na',
  'as',
  'in',
  'to',
  'by',
  'break',
  'continue',
  'const',
  'series',
  'simple',
  'int',
  'float',
  'bool',
  'string',
  'color',
  'line',
  'label',
  'box',
  'table',
  'array',
  'matrix',
  'map',
  'polyline',
  'linefill',
  'indicator',
  'strategy',
  'library',
]);

const FACTS = new Map<string, HoverFact>();
const NAMESPACES = new Map<string, HoverFact>();

function add(kind: HoverFactKind, name: string, body: string, example?: string): void {
  FACTS.set(name, { name, kind, body, example });
}

function addNs(name: string, body: string, example?: string): void {
  NAMESPACES.set(name, { name, kind: 'namespace', body, example });
}

// ── Keywords ───────────────────────────────────────────────────────────────

add(
  'keyword',
  'if',
  'Conditional execution. Evaluates a condition and runs a block, or returns a value when used as an expression. Optional `else` / `else if` branches.',
  'x = if close > open\n    high\nelse\n    low',
);
add(
  'keyword',
  'else',
  'Alternate branch of `if` or `switch`. Runs when no earlier condition matched.',
);
add(
  'keyword',
  'for',
  'Loop. `for i = from to end` (inclusive) with optional `by` step, or `for el in collection`.',
  'for i = 0 to 9\n    sum += close[i]',
);
add(
  'keyword',
  'while',
  'Loop that repeats while the condition is true. Use `break` / `continue` to control flow.',
);
add(
  'keyword',
  'switch',
  'Multi-way branch. Match an expression against cases, or list boolean conditions. A bare `=>` is the default.',
  'v = switch tf\n    "D" => 1\n    "W" => 2\n    => 0',
);
add(
  'keyword',
  'var',
  'Declare a **persistent** variable: initialized once on the first bar and kept across bars unless reassigned with `:=`.',
  'var float sum = 0.0\nsum := sum + close',
);
add(
  'keyword',
  'varip',
  'Intrabar-**persistent** variable. Like `var`, but also keeps its value across realtime updates of the same bar.',
  'varip int ticks = 0\nticks += 1',
);
add(
  'keyword',
  'import',
  'Import a published Pine library: `import user/LibName/version as alias`. Members are `alias.name`.',
);
add(
  'keyword',
  'export',
  'Export a library member (`export` a function, `type`, `enum`, `method`, or variable) so other scripts can `import` it.',
);
add(
  'keyword',
  'type',
  'Declare a user-defined type (UDT) with fields. Create values with `TypeName.new(...)`.',
  'type Point\n    float x\n    float y',
);
add(
  'keyword',
  'enum',
  'Declare an enumeration. Members are `EnumName.member` and can be used as `input.enum` values.',
  'enum Easing\n    linear\n    ease_in',
);
add(
  'keyword',
  'method',
  'Declare a method on a UDT. The first parameter is `this` (the receiver).',
  'method mag(this Point) =>\n    math.sqrt(this.x * this.x + this.y * this.y)',
);
add('keyword', 'and', 'Boolean AND. Short-circuits: the right operand is skipped when the left is `false`.');
add('keyword', 'or', 'Boolean OR. Short-circuits: the right operand is skipped when the left is `true`.');
add('keyword', 'not', 'Boolean NOT. `not cond` is `true` when `cond` is `false`.');
add('keyword', 'true', 'Boolean literal `true`.');
add('keyword', 'false', 'Boolean literal `false`.');
add(
  'keyword',
  'na',
  '“Not available” sentinel. Test with `na(x)`; replace with `nz(x)` or `fixnan(x)`.',
);
add('keyword', 'as', 'Alias in `import user/Lib/1 as alias`.');
add('keyword', 'in', 'Collection iteration: `for el in array` (or `matrix` / `map` keys).');
add('keyword', 'to', 'Inclusive end of a numeric `for` range: `for i = 0 to n`.');
add('keyword', 'by', 'Step of a numeric `for` range: `for i = 0 to n by 2`.');
add('keyword', 'break', 'Exit the innermost `for` / `while` immediately.');
add('keyword', 'continue', 'Skip the rest of the current `for` / `while` iteration.');
add(
  'keyword',
  'const',
  'Type qualifier (and declaration form): the value is a compile-time constant. Stricter than `simple`.',
  'const int LEN = 14',
);

// ── Qualifiers ─────────────────────────────────────────────────────────────

add(
  'qualifier',
  'series',
  'Type qualifier: the value may change on every bar (unlike `simple` / `const`). Written before the type.',
  'series float x = close',
);
add(
  'qualifier',
  'simple',
  'Type qualifier: the value is the same on every bar of a run (inputs, literals). Cannot depend on a `series`.',
  'simple int len = input.int(14, "Length")',
);
add(
  'qualifier',
  'const',
  'Type qualifier: compile-time constant. More restrictive than `simple`; required by some built-in parameters.',
  'const int LEN = 14',
);

// ── Types ──────────────────────────────────────────────────────────────────

add(
  'type',
  'int',
  'Integer type. Also a cast: `int(x)`. Combine with a qualifier: `series int i = bar_index`.',
  'series int i = bar_index',
);
add(
  'type',
  'float',
  'Floating-point type. Also a cast: `float(x)`. Combine with a qualifier: `series float x = close`.',
  'series float x = close',
);
add(
  'type',
  'bool',
  'Boolean type (`true` / `false` / `na`). Also a cast: `bool(x)`.',
  'bool up = close > open',
);
add(
  'type',
  'string',
  'String type (`"..."`). Also a cast: `string(x)`. Concatenate with `+` or `str.format`.',
);
add(
  'type',
  'color',
  'Color type: hex (`#RRGGBB` / `#RRGGBBAA`), `color.red`, `color.new`, or `color.rgb`.',
  'color c = #939fff',
);
add('type', 'line', 'Drawing type for trend lines. Create with `line.new(...)`.');
add('type', 'label', 'Drawing type for chart labels. Create with `label.new(...)`.');
add('type', 'box', 'Drawing type for rectangles. Create with `box.new(...)`.');
add('type', 'table', 'Drawing type for on-chart tables. Create with `table.new(...)`.');
add(
  'type',
  'array',
  'Collection type `array<T>`. Construct with `array.new<T>()` or `array.from(...)`.',
);
add('type', 'matrix', 'Collection type `matrix<T>`. Construct with `matrix.new<T>(rows, cols)`.');
add('type', 'map', 'Collection type `map<K, V>`. Construct with `map.new<K, V>()`.');
add('type', 'polyline', 'Drawing type for multi-point polylines. Create with `polyline.new(...)`.');
add('type', 'linefill', 'Fill between two `line` objects. Create with `linefill.new(line1, line2, color)`.');
add(
  'type',
  'chart.point',
  'Point type (`index` / `time` / `price`) used by `polyline.new` and `chart.point.new` / `from_index` / `from_time`.',
  'p = chart.point.from_index(bar_index, close)',
);

// ── Series / bar builtins ──────────────────────────────────────────────────

add('series', 'open', 'Opening price of the current bar (`series float`).', 'plot(open)');
add('series', 'high', 'High price of the current bar (`series float`).', 'plot(high)');
add('series', 'low', 'Low price of the current bar (`series float`).', 'plot(low)');
add('series', 'close', 'Closing price of the current bar (`series float`).', 'plot(close)');
add('series', 'volume', 'Current bar volume (`series float`).', 'plot(volume)');
add(
  'series',
  'time',
  'UNIX timestamp (milliseconds) of the current bar’s open (`series int`). Bare `time` is also a function that accepts session/timezone args.',
);
add('series', 'bar_index', 'Zero-based index of the current bar (`series int`).', 'plot(bar_index)');
add('series', 'hl2', 'Midpoint `(high + low) / 2` (`series float`).');
add('series', 'hlc3', 'Typical price `(high + low + close) / 3` (`series float`).');
add('series', 'ohlc4', 'OHLC average `(open + high + low + close) / 4` (`series float`).');
add('series', 'hlcc4', 'HLCC average `(high + low + close + close) / 4` (`series float`).');
add(
  'series',
  'timenow',
  'Current wall-clock time as UNIX milliseconds. Updates on every realtime tick (not a historical series).',
);
add(
  'series',
  'last_bar_index',
  'Index of the last bar in the dataset (`series int`). Same as `bar_index` on the last bar.',
);

// ── Namespaces ─────────────────────────────────────────────────────────────

addNs(
  'ta',
  'Built-in **module** for **technical** analysis: moving averages, oscillators, and other studies (`ta.sma`, `ta.ema`, `ta.rsi`, …).',
  'plot(ta.sma(close, 14))',
);
addNs('math', 'Built-in **module** for mathematics (`math.abs`, `math.max`, `math.round`, `math.sqrt`, …).');
addNs('str', 'Built-in **module** for strings (`str.tostring`, `str.format`, `str.length`, …).');
addNs(
  'input',
  'Built-in **module** for script inputs shown in Settings (`input.int`, `input.float`, `input.bool`, `input.color`, …).',
  'len = input.int(14, "Length")',
);
addNs(
  'strategy',
  'Built-in **module** for strategy declaration, orders, and position state (`strategy()`, `strategy.entry`, `strategy.position_size`).',
);
addNs(
  'request',
  'Built-in **module** for extra datasets (`request.security`, `request.security_lower_tf`, `request.seed`, …).',
);
addNs(
  'color',
  'Built-in **module** for colors: named constants (`color.red`), `color.new`, `color.rgb`, and `color.from_gradient`.',
  'plot(close, color = color.teal)',
);
addNs('line', 'Built-in **module** for line drawings (`line.new`, `line.set_xy2`, `line.delete`, …).');
addNs('label', 'Built-in **module** for labels (`label.new`, `label.set_text`, `label.delete`, …).');
addNs('box', 'Built-in **module** for boxes (`box.new`, `box.set_bgcolor`, `box.delete`, …).');
addNs('table', 'Built-in **module** for tables (`table.new`, `table.cell`, `table.delete`, …).');
addNs('array', 'Built-in **module** for arrays (`array.new<T>`, `array.push`, `array.get`, …).');
addNs('matrix', 'Built-in **module** for matrices (`matrix.new<T>`, `matrix.get`, `matrix.set`, …).');
addNs('map', 'Built-in **module** for maps (`map.new<K,V>`, `map.get`, `map.put`, …).');
addNs(
  'syminfo',
  'Built-in **module** for symbol metadata (`syminfo.ticker`, `syminfo.tickerid`, `syminfo.mintick`, `syminfo.timezone`).',
);
addNs(
  'barstate',
  'Built-in **module** for bar execution state (`barstate.islast`, `barstate.ishistory`, `barstate.isrealtime`, `barstate.isconfirmed`).',
);
addNs(
  'timeframe',
  'Built-in **module** for the chart / requested timeframe (`timeframe.period`, `timeframe.multiplier`, `timeframe.change`).',
);
addNs(
  'ticker',
  'Built-in **module** for ticker constructors (`ticker.new`, `ticker.heikinashi`, `ticker.renko`).',
);
addNs(
  'session',
  'Built-in **module** for session constants and tests (`session.regular`, `session.extended`).',
);
addNs(
  'chart',
  'Built-in **module** for chart context and `chart.point` constructors (`chart.point.new`, `chart.point.from_index`).',
);

export type HoverFactLookupOpts = {
  /** Prefer the namespace entry when a name is both a type and a module (`color`, `line`, …). */
  prefer?: 'namespace' | 'type';
};

/** Look up a static language fact (keyword / type / qualifier / series / namespace). */
export function lookupHoverFact(name: string, opts?: HoverFactLookupOpts): HoverFact | null {
  if (!name) return null;
  if (opts?.prefer === 'namespace') {
    return NAMESPACES.get(name) || FACTS.get(name) || null;
  }
  if (opts?.prefer === 'type') {
    const f = FACTS.get(name);
    if (f?.kind === 'type' || f?.kind === 'qualifier') return f;
  }
  return FACTS.get(name) || NAMESPACES.get(name) || null;
}

/** Which dotted segment of `word` contains `pos` (`ta` vs `sma` in `ta.sma`). */
export function dottedSegmentAt(
  word: string,
  from: number,
  pos: number,
): { name: string; index: number; count: number } {
  const segs = word.split('.');
  if (segs.length <= 1) return { name: word, index: 0, count: segs.length || 1 };
  let rel = pos - from;
  if (rel < 0) rel = 0;
  if (rel > word.length) rel = word.length;
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    const end = acc + segs[i]!.length;
    if (rel <= end) return { name: segs[i]!, index: i, count: segs.length };
    acc = end + 1;
  }
  return { name: segs[segs.length - 1]!, index: segs.length - 1, count: segs.length };
}

const HEX_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8}|[0-9a-fA-F]{3,4})\b/;

/** Hex color `#rgb` / `#rrggbb` / `#rrggbbaa` under `pos`, if any. */
export function hexColorAt(
  text: string,
  pos: number,
): { word: string; from: number; to: number } | null {
  if (pos < 0 || pos > text.length) return null;
  const isHex = (c: string) => /[0-9a-fA-F]/.test(c);
  let i = pos;
  if (i < text.length && text[i] !== '#' && !isHex(text[i]!)) {
    if (i > 0 && (text[i - 1] === '#' || isHex(text[i - 1]!))) i--;
    else return null;
  }
  let from = i;
  while (from > 0 && isHex(text[from - 1]!)) from--;
  if (from > 0 && text[from - 1] === '#') from--;
  if (text[from] !== '#') return null;
  const m = HEX_RE.exec(text.slice(from));
  if (!m) return null;
  const to = from + m[0].length;
  if (pos < from || pos > to) return null;
  return { word: m[0], from, to };
}

export function isHexColorToken(word: string): boolean {
  return HEX_RE.test(word);
}

/** Color-literal hover body. */
export function formatColorLiteralMarkdown(hex: string): string {
  return `\`${hex}\` is a Pine **color** literal (\`#RRGGBB\` or \`#RRGGBBAA\`).`;
}

/** True when `pos` sits in a `//` line comment (not inside a string). */
export function inPineLineComment(text: string, pos: number): boolean {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  let i = lineStart;
  let quote: '"' | "'" | null = null;
  while (i < pos) {
    const c = text[i]!;
    if (quote) {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') return true;
    i++;
  }
  return false;
}

/**
 * Enclosing `"..."` / `'...'` at `pos` (same line; ignores escaped quotes).
 * Triple-quoted strings are treated as the inner quote char.
 */
export function enclosingStringAt(
  text: string,
  pos: number,
): { from: number; to: number; value: string } | null {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const lineEndIdx = text.indexOf('\n', pos);
  const lineEnd = lineEndIdx < 0 ? text.length : lineEndIdx;
  let i = lineStart;
  while (i < lineEnd) {
    const c = text[i]!;
    if (c !== '"' && c !== "'") {
      i++;
      continue;
    }
    const q = c;
    const from = i;
    i++;
    let value = '';
    while (i < lineEnd) {
      const ch = text[i]!;
      if (ch === '\\') {
        value += text.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (ch === q) {
        const to = i + 1;
        if (pos >= from && pos <= to) {
          return { from, to, value };
        }
        i++;
        break;
      }
      value += ch;
      i++;
    }
  }
  return null;
}

/** True when `word` is a numeric literal token. */
export function isNumericLiteral(word: string): boolean {
  return /^[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?$/.test(word);
}

/**
 * Type / qualifier fact when `word` is in a declaration (`series float x =`,
 * `float len =`, `array<float>`). Used to beat cast-function builtins.
 */
export function declarationTypeFact(
  text: string,
  hit: { word: string; from: number; to: number },
): HoverFact | null {
  const fact = lookupHoverFact(hit.word, { prefer: 'type' });
  if (!fact || (fact.kind !== 'type' && fact.kind !== 'qualifier')) return null;
  const after = text.slice(hit.to);
  if (fact.kind === 'qualifier') {
    if (/^\s+(?:series|simple|const\s+)?[A-Za-z_]/.test(after)) return fact;
    if (/^\s+[A-Za-z_][\w.]*\s*=/.test(after)) return fact;
    return null;
  }
  if (/^\s*[<\[]/.test(after)) return fact;
  if (/^\s+[A-Za-z_][\w]*\s*(?:=|:=|,|\)|$)/.test(after)) return fact;
  return null;
}

function parseParamNames(list: string): string[] {
  if (!list.trim()) return [];
  const out: string[] = [];
  for (const raw of list.split(',')) {
    const spec = raw.trim();
    if (!spec || spec === '...' || spec === '…') continue;
    const beforeEq = spec.split('=')[0]!.trim();
    if (/^this\b/.test(beforeEq)) {
      out.push('this');
      continue;
    }
    const idents = beforeEq.match(/[A-Za-z_][\w.]*/g) || [];
    const name = idents[idents.length - 1];
    if (name && !RESERVED.has(name)) out.push(name);
    else if (name === 'this') out.push(name);
  }
  return out;
}

function extractInputTitle(rhs: string): string | undefined {
  const named = rhs.match(/\btitle\s*=\s*(["'])([^"'\\]*)\1/);
  if (named?.[2]) return named[2];
  const pos = rhs.match(/\binput(?:\.\w+)?\s*\(\s*[^,)]+\s*,\s*(["'])([^"'\\]*)\1/);
  return pos?.[2] || undefined;
}

function remember(map: Map<string, UserSymbol>, sym: UserSymbol): void {
  if (!sym.name || RESERVED.has(sym.name)) return;
  if (map.has(sym.name)) return;
  map.set(sym.name, sym);
}

/** Scan assignments, functions, `type`, and `enum` declarations in `source`. */
export function scanUserSymbols(source: string): Map<string, UserSymbol> {
  const map = new Map<string, UserSymbol>();
  const lines = String(source ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  let typeBlockIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    const indent = (/^\s*/.exec(raw)?.[0].length ?? 0) as number;
    if (typeBlockIndent >= 0) {
      if (indent > typeBlockIndent) continue;
      typeBlockIndent = -1;
    }

    const typeM = trimmed.match(TYPE_DECL);
    if (typeM) {
      remember(map, { name: typeM[1]!, kind: 'type', snippet: trimmed, line: i });
      typeBlockIndent = indent;
      continue;
    }
    const enumM = trimmed.match(ENUM_DECL);
    if (enumM) {
      remember(map, { name: enumM[1]!, kind: 'enum', snippet: trimmed, line: i });
      typeBlockIndent = indent;
      continue;
    }

    const funcM = trimmed.match(FUNC_DECL);
    if (funcM) {
      remember(map, {
        name: funcM[1]!,
        kind: 'function',
        snippet: trimmed,
        params: parseParamNames(funcM[2] || ''),
        line: i,
      });
      continue;
    }

    const hit = parseAssignLine(raw);
    if (!hit) continue;
    const isInput = /\binput(?:\.|\s*\()/.test(hit.rhs);
    const type2: PineType2 | null =
      (hit.type2 as PineType2 | null) || inferType2(hit.rhs);
    const type1 = hit.type1 || inferType1(hit.rhs, type2);
    const typeParts = [hit.mode, type1, type2].filter(Boolean);
    remember(map, {
      name: hit.name,
      kind: isInput ? 'input' : 'variable',
      type: typeParts.length ? typeParts.join(' ') : undefined,
      snippet: trimmed,
      title: isInput ? extractInputTitle(hit.rhs) : undefined,
      line: i,
    });
  }
  return map;
}

/** Look up a user symbol by exact name, then bare member after `.`. */
export function lookupUserSymbol(source: string, name: string): UserSymbol | null {
  if (!name) return null;
  const map = scanUserSymbols(source);
  if (map.has(name)) return map.get(name)!;
  if (name.includes('.')) {
    const bare = name.split('.').pop()!;
    if (map.has(bare)) return map.get(bare)!;
  }
  return null;
}

/** Markdown body for a language fact. */
export function formatHoverFactMarkdown(fact: HoverFact): string {
  const parts: string[] = [fact.body];
  if (fact.example) {
    parts.push('**Example**', '```pinescript\n' + fact.example + '\n```');
  }
  return parts.join('\n\n');
}

/** Badge string for a user symbol (subset of {@link HoverFactKind}). */
export function userSymbolBadge(sym: UserSymbol): HoverFactKind {
  if (sym.kind === 'function') return 'function';
  if (sym.kind === 'type' || sym.kind === 'enum') return 'type';
  if (sym.kind === 'parameter') return 'parameter';
  return 'variable';
}

/** Markdown body for a scanned user symbol. */
export function formatUserSymbolMarkdown(sym: UserSymbol): string {
  const parts: string[] = [];
  const kindLabel = sym.kind === 'enum' ? 'enum' : sym.kind;
  const typeBit = sym.type ? ` · \`${sym.type}\`` : '';
  parts.push(`User **${kindLabel}**${typeBit}.`);
  if (sym.title) {
    parts.push(`Title: ${sym.title}`);
  }
  if (sym.params?.length) {
    parts.push('**Parameters:** ' + sym.params.map((p) => `\`${p}\``).join(', '));
  }
  if (sym.snippet) {
    parts.push('```pinescript\n' + sym.snippet + '\n```');
  }
  return parts.join('\n\n');
}
