// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Call-site parameter intelligence for Pine hover + completions.
 *
 * Parses `plot(…)` / `ta.sma(…)` signatures, finds the enclosing call at the
 * cursor, and classifies arguments as used / current / unused so AXIS can
 * suggest remaining named params after `,` and show a checklist hint.
 *
 * @module editor/pine-call-params
 */

export interface PineParamDef {
  name: string;
  optional?: boolean;
  defaultValue?: string;
  rest?: boolean;
  description?: string;
}

export interface PineCallSig {
  name: string;
  params: PineParamDef[];
  returns?: string;
  description?: string;
  example?: string;
}

export interface CallArg {
  raw: string;
  name?: string;
  from: number;
  to: number;
}

export interface CallSite {
  name: string;
  openParen: number;
  /** 0-based index of the argument the cursor is in. */
  cursorArgIndex: number;
  args: CallArg[];
  namedUsed: Set<string>;
  /** How many unnamed positional args are already written. */
  positionalUsed: number;
  /** Text of the argument being typed (no surrounding spaces). */
  prefix: string;
  /** Document offset where the current argument starts. */
  argFrom: number;
}

const CONTROL_CALLS = new Set([
  'if',
  'else',
  'for',
  'while',
  'switch',
  'and',
  'or',
  'not',
]);

