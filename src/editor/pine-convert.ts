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
 * Source-level Pine converter toward v6 (AXIS editor).
 *
 * Mirrors `pynescript.util.pine_convert`: missing `//@version` is v1;
 * comments and string literals are left unchanged. Not a semantic migrator
 * (bool-as-number / `na` tightening).
 *
 * @module editor/pine-convert
 */

const VERSION_RE = /^(\s*\/\/@version\s*=\s*)(\d+)\s*$/m;
const DECL_RE = /(?<![\w.])(indicator|strategy|library|study)\s*\(/;

const REQUEST_FNS = [
  'security_lower_tf',
  'currency_rate',
  'financial',
  'economic',
  'dividends',
  'earnings',
  'splits',
  'quandl',
  'security',
  'seed',
];
const TA_NAMES = [
  'percentile_linear_interpolation',
  'percentile_nearest_rank',
  'highestbars',
  'lowestbars',
  'percentrank',
  'correlation',
  'supertrend',
  'crossover',
  'crossunder',
  'highest',
  'lowest',
  'pivothigh',
  'pivotlow',
  'barsince',
  'falling',
  'rising',
  'valuewhen',
  'variance',
  'linreg',
  'median',
  'stdev',
  'stoch',
  'change',
  'cross',
  'alma',
  'atr',
  'bbw',
  'cci',
  'cmo',
  'cog',
  'dmi',
  'ema',
  'hma',
  'kc',
  'kcw',
  'macd',
  'mfi',
  'mom',
  'rma',
  'roc',
  'rsi',
  'sar',
  'sma',
  'swma',
  'tsi',
  'vwap',
  'vwma',
  'wma',
  'wpr',
  'bb',
  'dev',
  'iii',
  'nvi',
  'obv',
  'pvi',
  'pvt',
  'wad',
  'cum',
  'mode',
  'range',
  'accdist',
  'wvad',
  'tr',
];
const MATH_NAMES = [
  'round_to_mintick',
  'todegrees',
  'toradians',
  'random',
  'log10',
  'floor',
  'round',
  'ceil',
  'sqrt',
  'sign',
  'abs',
  'acos',
  'asin',
  'atan',
  'avg',
  'cos',
  'exp',
  'log',
  'max',
  'min',
  'pow',
  'sin',
  'sum',
  'tan',
];
const TICKER_FNS = ['heikinashi', 'pointfigure', 'linebreak', 'renko', 'kagi'];
const COLOR_NAMES = [
  'fuchsia',
  'maroon',
  'orange',
  'purple',
  'silver',
  'yellow',
  'black',
  'green',
  'navy',
  'olive',
  'teal',
  'aqua',
  'blue',
  'gray',
  'grey',
  'lime',
  'red',
  'white',
];
const TF_IDENTS = [
  'isintraday',
  'isseconds',
  'isminutes',
  'ismonthly',
  'isweekly',
  'isdaily',
  'isdwm',
  'period',
];
const DOW_NAMES = ['wednesday', 'thursday', 'saturday', 'tuesday', 'monday', 'friday', 'sunday'];
const PLOT_STYLES = ['linebr', 'stepline', 'histogram', 'columns', 'circles', 'area', 'cross', 'line'];
const HLINE_STYLES = ['dashed', 'dotted', 'solid'];
const INPUT_TYPE_TO_FN: Record<string, string> = {
  integer: 'int',
  int: 'int',
  bool: 'bool',
  float: 'float',
  string: 'string',
  color: 'color',
  source: 'source',
  symbol: 'symbol',
  session: 'session',
  time: 'time',
  resolution: 'timeframe',
  timeframe: 'timeframe',
};
const INPUT_TYPE_RE = new RegExp(
  `\\btype\\s*=\\s*(?:input\\.)?(${Object.keys(INPUT_TYPE_TO_FN).join('|')})\\b`,
);
const REQUEST_ALT = REQUEST_FNS.map(escapeRe).join('|');
const BARE_REQUEST_RE = new RegExp(`(?<![\\w.])(${REQUEST_ALT})\\s*\\(`, 'g');
const STUDY_RE = /(?<![\w.])study\s*\(/g;

export type PineConvertResult = {
  source: string;
  fromVersion: number;
  toVersion: 6;
  changed: boolean;
};

export function detectPineVersion(source: string): number | null {
  const m = VERSION_RE.exec(source);
  if (!m) return null;
  return Number.parseInt(m[2], 10);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function identRe(names: string[]): RegExp {
  return new RegExp(`(?<![\\w.])(${names.map(escapeRe).join('|')})(?![\\w.])`, 'g');
}

function prefixIdents(span: string, names: string[], ns: string): string {
  return span.replace(identRe(names), `${ns}.$1`);
}

function prefixCalls(span: string, names: string[], ns: string): string {
  const alt = names.map(escapeRe).join('|');
  return span.replace(new RegExp(`(?<![\\w.])(${alt})\\s*(?=\\()`, 'g'), `${ns}.$1`);
}

function mapLine(line: string, transform: (span: string) => string): string {
  let out = '';
  let code = '';
  let inStr: string | null = null;
  let escaped = false;
  const flush = () => {
    if (code) {
      out += transform(code);
      code = '';
    }
  };
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inStr == null) {
      if (ch === '/' && line[i + 1] === '/') {
        flush();
        out += line.slice(i);
        return out;
      }
      if (ch === '"' || ch === "'") {
        flush();
        inStr = ch;
        out += ch;
        continue;
      }
      code += ch;
      continue;
    }
    out += ch;
    if (escaped) escaped = false;
    else if (ch === '\\') escaped = true;
    else if (ch === inStr) inStr = null;
  }
  flush();
  return out;
}

function mapCodeSpans(source: string, transform: (span: string) => string): string {
  const endedNl = source.endsWith('\n');
  const body = source.split('\n').map((line) => mapLine(line, transform)).join('\n');
  return endedNl && !body.endsWith('\n') ? `${body}\n` : body;
}

function setVersion(source: string, version: number): string {
  if (VERSION_RE.test(source)) {
    return source.replace(VERSION_RE, `$1${version}`);
  }
  return `//@version=${version}\n${source}`;
}

function closeParen(source: string, openIdx: number): number | null {
  let depth = 1;
  let inStr: string | null = null;
  let escaped = false;
  for (let i = openIdx + 1; i < source.length; i += 1) {
    const ch = source[i];
    if (inStr != null) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") inStr = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    } else if (ch === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      i = nl < 0 ? source.length : nl;
    }
  }
  return null;
}