/** Compact curated signatures for the calls users type most. */
const CURATED: Record<string, PineCallSig> = {
  plot: {
    name: 'plot',
    params: [
      { name: 'series', description: 'Series of values to display' },
      { name: 'title', optional: true, description: 'Plot title in the scale / data window' },
      { name: 'color', optional: true, description: 'Plot color (`color.red`, `color.new`, hex)' },
      { name: 'linewidth', optional: true, description: 'Line width in pixels' },
      { name: 'style', optional: true, description: '`plot.style_line`, `plot.style_histogram`, …' },
      { name: 'trackprice', optional: true, description: 'Draw a price line for the last value' },
      { name: 'histbase', optional: true, description: 'Histogram baseline' },
      { name: 'offset', optional: true, description: 'Bar offset (negative = left)' },
      { name: 'join', optional: true, description: 'Connect histogram / columns' },
      { name: 'editable', optional: true, description: 'Show in Style settings' },
      { name: 'show_last', optional: true, description: 'Only draw the last N bars' },
      { name: 'display', optional: true, description: '`display.all` / `display.none`' },
      { name: 'format', optional: true, description: '`format.price` / `format.percent`' },
      { name: 'precision', optional: true, description: 'Decimal places' },
      { name: 'force_overlay', optional: true, description: 'Force onto the price pane' },
      { name: 'linestyle', optional: true, description: '`plot.linestyle_solid` / dashed / dotted' },
    ],
    returns: 'plot',
    description: 'Plot a series on the chart.',
    example: 'plot(close, "Close", color.teal, linewidth=2)',
  },
  plotshape: {
    name: 'plotshape',
    params: [
      { name: 'series', description: 'True / non-na to draw a shape' },
      { name: 'title', optional: true, description: 'Shape title' },
      { name: 'style', optional: true, description: '`shape.triangleup`, `shape.circle`, …' },
      { name: 'location', optional: true, description: '`location.abovebar` / `location.belowbar`' },
      { name: 'color', optional: true, description: 'Shape color' },
      { name: 'offset', optional: true, description: 'Bar offset' },
      { name: 'text', optional: true, description: 'Optional label text' },
      { name: 'textcolor', optional: true, description: 'Text color' },
      { name: 'editable', optional: true },
      { name: 'size', optional: true, description: '`size.tiny` … `size.huge`' },
      { name: 'show_last', optional: true },
      { name: 'display', optional: true },
    ],
    example: 'plotshape(ta.crossover(fast, slow), style=shape.triangleup, location=location.belowbar)',
  },
  plotchar: {
    name: 'plotchar',
    params: [
      { name: 'series', description: 'True / non-na to draw the character' },
      { name: 'title', optional: true },
      { name: 'char', optional: true, description: 'Single character, e.g. `"▲"`' },
      { name: 'location', optional: true },
      { name: 'color', optional: true },
      { name: 'offset', optional: true },
      { name: 'text', optional: true },
      { name: 'textcolor', optional: true },
      { name: 'editable', optional: true },
      { name: 'size', optional: true },
      { name: 'show_last', optional: true },
      { name: 'display', optional: true },
    ],
    example: 'plotchar(longCond, char="▲", location=location.belowbar, color=color.lime)',
  },
  hline: {
    name: 'hline',
    params: [
      { name: 'price', description: 'Horizontal price / level' },
      { name: 'title', optional: true },
      { name: 'color', optional: true },
      { name: 'linestyle', optional: true, description: '`hline.style_dashed` / `hline.style_dotted`' },
      { name: 'linewidth', optional: true },
      { name: 'editable', optional: true },
      { name: 'display', optional: true },
    ],
    example: 'hline(70, "Overbought", color.red, linestyle=hline.style_dashed)',
  },
  bgcolor: {
    name: 'bgcolor',
    params: [
      { name: 'color', description: 'Background color (`na` = none)' },
      { name: 'offset', optional: true },
      { name: 'editable', optional: true },
      { name: 'show_last', optional: true },
      { name: 'title', optional: true },
      { name: 'display', optional: true },
    ],
    example: 'bgcolor(close > open ? color.new(color.teal, 85) : na)',
  },
  indicator: {
    name: 'indicator',
    params: [
      { name: 'title', description: 'Script name in the chart legend' },
      { name: 'shorttitle', optional: true, description: 'Compact name on the pane' },
      { name: 'overlay', optional: true, description: '`true` = price pane, `false` = own pane' },
      { name: 'format', optional: true, description: '`format.price` / `format.percent` / `format.volume`' },
      { name: 'precision', optional: true, description: 'Decimal places on the scale' },
      { name: 'scale', optional: true, description: '`scale.right` / `scale.left` / `scale.none`' },
      { name: 'max_bars_back', optional: true, description: 'History buffer depth' },
      { name: 'timeframe', optional: true, description: 'MTF: `"60"`, `"D"`, `timeframe.period`' },
      { name: 'timeframe_gaps', optional: true, description: 'Leave gaps when MTF bars do not align' },
      { name: 'explicit_plot_zorder', optional: true, description: 'Honour plot() call order for z-index' },
      { name: 'max_lines_count', optional: true },
      { name: 'max_labels_count', optional: true },
      { name: 'max_boxes_count', optional: true },
      { name: 'calc_bars_count', optional: true, description: 'Limit calculated bars' },
      { name: 'max_polylines_count', optional: true },
      { name: 'dynamic_requests', optional: true, description: 'Allow series `request.*` (v6)' },
      { name: 'behind_chart', optional: true, description: 'Draw behind candles (v6)' },
    ],
    description: 'Declare an indicator script.',
    example: 'indicator("RSI", shorttitle="RSI", overlay=false)',
  },
  input: {
    name: 'input',
    params: [
      { name: 'defval', description: 'Default value (type is inferred)' },
      { name: 'title', optional: true, description: 'Settings label' },
      { name: 'tooltip', optional: true, description: 'Hover help (`\\n` for line breaks)' },
      { name: 'inline', optional: true, description: 'Same string = same Settings row' },
      { name: 'group', optional: true, description: 'Settings section heading' },
      { name: 'confirm', optional: true, description: 'Prompt on the chart when added' },
      { name: 'active', optional: true, description: '`true` / `false` or another input ident' },
    ],
    returns: 'value',
    description: 'Generic script input (type follows `defval`).',
    example: 'len = input(14, "Length", group="Inputs")',
  },
  'input.int': {
    name: 'input.int',
    params: [
      { name: 'defval', description: 'Default integer' },
      { name: 'title', optional: true, description: 'Settings label' },
      { name: 'minval', optional: true, description: 'Minimum allowed value' },
      { name: 'maxval', optional: true, description: 'Maximum allowed value' },
      { name: 'step', optional: true, description: 'Spinner step' },
      { name: 'tooltip', optional: true, description: 'Hover help (`\\n` for line breaks)' },
      { name: 'inline', optional: true, description: 'Same string = same Settings row' },
      { name: 'group', optional: true, description: 'Settings section heading' },
      { name: 'confirm', optional: true },
      { name: 'display', optional: true },
      { name: 'active', optional: true, description: '`true` / `false` or another input ident' },
    ],
    returns: 'int',
    example: 'len = input.int(14, "Length", minval=1, maxval=200)',
  },
  'input.float': {
    name: 'input.float',
    params: [
      { name: 'defval', description: 'Default float' },
      { name: 'title', optional: true },
      { name: 'minval', optional: true },
      { name: 'maxval', optional: true },
      { name: 'step', optional: true },
      { name: 'tooltip', optional: true },
      { name: 'inline', optional: true },
      { name: 'group', optional: true },
      { name: 'confirm', optional: true },
      { name: 'display', optional: true },
      { name: 'active', optional: true },
    ],
    returns: 'float',
    example: 'mult = input.float(2.0, "StdDev", minval=0.1, step=0.1)',
  },
  'input.bool': {
    name: 'input.bool',
    params: [
      { name: 'defval', description: 'Default true/false' },
      { name: 'title', optional: true },
      { name: 'tooltip', optional: true },
      { name: 'inline', optional: true },
      { name: 'group', optional: true },
      { name: 'confirm', optional: true },
      { name: 'display', optional: true },
      { name: 'active', optional: true },
    ],
    returns: 'bool',
    example: 'showMa = input.bool(true, "Show MA")',
  },
  'input.string': {
    name: 'input.string',
    params: [
      { name: 'defval', description: 'Default string' },
      { name: 'title', optional: true },
      { name: 'options', optional: true, description: 'Dropdown list, e.g. `["A","B"]`' },
      { name: 'tooltip', optional: true },
      { name: 'inline', optional: true },
      { name: 'group', optional: true },
      { name: 'confirm', optional: true },
      { name: 'display', optional: true },
      { name: 'active', optional: true },
    ],
    returns: 'string',
    example: 'tf = input.string("1h", "Timeframe", options=["15m","1h","4h"])',
  },
  'input.source': {
    name: 'input.source',
    params: [
      { name: 'defval', description: '`close`, `hlc3`, …' },
      { name: 'title', optional: true },
      { name: 'tooltip', optional: true },
      { name: 'inline', optional: true },
      { name: 'group', optional: true },
      { name: 'display', optional: true },
      { name: 'active', optional: true },
    ],
    returns: 'source',
    example: 'src = input.source(close, "Source")',
  },
  'input.color': {
    name: 'input.color',
    params: [
      { name: 'defval', description: 'Default color' },
      { name: 'title', optional: true },
      { name: 'tooltip', optional: true },
      { name: 'inline', optional: true },
      { name: 'group', optional: true },
      { name: 'confirm', optional: true },
      { name: 'display', optional: true },
      { name: 'active', optional: true },
    ],
    returns: 'color',
    example: 'col = input.color(color.teal, "Line")',
  },
  'input.enum': {
    name: 'input.enum',
    params: [
      { name: 'defval', description: 'Default enum member (`Easing.linear`)' },
      { name: 'title', optional: true },
      { name: 'options', optional: true, description: 'Optional subset of members' },
      { name: 'tooltip', optional: true },
      { name: 'inline', optional: true },
      { name: 'group', optional: true },
      { name: 'confirm', optional: true },
      { name: 'display', optional: true },
      { name: 'active', optional: true },
    ],
    example: 'easing = input.enum(Easing.linear, "Easing")',
  },
  'ta.sma': {
    name: 'ta.sma',
    params: [
      { name: 'source', description: 'Series of values (`close`, a plot, …)' },
      { name: 'length', description: 'Lookback period (int ≥ 1)' },
    ],
    returns: 'series float',
    description: 'Simple moving average.',
    example: 'ta.sma(close, 14)',
  },
  'ta.ema': {
    name: 'ta.ema',
    params: [
      { name: 'source', description: 'Series of values' },
      { name: 'length', description: 'Lookback period' },
    ],
    returns: 'series float',
    example: 'ta.ema(close, 21)',
  },
  'ta.rma': {
    name: 'ta.rma',
    params: [
      { name: 'source', description: 'Series of values' },
      { name: 'length', description: 'Lookback period' },
    ],
    returns: 'series float',
    description: 'Rolling / Wilder moving average.',
    example: 'ta.rma(close, 14)',
  },
  'ta.vwma': {
    name: 'ta.vwma',
    params: [
      { name: 'source', description: 'Series of values' },
      { name: 'length', description: 'Lookback period' },
    ],
    returns: 'series float',
    description: 'Volume-weighted moving average.',
    example: 'ta.vwma(close, 20)',
  },
  'ta.rsi': {
    name: 'ta.rsi',
    params: [
      { name: 'source', description: 'Series of values' },
      { name: 'length', description: 'Lookback period' },
    ],
    returns: 'series float',
    example: 'ta.rsi(close, 14)',
  },
  'ta.atr': {
    name: 'ta.atr',
    params: [{ name: 'length', description: 'Lookback period' }],
    returns: 'series float',
    example: 'ta.atr(14)',
  },
  'ta.crossover': {
    name: 'ta.crossover',
    params: [
      { name: 'source1', description: 'First series' },
      { name: 'source2', description: 'Second series' },
    ],
    returns: 'series bool',
    example: 'ta.crossover(fast, slow)',
  },
  'ta.crossunder': {
    name: 'ta.crossunder',
    params: [
      { name: 'source1', description: 'First series' },
      { name: 'source2', description: 'Second series' },
    ],
    returns: 'series bool',
    example: 'ta.crossunder(fast, slow)',
  },
  'ta.highest': {
    name: 'ta.highest',
    params: [
      { name: 'source', description: 'Series (or length if one-arg form)' },
      { name: 'length', optional: true, description: 'Lookback period' },
    ],
    example: 'ta.highest(high, 20)',
  },
  'ta.lowest': {
    name: 'ta.lowest',
    params: [
      { name: 'source', description: 'Series (or length if one-arg form)' },
      { name: 'length', optional: true, description: 'Lookback period' },
    ],
    example: 'ta.lowest(low, 20)',
  },
  'ta.macd': {
    name: 'ta.macd',
    params: [
      { name: 'source', description: 'Series of values' },
      { name: 'fastlen', description: 'Fast EMA length' },
      { name: 'slowlen', description: 'Slow EMA length' },
      { name: 'siglen', description: 'Signal EMA length' },
    ],
    returns: '[macd, signal, hist]',
    example: '[macdLine, signalLine, hist] = ta.macd(close, 12, 26, 9)',
  },
  'color.new': {
    name: 'color.new',
    params: [
      { name: 'color', description: 'Base color' },
      { name: 'transp', description: 'Transparency 0 (solid) … 100 (invisible)' },
    ],
    returns: 'color',
    example: 'color.new(color.teal, 80)',
  },
  'color.rgb': {
    name: 'color.rgb',
    params: [
      { name: 'red', description: '0–255' },
      { name: 'green', description: '0–255' },
      { name: 'blue', description: '0–255' },
      { name: 'transp', optional: true, description: '0–100' },
    ],
    returns: 'color',
    example: 'color.rgb(147, 159, 255, 20)',
  },
  'label.new': {
    name: 'label.new',
    params: [
      { name: 'x', description: 'Bar index or time (`xloc`)' },
      { name: 'y', description: 'Price' },
      { name: 'text', optional: true },
      { name: 'xloc', optional: true, description: '`xloc.bar_index` / `xloc.bar_time`' },
      { name: 'yloc', optional: true, description: '`yloc.price` / `yloc.abovebar`' },
      { name: 'color', optional: true },
      { name: 'style', optional: true, description: '`label.style_label_up`, …' },
      { name: 'textcolor', optional: true },
      { name: 'size', optional: true },
      { name: 'textalign', optional: true },
      { name: 'tooltip', optional: true },
    ],
    example: 'label.new(bar_index, high, "High", style=label.style_label_down)',
  },
  'line.new': {
    name: 'line.new',
    params: [
      { name: 'x1', description: 'Start bar / time' },
      { name: 'y1', description: 'Start price' },
      { name: 'x2', description: 'End bar / time' },
      { name: 'y2', description: 'End price' },
      { name: 'xloc', optional: true },
      { name: 'extend', optional: true, description: '`extend.none` / `extend.right`' },
      { name: 'color', optional: true },
      { name: 'style', optional: true, description: '`line.style_solid` / dashed' },
      { name: 'width', optional: true },
    ],
    example: 'line.new(bar_index[10], high[10], bar_index, high, extend=extend.right)',
  },
  'strategy.entry': {
    name: 'strategy.entry',
    params: [
      { name: 'id', description: 'Order id' },
      { name: 'direction', description: '`strategy.long` / `strategy.short`' },
      { name: 'qty', optional: true },
      { name: 'limit', optional: true },
      { name: 'stop', optional: true },
      { name: 'oca_name', optional: true },
      { name: 'oca_type', optional: true },
      { name: 'comment', optional: true },
      { name: 'alert_message', optional: true },
    ],
    example: 'strategy.entry("Long", strategy.long)',
  },
  'strategy.close': {
    name: 'strategy.close',
    params: [
      { name: 'id', description: 'Entry id to close' },
      { name: 'comment', optional: true },
      { name: 'qty', optional: true },
      { name: 'qty_percent', optional: true },
      { name: 'alert_message', optional: true },
    ],
    example: 'strategy.close("Long")',
  },
  'request.security': {
    name: 'request.security',
    params: [
      { name: 'symbol', description: '`syminfo.tickerid` or `"BINANCE:BTCUSDT"`' },
      { name: 'timeframe', description: '`"60"`, `"D"`, `timeframe.period`' },
      { name: 'expression', description: 'Value to request (`close`, a tuple, …)' },
      { name: 'gaps', optional: true, description: '`barmerge.gaps_off` / `barmerge.gaps_on`' },
      { name: 'lookahead', optional: true, description: '`barmerge.lookahead_off` (default)' },
      { name: 'ignore_invalid_symbol', optional: true },
    ],
    example: 'request.security(syminfo.tickerid, "D", close)',
  },
  alert: {
    name: 'alert',
    params: [
      { name: 'message', description: 'Alert text' },
      { name: 'freq', optional: true, description: '`alert.freq_once_per_bar` / `alert.freq_all`' },
    ],
    example: 'alert("Cross", alert.freq_once_per_bar)',
  },
  nz: {
    name: 'nz',
    params: [
      { name: 'x', description: 'Value that may be `na`' },
      { name: 'y', optional: true, description: 'Replacement when `x` is `na` (default 0)' },
    ],
    example: 'nz(ta.sma(close, 14), close)',
  },
};

function curatedFor(name: string): PineCallSig | undefined {
  const n = String(name || '').trim();
  if (!n) return undefined;
  if (CURATED[n]) return CURATED[n];
  const bare = n.includes('.') ? n.slice(n.lastIndexOf('.') + 1) : n;
  // Bare `sma(` / `foo.sma(` → ta.sma. Do not map `close` → strategy.close.
  if (bare && CURATED[`ta.${bare}`]) return CURATED[`ta.${bare}`];
  return undefined;
}

function isIdentChar(c: string): boolean {
  return /[\w.]/.test(c);
}

/** Index of a keyword `=` (`offset=0.85`), not `==` / `!=` / `<=` / `>=` / `=>`. */
function kwEqIndex(s: string): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '=') continue;
    const prev = s[i - 1];
    const next = s[i + 1];
    if (prev === '<' || prev === '>' || prev === '!' || prev === '=') continue;
    if (next === '=' || next === '>') continue;
    return i;
  }
  return -1;
}

function identBefore(src: string, paren: number): string {
  let j = paren - 1;
  while (j >= 0 && /\s/.test(src[j]!)) j--;
  const end = j + 1;
  while (j >= 0 && isIdentChar(src[j]!)) j--;
  return src.slice(j + 1, end);
}

type PartSpan = { text: string; from: number; to: number };