function splitTopArgs(inner: string): string[] {
  const args: string[] = [];
  let buf = '';
  let depth = 0;
  let inStr: string | null = null;
  let escaped = false;
  for (const ch of inner) {
    if (inStr != null) {
      buf += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      buf += ch;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      buf += ch;
      continue;
    }
    if (ch === ')') {
      depth -= 1;
      buf += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      args.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  const tail = buf.trim();
  if (tail) args.push(tail);
  return args;
}

function rewriteNamedCalls(
  source: string,
  name: string,
  replacer: (inner: string) => string | null,
): string {
  const pat = new RegExp(`(?<![\\w.])${escapeRe(name)}\\s*\\(`);
  let out = '';
  let i = 0;
  let inStr: string | null = null;
  let escaped = false;
  while (i < source.length) {
    const ch = source[i];
    if (inStr != null) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === inStr) inStr = null;
      i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      const end = nl < 0 ? source.length : nl;
      out += source.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      out += ch;
      i += 1;
      continue;
    }
    const slice = source.slice(i);
    const m = pat.exec(slice);
    if (m && m.index === 0) {
      const openIdx = i + m[0].length - 1;
      const closeIdx = closeParen(source, openIdx);
      if (closeIdx == null) {
        out += ch;
        i += 1;
        continue;
      }
      const inner = source.slice(openIdx + 1, closeIdx);
      const replacement = replacer(inner);
      out += replacement == null ? source.slice(i, closeIdx + 1) : replacement;
      i = closeIdx + 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function convertV3Span(span: string): string {
  let s = span.replace(/(?<![\w.])color\s*\(/g, 'color.new(');
  s = prefixIdents(s, COLOR_NAMES, 'color');
  s = prefixIdents(s, DOW_NAMES, 'dayofweek');
  s = prefixIdents(s, TF_IDENTS, 'timeframe');
  s = s.replace(/(?<![\w.])interval(?![\w.])/g, 'timeframe.multiplier');
  s = s.replace(/(?<![\w.])tickerid(?![\w.(])/g, 'syminfo.tickerid');
  s = s.replace(/(?<![\w.])ticker(?![\w.])/g, 'syminfo.ticker');
  s = s.replace(/(?<![\w.])n(?![\w.])/g, 'bar_index');
  s = s.replace(new RegExp(`\\bstyle\\s*=\\s*(${PLOT_STYLES.join('|')})\\b`, 'g'), 'style=plot.style_$1');
  s = s.replace(
    new RegExp(`\\blinestyle\\s*=\\s*(${HLINE_STYLES.join('|')})\\b`, 'g'),
    'linestyle=hline.style_$1',
  );
  s = s.replace(/\btype\s*=\s*integer\b/g, 'type=input.integer');
  s = s.replace(/\btype\s*=\s*bool\b/g, 'type=input.bool');
  s = s.replace(/\btype\s*=\s*float\b/g, 'type=input.float');
  s = s.replace(/\btype\s*=\s*string\b/g, 'type=input.string');
  s = s.replace(/\btype\s*=\s*color\b/g, 'type=input.color');
  s = s.replace(/\btype\s*=\s*source\b/g, 'type=input.source');
  s = s.replace(/\btype\s*=\s*symbol\b/g, 'type=input.symbol');
  s = s.replace(/\btype\s*=\s*session\b/g, 'type=input.session');
  s = s.replace(/\btype\s*=\s*resolution\b/g, 'type=input.resolution');
  return s;
}

function convertV4Span(span: string): string {
  STUDY_RE.lastIndex = 0;
  BARE_REQUEST_RE.lastIndex = 0;
  let s = span.replace(STUDY_RE, 'indicator(');
  s = s.replace(/(?<![\w.])resolution_gaps\b/g, 'timeframe_gaps');
  s = s.replace(/(?<![\w.])resolution\s*=/g, 'timeframe=');
  s = s.replace(/(?<![\w.])tickerid(?![\w.])/g, 'syminfo.tickerid');
  s = prefixCalls(s, TICKER_FNS, 'ticker');
  s = prefixCalls(s, TA_NAMES, 'ta');
  s = prefixCalls(s, MATH_NAMES, 'math');
  s = s.replace(/(?<![\w.])tostring\s*\(/g, 'str.tostring(');
  s = s.replace(/(?<![\w.])tonumber\s*\(/g, 'str.tonumber(');
  s = s.replace(BARE_REQUEST_RE, 'request.$1(');
  return s;
}

function rewriteIff(source: string): string {
  let prev = '';
  let cur = source;
  while (prev !== cur) {
    prev = cur;
    cur = rewriteNamedCalls(cur, 'iff', (inner) => {
      const args = splitTopArgs(inner);
      if (args.length !== 3) return null;
      return `(${args[0]}) ? (${args[1]}) : (${args[2]})`;
    });
  }
  return cur;
}

function unprefixUdfDefs(source: string): string {
  const pat = /(?<![\w.])(ta|math|ticker|str|request)\.(\w+)\s*\(/;
  let out = '';
  let i = 0;
  let inStr: string | null = null;
  let escaped = false;
  while (i < source.length) {
    const ch = source[i];
    if (inStr != null) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === inStr) inStr = null;
      i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      const end = nl < 0 ? source.length : nl;
      out += source.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      out += ch;
      i += 1;
      continue;
    }
    const slice = source.slice(i);
    const m = pat.exec(slice);
    if (m && m.index === 0) {
      const openIdx = i + m[0].length - 1;
      const closeIdx = closeParen(source, openIdx);
      if (closeIdx == null) {
        out += ch;
        i += 1;
        continue;
      }
      let j = closeIdx + 1;
      while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j += 1;
      if (source.startsWith('=>', j)) {
        out += m[2] + source.slice(openIdx, closeIdx + 1);
      } else {
        out += source.slice(i, closeIdx + 1);
      }
      i = closeIdx + 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function convertV4ToV5(source: string): string {
  let text = rewriteNamedCalls(source, 'tickerid', (inner) => `ticker.new(${inner})`);
  text = mapCodeSpans(text, convertV4Span);
  text = unprefixUdfDefs(text);
  text = rewriteIff(text);
  text = rewriteNamedCalls(text, 'offset', (inner) => {
    const args = splitTopArgs(inner);
    if (args.length !== 2) return null;
    return `${args[0]}[${args[1]}]`;
  });
  return rewriteNamedCalls(text, 'input', (inner) => {
    const m = INPUT_TYPE_RE.exec(inner);
    if (!m) return null;
    const fn = INPUT_TYPE_TO_FN[m[1]];
    let stripped = (inner.slice(0, m.index) + inner.slice(m.index + m[0].length)).trim();
    stripped = stripped.replace(/,\s*,/g, ', ').replace(/^[,\s]+|[,\s]+$/g, '');
    return `input.${fn}(${stripped})`;
  });
}

function ensureDeclaration(source: string): string {
  if (DECL_RE.test(source)) return source;
  const insert = 'indicator("Converted")\n';
  const m = VERSION_RE.exec(source);
  if (!m) return insert + source;
  const end = (m.index ?? 0) + m[0].length;
  if (end < source.length && source[end] !== '\n') {
    return `${source.slice(0, end)}\n${insert}${source.slice(end)}`;
  }
  return source.slice(0, end + 1) + insert + source.slice(end + 1);
}

function leftoverV5(span: string): string {
  STUDY_RE.lastIndex = 0;
  BARE_REQUEST_RE.lastIndex = 0;
  return span.replace(STUDY_RE, 'indicator(').replace(BARE_REQUEST_RE, 'request.$1(');
}

/**
 * Convert any older Pine version toward v6. Already-v6 source is unchanged
 * aside from normalizing `//@version=6`.
 */
export function convertPineToV6(source: string): string {
  return convertPineToV6Result(source).source;
}

export function convertPineToV6Result(source: string): PineConvertResult {
  const declared = detectPineVersion(source);
  const fromVersion = declared == null ? 1 : declared;
  if (fromVersion >= 6) {
    const next = setVersion(source, 6);
    return { source: next, fromVersion, toVersion: 6, changed: next !== source };
  }
  let text = source;
  if (fromVersion <= 3) text = mapCodeSpans(text, convertV3Span);
  if (fromVersion <= 4) text = convertV4ToV5(text);
  else text = mapCodeSpans(text, leftoverV5);
  text = ensureDeclaration(text);
  text = setVersion(text, 6);
  return { source: text, fromVersion, toVersion: 6, changed: text !== source };
}