/**
 * Split on top-level commas. Keeps empty slots (`a, , b` / trailing `,`).
 * Strings and nested `()` / `[]` / `{}` are not split. `//` runs to EOL.
 */
function splitTopLevelParts(inner: string, base: number): PartSpan[] {
  const out: PartSpan[] = [];
  let cur = '';
  let start = base;
  let depth = 0;
  let inStr: '"' | "'" | null = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    const abs = base + i;
    if (inStr) {
      cur += c;
      if (c === '\\') {
        if (i + 1 < inner.length) cur += inner[++i];
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      cur += c;
      continue;
    }
    if (c === '/' && inner[i + 1] === '/') {
      cur += inner.slice(i);
      break;
    }
    if (c === '(' || c === '[' || c === '{') {
      depth++;
      cur += c;
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      depth--;
      cur += c;
      continue;
    }
    if (c === ',' && depth === 0) {
      out.push({ text: cur, from: start, to: abs });
      cur = '';
      start = abs + 1;
      continue;
    }
    cur += c;
  }
  out.push({ text: cur, from: start, to: base + inner.length });
  return out;
}

/** Split a parenthesized param list on top-level commas. */
export function splitTopLevelParams(inner: string): string[] {
  return splitTopLevelParts(String(inner ?? ''), 0)
    .map((p) => p.text.trim())
    .filter(Boolean);
}

function unwrapSnippet(part: string): string {
  return part.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\d+/g, '').trim();
}

function isJunkParamName(name: string): boolean {
  return /^(param|arg)\d+$/i.test(name);
}

function isRestToken(part: string): boolean {
  const t = part.trim();
  return t === '…' || t === '...' || t === '..' || /^\.{3}\w*$/.test(t) || /^…\w*$/.test(t);
}

/**
 * Parse `name(a, b=1, c?, …)` / `foo(a, b) → T` / a bare list (`offset=0.85`)
 * into parameter defs. Snippet placeholders and `param1` junk are skipped.
 */
export function parseSignatureParams(raw: string): PineParamDef[] {
  const s = String(raw || '').trim();
  if (!s) return [];
  let inner = s;
  const open = s.indexOf('(');
  if (open >= 0) {
    let depth = 0;
    let inStr: '"' | "'" | null = null;
    let close = -1;
    for (let i = open; i < s.length; i++) {
      const c = s[i]!;
      if (inStr) {
        if (c === '\\') {
          i++;
          continue;
        }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'") {
        inStr = c;
        continue;
      }
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    inner = close > open ? s.slice(open + 1, close) : s.slice(open + 1);
  }
  const params: PineParamDef[] = [];
  for (const part of splitTopLevelParams(inner)) {
    const t = unwrapSnippet(part);
    if (!t) continue;
    if (isRestToken(t) || /^[.…]+$/.test(t)) {
      params.push({ name: '…', rest: true, optional: true });
      continue;
    }
    const eq = kwEqIndex(t);
    let namePart = (eq >= 0 ? t.slice(0, eq) : t).trim();
    let defaultValue = eq >= 0 ? t.slice(eq + 1).trim() : undefined;
    if (defaultValue === '') defaultValue = undefined;
    const optionalMark = /\?$/.test(namePart);
    namePart = namePart.replace(/\?$/, '').trim();
    const bits = namePart.split(/\s+/);
    let name = (bits[bits.length - 1] || namePart).replace(/[^\w]/g, '');
    if (!name || isJunkParamName(name) || !/^[A-Za-z_][\w]*$/.test(name)) continue;
    params.push({
      name,
      optional: defaultValue != null || optionalMark,
      defaultValue,
    });
  }
  return params;
}

function firstSignatureLine(name: string, text: string): string | null {
  const src = String(text || '');
  if (!src.trim() || !name) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:Signature:\\s*)?(?:\`\`?)?${escaped}\\s*\\(`, 'i');
  const m = src.match(re);
  if (m && m.index != null) {
    const from = src.indexOf('(', m.index);
    if (from >= 0) {
      const parsed = parseSignatureParams(src.slice(m.index));
      if (parsed.length) {
        const close = src.indexOf('\n', from);
        return src.slice(m.index, close < 0 ? src.length : close).replace(/^[`\s]+|[`\s]+$/g, '').replace(/^Signature:\s*/i, '');
      }
    }
  }
  const bare = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name;
  if (bare !== name) return firstSignatureLine(bare, src);
  return null;
}

export interface ResolveCallSigOpts {
  documentation?: string;
  detail?: string;
  brief?: string;
  snippet?: string;
  localParams?: Array<{ name: string; description: string }>;
  localDescription?: string;
}

/** Resolve a call signature: curated → local @param → parsed docs / snippet. */
export function resolveCallSignature(
  name: string,
  extra?: ResolveCallSigOpts,
): PineCallSig | null {
  const n = String(name || '').trim();
  if (!n) return null;
  const curated = curatedFor(n);
  if (curated) {
    if (extra?.localParams?.length) {
      const byName = new Map(extra.localParams.map((p) => [p.name, p.description]));
      return {
        ...curated,
        name: curated.name,
        description: extra.localDescription || curated.description,
        params: curated.params.map((p) =>
          byName.has(p.name) ? { ...p, description: byName.get(p.name) } : p,
        ),
      };
    }
    return curated;
  }

  if (extra?.localParams?.length) {
    return {
      name: n,
      description: extra.localDescription,
      params: extra.localParams.map((p) => ({
        name: p.name,
        description: p.description,
      })),
    };
  }

  const blob = [extra?.detail, extra?.brief, extra?.documentation]
    .filter(Boolean)
    .join('\n');
  const line = firstSignatureLine(n, blob);
  let parsed = line ? parseSignatureParams(line) : [];
  if (!parsed.length && extra?.snippet) parsed = parseSignatureParams(extra.snippet);
  if (!parsed.length) return null;
  return {
    name: n,
    params: parsed,
    description: extra?.documentation || extra?.brief || undefined,
  };
}

function matchCloseParen(src: string, openParen: number): number {
  let depth = 0;
  let inStr: '"' | "'" | null = null;
  for (let k = openParen; k < src.length; k++) {
    const c = src[k]!;
    if (inStr) {
      if (c === '\\') {
        k++;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      continue;
    }
    if (c === '/' && src[k + 1] === '/') {
      const nl = src.indexOf('\n', k);
      if (nl < 0) break;
      k = nl;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return k;
    }
  }
  return src.length;
}

/**
 * Find the innermost non-control call containing `pos` and classify its arguments.
 * `if` / `for` / `while` / `switch` / `else` are skipped so
 * `plot(ta.sma(close, 14), |)` is a `plot` site.
 */
export function findCallSite(text: string, pos: number): CallSite | null {
  const src = String(text ?? '');
  if (pos < 0 || pos > src.length) return null;

  type Frame = { name: string; openParen: number; skip: boolean };
  const stack: Frame[] = [];
  let inStr: '"' | "'" | null = null;
  for (let i = 0; i < pos; i++) {
    const c = src[i]!;
    if (inStr) {
      if (c === '\\') {
        i++;
        continue;
      }
      // Pine strings do not span lines — recover from a missing closer.
      if (c === '\n' || c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      if (nl < 0 || nl >= pos) break;
      i = nl;
      continue;
    }
    if (c === '(') {
      const name = identBefore(src, i);
      const head = name.includes('.') ? name.slice(0, name.indexOf('.')) : name;
      const skip = !name || !/^[A-Za-z_]/.test(name) || CONTROL_CALLS.has(name) || CONTROL_CALLS.has(head);
      stack.push({ name, openParen: i, skip });
      continue;
    }
    if (c === ')') {
      stack.pop();
    }
  }

  let frame: Frame | undefined;
  for (let s = stack.length - 1; s >= 0; s--) {
    const f = stack[s]!;
    if (!f.skip && f.name) {
      frame = f;
      break;
    }
  }
  if (!frame) return null;

  const close = matchCloseParen(src, frame.openParen);
  const inner = src.slice(frame.openParen + 1, close);
  const rawParts = splitTopLevelParts(inner, frame.openParen + 1);

  const args: CallArg[] = [];
  const namedUsed = new Set<string>();
  let positionalUsed = 0;
  for (const part of rawParts) {
    const trimmed = part.text.trim();
    const eq = kwEqIndex(trimmed);
    let argName: string | undefined;
    if (eq > 0) {
      const left = trimmed.slice(0, eq).trim();
      if (/^[A-Za-z_][\w]*$/.test(left)) argName = left;
    }
    const arg: CallArg = {
      raw: part.text,
      from: part.from,
      to: part.to,
      name: argName,
    };
    args.push(arg);
    if (arg.name) namedUsed.add(arg.name);
    else if (trimmed.length) positionalUsed += 1;
  }

  let cursorArgIndex = 0;
  for (let a = 0; a < args.length; a++) {
    if (pos >= args[a]!.from) cursorArgIndex = a;
  }
  const cur = args[cursorArgIndex];
  const prefix = cur ? src.slice(cur.from, pos).trim() : '';
  const argFrom = cur ? cur.from : frame.openParen + 1;

  return {
    name: frame.name,
    openParen: frame.openParen,
    cursorArgIndex,
    args,
    namedUsed,
    positionalUsed,
    prefix,
    argFrom,
  };
}

/** Params already supplied (named or consumed as leading positionals). */
export function classifyParams(
  sig: PineCallSig,
  site: CallSite,
): Array<PineParamDef & { used: boolean; current: boolean }> {
  const named = site.namedUsed;
  let budget = site.positionalUsed;
  const typed = site.prefix.match(/^([A-Za-z_][\w]*)/);
  const typedName = typed?.[1];
  const out: Array<PineParamDef & { used: boolean; current: boolean }> = [];
  for (let i = 0; i < sig.params.length; i++) {
    const p = sig.params[i]!;
    let used = named.has(p.name);
    if (!used && !p.rest && budget > 0) {
      used = true;
      budget -= 1;
    }
    const current = typedName
      ? p.name === typedName
      : i === site.cursorArgIndex;
    out.push({ ...p, used, current });
  }
  return out;
}

/** Named-parameter completions (`title=`) for the unused / used lists. */
export function paramCompletions(
  sig: PineCallSig,
  site: CallSite,
): Array<{
  name: string;
  used: boolean;
  current: boolean;
  insert: string;
  description?: string;
}> {
  const rows = classifyParams(sig, site);
  const prefix = site.prefix.replace(/\s+/g, '');
  // After `name=` the value is being typed — not a param-name completion
  if (prefix.includes('=')) return [];
  const needle = prefix.toLowerCase();
  return rows
    .filter((p) => !p.rest)
    .filter((p) => !needle || p.name.toLowerCase().startsWith(needle))
    .map((p) => ({
      name: p.name,
      used: p.used,
      current: p.current,
      insert: `${p.name}=`,
      description: p.description,
    }));
}

/** Markdown hover body for a whole call (params + example). */
export function formatCallHoverMarkdown(sig: PineCallSig): string {
  const parts: string[] = [];
  const sigLine = `${sig.name}(${sig.params
    .map((p) => (p.rest ? '…' : p.optional ? `${p.name}?` : p.name))
    .join(', ')})${sig.returns ? ` → ${sig.returns}` : ''}`;
  parts.push('```pinescript\n' + sigLine + '\n```');
  if (sig.description) parts.push(sig.description);
  if (sig.params.some((p) => !p.rest)) {
    parts.push('---');
    parts.push('**Parameters**');
    for (const p of sig.params) {
      if (p.rest) continue;
      const opt = p.optional ? ' *(optional)*' : '';
      const d = p.description ? ` — ${p.description}` : '';
      const def = p.defaultValue ? ` (default \`${p.defaultValue}\`)` : '';
      parts.push(`- \`${p.name}\`${opt}${d}${def}`);
    }
  }
  if (sig.example) {
    parts.push('---');
    parts.push('**Example**');
    parts.push('```pinescript\n' + sig.example + '\n```');
  }
  return parts.join('\n\n');
}

/** Markdown hover for a single parameter. */
export function formatParamHoverMarkdown(
  sig: PineCallSig,
  param: PineParamDef,
): string {
  const parts: string[] = [];
  parts.push('```pinescript\n' + `${sig.name}(…, ${param.name}, …)` + '\n```');
  const bits = [`Parameter \`${param.name}\` of \`${sig.name}\``];
  if (param.optional) bits.push('optional');
  if (param.defaultValue) bits.push(`default \`${param.defaultValue}\``);
  parts.push(bits.join(' · '));
  if (param.description) parts.push(param.description);
  if (sig.example) {
    parts.push('---');
    parts.push('**Example**');
    parts.push('```pinescript\n' + sig.example + '\n```');
  }
  return parts.join('\n\n');
}
