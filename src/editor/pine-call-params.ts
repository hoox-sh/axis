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

import { type QuoteChar, isQuoteChar, isQuoteClose } from './pine-scan-util';

export interface PineParamDef {
  name: string;
  /** Pine type qualifier + type, e.g. `series float`, `const string`. */
  type?: string;
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
      { name: 'series', type: 'series float', description: 'Series of values to display' },
      { name: 'title', type: 'const string', optional: true, description: 'Plot title in the scale / data window' },
      { name: 'color', type: 'series color', optional: true, description: 'Plot color (`color.red`, `color.new`, hex)' },
      { name: 'linewidth', type: 'input int', optional: true, description: 'Line width in pixels' },
      { name: 'style', type: 'input string', optional: true, description: '`plot.style_line`, `plot.style_histogram`, …' },
      { name: 'trackprice', type: 'input bool', optional: true, description: 'Draw a price line for the last value' },
      { name: 'histbase', type: 'input int/float', optional: true, description: 'Histogram baseline' },
      { name: 'offset', type: 'simple int', optional: true, description: 'Bar offset (negative = left)' },
      { name: 'join', type: 'input bool', optional: true, description: 'Connect histogram / columns' },
      { name: 'editable', type: 'const bool', optional: true, description: 'Show in Style settings' },
      { name: 'show_last', type: 'input int', optional: true, description: 'Only draw the last N bars' },
      { name: 'display', type: 'input string', optional: true, description: '`display.all` / `display.none`' },
      { name: 'format', type: 'const string', optional: true, description: '`format.price` / `format.percent`' },
      { name: 'precision', type: 'const int', optional: true, description: 'Decimal places' },
      { name: 'force_overlay', type: 'const bool', optional: true, description: 'Force onto the price pane' },
      { name: 'linestyle', type: 'input string', optional: true, description: '`plot.linestyle_solid` / dashed / dotted' },
    ],
    returns: 'plot',
    description: 'Plot a series on the chart.',
    example: 'plot(close, "Close", color.teal, linewidth=2)',
  },
  plotshape: {
    name: 'plotshape',
    params: [
      { name: 'series', type: 'series int/bool', description: 'True / nonzero / non-na to draw a shape' },
      { name: 'title', type: 'const string', optional: true, description: 'Shape title' },
      { name: 'style', type: 'input string', optional: true, description: '`shape.triangleup`, `shape.circle`, …' },
      { name: 'location', type: 'input string', optional: true, description: '`location.abovebar` / `location.belowbar`' },
      { name: 'color', type: 'series color', optional: true, description: 'Shape color' },
      { name: 'offset', type: 'simple int', optional: true, description: 'Bar offset' },
      { name: 'text', type: 'const string', optional: true, description: 'Optional label text' },
      { name: 'textcolor', type: 'series color', optional: true, description: 'Text color' },
      { name: 'editable', type: 'const bool', optional: true },
      { name: 'size', type: 'const string', optional: true, description: '`size.tiny` … `size.huge`' },
      { name: 'show_last', type: 'input int', optional: true },
      { name: 'display', type: 'input string', optional: true },
      { name: 'format', type: 'const string', optional: true, description: '`format.price` / `format.percent`' },
      { name: 'precision', type: 'const int', optional: true, description: 'Decimal places' },
      { name: 'force_overlay', type: 'const bool', optional: true, description: 'Force onto the price pane' },
    ],
    example: 'plotshape(ta.crossover(fast, slow), style=shape.triangleup, location=location.belowbar)',
  },
  plotchar: {
    name: 'plotchar',
    params: [
      { name: 'series', type: 'series int/bool', description: 'True / nonzero / non-na to draw the character' },
      { name: 'title', type: 'const string', optional: true },
      { name: 'char', type: 'const string', optional: true, description: 'Single character, e.g. `"▲"`' },
      { name: 'location', type: 'input string', optional: true },
      { name: 'color', type: 'series color', optional: true },
      { name: 'offset', type: 'simple int', optional: true },
      { name: 'text', type: 'const string', optional: true },
      { name: 'textcolor', type: 'series color', optional: true },
      { name: 'editable', type: 'const bool', optional: true },
      { name: 'size', type: 'const string', optional: true },
      { name: 'show_last', type: 'input int', optional: true },
      { name: 'display', type: 'input string', optional: true },
      { name: 'format', type: 'const string', optional: true, description: '`format.price` / `format.percent`' },
      { name: 'precision', type: 'const int', optional: true, description: 'Decimal places' },
      { name: 'force_overlay', type: 'const bool', optional: true, description: 'Force onto the price pane' },
    ],
    example: 'plotchar(longCond, char="▲", location=location.belowbar, color=color.lime)',
  },
  hline: {
    name: 'hline',
    params: [
      { name: 'price', type: 'input int/float', description: 'Horizontal price / level' },
      { name: 'title', type: 'const string', optional: true },
      { name: 'color', type: 'input color', optional: true },
      { name: 'linestyle', type: 'input string', optional: true, description: '`hline.style_dashed` / `hline.style_dotted`' },
      { name: 'linewidth', type: 'input int', optional: true },
      { name: 'editable', type: 'const bool', optional: true },
      { name: 'display', type: 'input string', optional: true },
    ],
    example: 'hline(70, "Overbought", color.red, linestyle=hline.style_dashed)',
  },
  bgcolor: {
    name: 'bgcolor',
    params: [
      { name: 'color', type: 'series color', description: 'Background color (`na` = none)' },
      { name: 'offset', type: 'simple int', optional: true },
      { name: 'editable', type: 'const bool', optional: true },
      { name: 'show_last', type: 'input int', optional: true },
      { name: 'title', type: 'const string', optional: true },
      { name: 'display', type: 'input string', optional: true },
    ],
    example: 'bgcolor(close > open ? color.new(color.teal, 85) : na)',
  },
  indicator: {
    name: 'indicator',
    params: [
      { name: 'title', type: 'const string', description: 'Script name in the chart legend' },
      { name: 'shorttitle', type: 'const string', optional: true, description: 'Compact name on the pane' },
      { name: 'overlay', type: 'const bool', optional: true, description: '`true` = price pane, `false` = own pane' },
      { name: 'format', type: 'const string', optional: true, description: '`format.price` / `format.percent` / `format.volume`' },
      { name: 'precision', type: 'const int', optional: true, description: 'Decimal places on the scale' },
      { name: 'scale', type: 'const string', optional: true, description: '`scale.right` / `scale.left` / `scale.none`' },
      { name: 'max_bars_back', type: 'const int', optional: true, description: 'History buffer depth' },
      { name: 'timeframe', type: 'const string', optional: true, description: 'MTF: `"60"`, `"D"`, `timeframe.period`' },
      { name: 'timeframe_gaps', type: 'const bool', optional: true, description: 'Leave gaps when MTF bars do not align' },
      { name: 'explicit_plot_zorder', type: 'const bool', optional: true, description: 'Honour plot() call order for z-index' },
      { name: 'max_lines_count', type: 'const int', optional: true },
      { name: 'max_labels_count', type: 'const int', optional: true },
      { name: 'max_boxes_count', type: 'const int', optional: true },
      { name: 'calc_bars_count', type: 'const int', optional: true, description: 'Limit calculated bars' },
      { name: 'max_polylines_count', type: 'const int', optional: true },
      { name: 'dynamic_requests', type: 'const bool', optional: true, description: 'Allow series `request.*` (v6)' },
      { name: 'behind_chart', type: 'const bool', optional: true, description: 'Draw behind candles (v6)' },
    ],
    description: 'Declare an indicator script.',
    example: 'indicator("RSI", shorttitle="RSI", overlay=false)',
  },
  strategy: {
    name: 'strategy',
    params: [
      { name: 'title', type: 'const string', description: 'Script name in the chart legend' },
      { name: 'shorttitle', type: 'const string', optional: true, description: 'Compact name on the pane' },
      { name: 'overlay', type: 'const bool', optional: true, description: '`true` = price pane, `false` = own pane' },
      { name: 'format', type: 'const string', optional: true, description: '`format.price` / `format.percent` / `format.volume`' },
      { name: 'precision', type: 'const int', optional: true, description: 'Decimal places on the scale' },
      { name: 'scale', type: 'const string', optional: true, description: '`scale.right` / `scale.left` / `scale.none`' },
      { name: 'pyramiding', type: 'const int', optional: true, description: 'Max entries in the same direction' },
      { name: 'calc_on_order_fills', type: 'const bool', optional: true, description: 'Recalculate after intra-bar fills' },
      { name: 'calc_on_every_tick', type: 'const bool', optional: true, description: 'Recalculate on every realtime tick' },
      { name: 'max_bars_back', type: 'const int', optional: true, description: 'History buffer depth' },
      { name: 'backtest_fill_limits_assumption', type: 'const int', optional: true },
      { name: 'default_qty_type', type: 'const string', optional: true, description: '`strategy.fixed` / `strategy.cash` / `strategy.percent_of_equity`' },
      { name: 'default_qty_value', type: 'const int/float', optional: true, description: 'Default order size' },
      { name: 'initial_capital', type: 'const int/float', optional: true },
      { name: 'currency', type: 'const string', optional: true, description: '`currency.USD`, …' },
      { name: 'slippage', type: 'const int', optional: true, description: 'Slippage in ticks' },
      { name: 'commission_type', type: 'const string', optional: true, description: '`strategy.commission.percent`, …' },
      { name: 'commission_value', type: 'const int/float', optional: true },
      { name: 'process_orders_on_close', type: 'const bool', optional: true },
      { name: 'close_entries_rule', type: 'const string', optional: true, description: '`"FIFO"` / `"ANY"`' },
      { name: 'margin_long', type: 'const int/float', optional: true },
      { name: 'margin_short', type: 'const int/float', optional: true },
      { name: 'explicit_plot_zorder', type: 'const bool', optional: true },
      { name: 'max_lines_count', type: 'const int', optional: true },
      { name: 'max_labels_count', type: 'const int', optional: true },
      { name: 'max_boxes_count', type: 'const int', optional: true },
      { name: 'calc_bars_count', type: 'const int', optional: true },
      { name: 'risk_free_rate', type: 'const int/float', optional: true },
      { name: 'use_bar_magnifier', type: 'const bool', optional: true },
      { name: 'fill_orders_on_standard_ohlc', type: 'const bool', optional: true },
      { name: 'max_polylines_count', type: 'const int', optional: true },
      { name: 'dynamic_requests', type: 'const bool', optional: true, description: 'Allow series `request.*` (v6)' },
      { name: 'behind_chart', type: 'const bool', optional: true, description: 'Draw behind candles (v6)' },
      { name: 'linktoseries', type: 'const bool', optional: true, description: 'AXIS extension — link strategy fills to the active source series (pyne accepts declaration kwargs)' },
    ],
    description: 'Declare a strategy script.',
    example: 'strategy("MA Cross", overlay=true, initial_capital=10000, default_qty_type=strategy.percent_of_equity)',
  },
  library: {
    name: 'library',
    params: [
      { name: 'title', type: 'const string', description: 'Library name' },
      { name: 'overlay', type: 'const bool', optional: true, description: '`true` = price pane when used as overlay' },
      { name: 'dynamic_requests', type: 'const bool', optional: true, description: 'Allow series `request.*` (v6)' },
    ],
    description: 'Declare a library script.',
    example: 'library("MyLib", overlay=true)',
  },
  input: {
    name: 'input',
    params: [
      { name: 'defval', description: 'Default value (type is inferred)' },
      { name: 'title', type: 'const string', optional: true, description: 'Settings label' },
      { name: 'tooltip', type: 'const string', optional: true, description: 'Hover help (`\\n` for line breaks)' },
      { name: 'inline', type: 'const string', optional: true, description: 'Same string = same Settings row' },
      { name: 'group', type: 'const string', optional: true, description: 'Settings section heading' },
      { name: 'confirm', type: 'const bool', optional: true, description: 'Prompt on the chart when added' },
      { name: 'active', type: 'input bool', optional: true, description: '`true` / `false` or another input ident' },
    ],
    returns: 'value',
    description: 'Generic script input (type follows `defval`).',
    example: 'len = input(14, "Length", group="Inputs")',
  },
  'input.int': {
    name: 'input.int',
    params: [
      { name: 'defval', type: 'const int', description: 'Default integer' },
      { name: 'title', type: 'const string', optional: true, description: 'Settings label' },
      { name: 'minval', type: 'const int', optional: true, description: 'Minimum allowed value' },
      { name: 'maxval', type: 'const int', optional: true, description: 'Maximum allowed value' },
      { name: 'step', type: 'const int', optional: true, description: 'Spinner step' },
      { name: 'tooltip', type: 'const string', optional: true, description: 'Hover help (`\\n` for line breaks)' },
      { name: 'inline', type: 'const string', optional: true, description: 'Same string = same Settings row' },
      { name: 'group', type: 'const string', optional: true, description: 'Settings section heading' },
      { name: 'confirm', type: 'const bool', optional: true },
      { name: 'display', type: 'const string', optional: true, description: '`display.all` / `display.none`' },
      { name: 'active', type: 'input bool', optional: true, description: '`true` / `false` or another input ident' },
    ],
    returns: 'input int',
    example: 'len = input.int(14, "Length", minval=1, maxval=200)',
  },
  'input.float': {
    name: 'input.float',
    params: [
      { name: 'defval', type: 'const int/float', description: 'Default float' },
      { name: 'title', type: 'const string', optional: true },
      { name: 'minval', type: 'const int/float', optional: true },
      { name: 'maxval', type: 'const int/float', optional: true },
      { name: 'step', type: 'const int/float', optional: true },
      { name: 'tooltip', type: 'const string', optional: true },
      { name: 'inline', type: 'const string', optional: true },
      { name: 'group', type: 'const string', optional: true },
      { name: 'confirm', type: 'const bool', optional: true },
      { name: 'display', type: 'const string', optional: true },
      { name: 'active', type: 'input bool', optional: true },
    ],
    returns: 'input float',
    example: 'mult = input.float(2.0, "StdDev", minval=0.1, step=0.1)',
  },
  'input.bool': {
    name: 'input.bool',
    params: [
      { name: 'defval', type: 'const bool', description: 'Default true/false' },
      { name: 'title', type: 'const string', optional: true },
      { name: 'tooltip', type: 'const string', optional: true },
      { name: 'inline', type: 'const string', optional: true },
      { name: 'group', type: 'const string', optional: true },
      { name: 'confirm', type: 'const bool', optional: true },
      { name: 'display', type: 'const string', optional: true },
      { name: 'active', type: 'input bool', optional: true },
    ],
    returns: 'input bool',
    example: 'showMa = input.bool(true, "Show MA")',
  },
  'input.string': {
    name: 'input.string',
    params: [
      { name: 'defval', type: 'const string', description: 'Default string' },
      { name: 'title', type: 'const string', optional: true },
      { name: 'options', type: 'const string[]', optional: true, description: 'Dropdown list, e.g. `["A","B"]`' },
      { name: 'tooltip', type: 'const string', optional: true },
      { name: 'inline', type: 'const string', optional: true },
      { name: 'group', type: 'const string', optional: true },
      { name: 'confirm', type: 'const bool', optional: true },
      { name: 'display', type: 'const string', optional: true },
      { name: 'active', type: 'input bool', optional: true },
    ],
    returns: 'input string',
    example: 'tf = input.string("1h", "Timeframe", options=["15m","1h","4h"])',
  },
  'input.source': {
    name: 'input.source',
    params: [
      { name: 'defval', type: 'series float', description: '`close`, `hlc3`, …' },
      { name: 'title', type: 'const string', optional: true },
      { name: 'tooltip', type: 'const string', optional: true },
      { name: 'inline', type: 'const string', optional: true },
      { name: 'group', type: 'const string', optional: true },
      { name: 'confirm', type: 'const bool', optional: true },
      { name: 'display', type: 'const string', optional: true },
      { name: 'active', type: 'input bool', optional: true },
    ],
    returns: 'series float',
    example: 'src = input.source(close, "Source")',
  },
  'input.color': {
    name: 'input.color',
    params: [
      { name: 'defval', type: 'const color', description: 'Default color' },
      { name: 'title', type: 'const string', optional: true },
      { name: 'tooltip', type: 'const string', optional: true },
      { name: 'inline', type: 'const string', optional: true },
      { name: 'group', type: 'const string', optional: true },
      { name: 'confirm', type: 'const bool', optional: true },
      { name: 'display', type: 'const string', optional: true },
      { name: 'active', type: 'input bool', optional: true },
    ],
    returns: 'input color',
    example: 'col = input.color(color.teal, "Line")',
  },
  'input.timeframe': {
    name: 'input.timeframe',
    params: [
      { name: 'defval', type: 'const string', description: 'Default timeframe (`""`, `"60"`, `"D"`)' },
      { name: 'title', type: 'const string', optional: true },
      { name: 'options', type: 'const string[]', optional: true, description: 'Dropdown list of timeframes' },
      { name: 'tooltip', type: 'const string', optional: true },
      { name: 'inline', type: 'const string', optional: true },
      { name: 'group', type: 'const string', optional: true },
      { name: 'confirm', type: 'const bool', optional: true },
      { name: 'display', type: 'const string', optional: true },
      { name: 'active', type: 'input bool', optional: true },
    ],
    returns: 'input string',
    description: 'Timeframe input (`""` = chart TF).',
    example: 'tf = input.timeframe("60", "Timeframe")',
  },
  'input.enum': {
    name: 'input.enum',
    params: [
      { name: 'defval', description: 'Default enum member (`Easing.linear`)' },
      { name: 'title', type: 'const string', optional: true },
      { name: 'options', optional: true, description: 'Optional subset of members' },
      { name: 'tooltip', type: 'const string', optional: true },
      { name: 'inline', type: 'const string', optional: true },
      { name: 'group', type: 'const string', optional: true },
      { name: 'confirm', type: 'const bool', optional: true },
      { name: 'display', type: 'const string', optional: true },
      { name: 'active', type: 'input bool', optional: true },
    ],
    example: 'easing = input.enum(Easing.linear, "Easing")',
  },
  'ta.sma': {
    name: 'ta.sma',
    params: [
      { name: 'source', type: 'series float', description: 'Series of values (`close`, a plot, …)' },
      { name: 'length', type: 'simple int', description: 'Lookback period (int ≥ 1)' },
    ],
    returns: 'series float',
    description: 'Simple moving average.',
    example: 'ta.sma(close, 14)',
  },
  'ta.ema': {
    name: 'ta.ema',
    params: [
      { name: 'source', type: 'series float', description: 'Series of values' },
      { name: 'length', type: 'simple int', description: 'Lookback period' },
    ],
    returns: 'series float',
    example: 'ta.ema(close, 21)',
  },
  'ta.rma': {
    name: 'ta.rma',
    params: [
      { name: 'source', type: 'series float', description: 'Series of values' },
      { name: 'length', type: 'simple int', description: 'Lookback period' },
    ],
    returns: 'series float',
    description: 'Rolling / Wilder moving average.',
    example: 'ta.rma(close, 14)',
  },
  'ta.vwma': {
    name: 'ta.vwma',
    params: [
      { name: 'source', type: 'series float', description: 'Series of values' },
      { name: 'length', type: 'simple int', description: 'Lookback period' },
    ],
    returns: 'series float',
    description: 'Volume-weighted moving average.',
    example: 'ta.vwma(close, 20)',
  },
  'ta.rsi': {
    name: 'ta.rsi',
    params: [
      { name: 'source', type: 'series float', description: 'Series of values' },
      { name: 'length', type: 'simple int', description: 'Lookback period' },
    ],
    returns: 'series float',
    example: 'ta.rsi(close, 14)',
  },
  'ta.atr': {
    name: 'ta.atr',
    params: [{ name: 'length', type: 'simple int', description: 'Lookback period' }],
    returns: 'series float',
    example: 'ta.atr(14)',
  },
  'ta.supertrend': {
    name: 'ta.supertrend',
    params: [
      { name: 'factor', type: 'simple int/float', description: 'ATR multiplier' },
      { name: 'atrPeriod', type: 'simple int', description: 'ATR length' },
    ],
    returns: '[supertrend, direction]',
    description: 'Supertrend (`ta.supertrend(factor, atrPeriod)`).',
    example: '[st, dir] = ta.supertrend(3, 10)',
  },
  'ta.crossover': {
    name: 'ta.crossover',
    params: [
      { name: 'source1', type: 'series float', description: 'First series' },
      { name: 'source2', type: 'series float', description: 'Second series' },
    ],
    returns: 'series bool',
    example: 'ta.crossover(fast, slow)',
  },
  'ta.crossunder': {
    name: 'ta.crossunder',
    params: [
      { name: 'source1', type: 'series float', description: 'First series' },
      { name: 'source2', type: 'series float', description: 'Second series' },
    ],
    returns: 'series bool',
    example: 'ta.crossunder(fast, slow)',
  },
  'ta.highest': {
    name: 'ta.highest',
    params: [
      { name: 'source', type: 'series float', description: 'Series (or length if one-arg form)' },
      { name: 'length', type: 'simple int', optional: true, description: 'Lookback period' },
    ],
    example: 'ta.highest(high, 20)',
  },
  'ta.lowest': {
    name: 'ta.lowest',
    params: [
      { name: 'source', type: 'series float', description: 'Series (or length if one-arg form)' },
      { name: 'length', type: 'simple int', optional: true, description: 'Lookback period' },
    ],
    example: 'ta.lowest(low, 20)',
  },
  'ta.macd': {
    name: 'ta.macd',
    params: [
      { name: 'source', type: 'series float', description: 'Series of values' },
      { name: 'fastlen', type: 'simple int', description: 'Fast EMA length' },
      { name: 'slowlen', type: 'simple int', description: 'Slow EMA length' },
      { name: 'siglen', type: 'simple int', description: 'Signal EMA length' },
    ],
    returns: '[macd, signal, hist]',
    example: '[macdLine, signalLine, hist] = ta.macd(close, 12, 26, 9)',
  },
  'color.new': {
    name: 'color.new',
    params: [
      { name: 'color', type: 'series color', description: 'Base color' },
      { name: 'transp', type: 'series int/float', description: 'Transparency 0 (solid) … 100 (invisible)' },
    ],
    returns: 'color',
    example: 'color.new(color.teal, 80)',
  },
  'color.rgb': {
    name: 'color.rgb',
    params: [
      { name: 'red', type: 'series int/float', description: '0–255' },
      { name: 'green', type: 'series int/float', description: '0–255' },
      { name: 'blue', type: 'series int/float', description: '0–255' },
      { name: 'transp', type: 'series int/float', optional: true, description: '0–100' },
    ],
    returns: 'color',
    example: 'color.rgb(147, 159, 255, 20)',
  },
  'color.from_gradient': {
    name: 'color.from_gradient',
    params: [
      { name: 'value', type: 'series int/float', description: 'Value to map onto the gradient' },
      { name: 'bottom_value', type: 'series int/float', description: 'Value that maps to `bottom_color`' },
      { name: 'top_value', type: 'series int/float', description: 'Value that maps to `top_color`' },
      { name: 'bottom_color', type: 'series color', description: 'Color at `bottom_value`' },
      { name: 'top_color', type: 'series color', description: 'Color at `top_value`' },
    ],
    returns: 'series color',
    description: 'Interpolate a color between two endpoints.',
    example: 'color.from_gradient(rsi, 30, 70, color.red, color.lime)',
  },
  'label.new': {
    name: 'label.new',
    params: [
      { name: 'x', type: 'series int', description: 'Bar index or time (`xloc`)' },
      { name: 'y', type: 'series int/float', description: 'Price' },
      { name: 'text', type: 'series string', optional: true },
      { name: 'xloc', type: 'series string', optional: true, description: '`xloc.bar_index` / `xloc.bar_time`' },
      { name: 'yloc', type: 'series string', optional: true, description: '`yloc.price` / `yloc.abovebar`' },
      { name: 'color', type: 'series color', optional: true },
      { name: 'style', type: 'series string', optional: true, description: '`label.style_label_up`, …' },
      { name: 'textcolor', type: 'series color', optional: true },
      { name: 'size', type: 'series string', optional: true },
      { name: 'textalign', type: 'series string', optional: true },
      { name: 'tooltip', type: 'series string', optional: true },
      { name: 'text_font_family', type: 'series string', optional: true, description: '`font.family_default` / `font.family_monospace`' },
      { name: 'force_overlay', type: 'const bool', optional: true },
      { name: 'text_formatting', type: 'const string', optional: true },
    ],
    returns: 'series label',
    example: 'label.new(bar_index, high, "High", style=label.style_label_down)',
  },
  'line.new': {
    name: 'line.new',
    params: [
      { name: 'x1', type: 'series int', description: 'Start bar / time' },
      { name: 'y1', type: 'series int/float', description: 'Start price' },
      { name: 'x2', type: 'series int', description: 'End bar / time' },
      { name: 'y2', type: 'series int/float', description: 'End price' },
      { name: 'xloc', type: 'simple string', optional: true, description: '`xloc.bar_index` / `xloc.bar_time`' },
      { name: 'extend', type: 'series string', optional: true, description: '`extend.none` / `extend.right`' },
      { name: 'color', type: 'series color', optional: true },
      { name: 'style', type: 'series string', optional: true, description: '`line.style_solid` / dashed' },
      { name: 'width', type: 'series int', optional: true },
      { name: 'force_overlay', type: 'const bool', optional: true },
    ],
    returns: 'series line',
    example: 'line.new(bar_index[10], high[10], bar_index, high, extend=extend.right)',
  },
  'box.new': {
    name: 'box.new',
    params: [
      { name: 'left', type: 'series int', description: 'Left bar / time' },
      { name: 'top', type: 'series int/float', description: 'Top price' },
      { name: 'right', type: 'series int', description: 'Right bar / time' },
      { name: 'bottom', type: 'series int/float', description: 'Bottom price' },
      { name: 'border_color', type: 'series color', optional: true },
      { name: 'border_width', type: 'series int', optional: true },
      { name: 'border_style', type: 'series string', optional: true, description: '`line.style_solid` / dashed / dotted' },
      { name: 'extend', type: 'series string', optional: true, description: '`extend.none` / `extend.right`' },
      { name: 'xloc', type: 'series string', optional: true, description: '`xloc.bar_index` / `xloc.bar_time`' },
      { name: 'bgcolor', type: 'series color', optional: true },
      { name: 'text', type: 'series string', optional: true },
      { name: 'text_size', type: 'series string', optional: true },
      { name: 'text_color', type: 'series color', optional: true },
      { name: 'text_halign', type: 'series string', optional: true },
      { name: 'text_valign', type: 'series string', optional: true },
      { name: 'text_wrap', type: 'series string', optional: true },
      { name: 'text_font_family', type: 'series string', optional: true },
      { name: 'force_overlay', type: 'const bool', optional: true },
      { name: 'text_formatting', type: 'const string', optional: true },
    ],
    returns: 'series box',
    description: 'Create a box (`box.new(left, top, right, bottom, …)`).',
    example: 'box.new(bar_index[10], high, bar_index, low, bgcolor=color.new(color.teal, 85))',
  },
  'table.new': {
    name: 'table.new',
    params: [
      { name: 'position', type: 'series string', description: '`position.top_right`, …' },
      { name: 'columns', type: 'series int', description: 'Column count' },
      { name: 'rows', type: 'series int', description: 'Row count' },
      { name: 'bgcolor', type: 'series color', optional: true },
      { name: 'frame_color', type: 'series color', optional: true },
      { name: 'frame_width', type: 'series int', optional: true },
      { name: 'border_color', type: 'series color', optional: true },
      { name: 'border_width', type: 'series int', optional: true },
      { name: 'force_overlay', type: 'const bool', optional: true },
    ],
    returns: 'series table',
    description: 'Create a table (`table.new(position, columns, rows, …)`).',
    example: 'var t = table.new(position.top_right, 2, 2)',
  },
  'table.cell': {
    name: 'table.cell',
    params: [
      { name: 'table_id', type: 'series table', description: 'Table from `table.new`' },
      { name: 'column', type: 'series int', description: '0-based column' },
      { name: 'row', type: 'series int', description: '0-based row' },
      { name: 'text', type: 'series string', optional: true },
      { name: 'width', type: 'series int', optional: true, description: 'Cell width as % of pane' },
      { name: 'height', type: 'series int', optional: true, description: 'Cell height as % of pane' },
      { name: 'text_color', type: 'series color', optional: true },
      { name: 'text_halign', type: 'series string', optional: true },
      { name: 'text_valign', type: 'series string', optional: true },
      { name: 'text_size', type: 'series string', optional: true },
      { name: 'bgcolor', type: 'series color', optional: true },
      { name: 'tooltip', type: 'series string', optional: true },
      { name: 'text_font_family', type: 'series string', optional: true },
      { name: 'text_formatting', type: 'const string', optional: true },
    ],
    description: 'Set a table cell (column then row).',
    example: 'table.cell(t, 0, 0, "RSI", text_color=color.white)',
  },
  'strategy.entry': {
    name: 'strategy.entry',
    params: [
      { name: 'id', type: 'series string', description: 'Order id' },
      { name: 'direction', type: 'series strategy_direction', description: '`strategy.long` / `strategy.short`' },
      { name: 'qty', type: 'series int/float', optional: true },
      { name: 'limit', type: 'series int/float', optional: true },
      { name: 'stop', type: 'series int/float', optional: true },
      { name: 'oca_name', type: 'series string', optional: true },
      { name: 'oca_type', type: 'const string', optional: true, description: '`strategy.oca.cancel` / `strategy.oca.reduce`' },
      { name: 'comment', type: 'series string', optional: true },
      { name: 'alert_message', type: 'series string', optional: true },
      { name: 'disable_alert', type: 'series bool', optional: true },
    ],
    example: 'strategy.entry("Long", strategy.long)',
  },
  'strategy.exit': {
    name: 'strategy.exit',
    params: [
      { name: 'id', type: 'series string', description: 'Exit order id' },
      { name: 'from_entry', type: 'series string', optional: true, description: 'Entry id to exit (all if omitted)' },
      { name: 'qty', type: 'series int/float', optional: true },
      { name: 'qty_percent', type: 'series int/float', optional: true },
      { name: 'profit', type: 'series int/float', optional: true, description: 'Take-profit in ticks' },
      { name: 'limit', type: 'series int/float', optional: true, description: 'Take-profit price' },
      { name: 'loss', type: 'series int/float', optional: true, description: 'Stop-loss in ticks' },
      { name: 'stop', type: 'series int/float', optional: true, description: 'Stop-loss price' },
      { name: 'trail_price', type: 'series int/float', optional: true },
      { name: 'trail_points', type: 'series int/float', optional: true },
      { name: 'trail_offset', type: 'series int/float', optional: true },
      { name: 'oca_name', type: 'series string', optional: true },
      { name: 'comment', type: 'series string', optional: true },
      { name: 'comment_profit', type: 'series string', optional: true },
      { name: 'comment_loss', type: 'series string', optional: true },
      { name: 'comment_trailing', type: 'series string', optional: true },
      { name: 'alert_message', type: 'series string', optional: true },
      { name: 'alert_profit', type: 'series string', optional: true },
      { name: 'alert_loss', type: 'series string', optional: true },
      { name: 'alert_trailing', type: 'series string', optional: true },
      { name: 'disable_alert', type: 'series bool', optional: true },
    ],
    example: 'strategy.exit("XL", from_entry="Long", stop=low, limit=high)',
  },
  'strategy.close': {
    name: 'strategy.close',
    params: [
      { name: 'id', type: 'series string', description: 'Entry id to close' },
      { name: 'comment', type: 'series string', optional: true },
      { name: 'qty', type: 'series int/float', optional: true },
      { name: 'qty_percent', type: 'series int/float', optional: true },
      { name: 'alert_message', type: 'series string', optional: true },
      { name: 'immediately', type: 'series bool', optional: true, description: 'Close on this tick (v5+)' },
      { name: 'disable_alert', type: 'series bool', optional: true },
    ],
    example: 'strategy.close("Long")',
  },
  'strategy.close_all': {
    name: 'strategy.close_all',
    params: [
      { name: 'comment', type: 'series string', optional: true },
      { name: 'alert_message', type: 'series string', optional: true },
      { name: 'immediately', type: 'series bool', optional: true, description: 'Close on this tick (v5+)' },
      { name: 'disable_alert', type: 'series bool', optional: true },
    ],
    example: 'strategy.close_all()',
  },
  'strategy.order': {
    name: 'strategy.order',
    params: [
      { name: 'id', type: 'series string', description: 'Order id' },
      { name: 'direction', type: 'series strategy_direction', description: '`strategy.long` / `strategy.short`' },
      { name: 'qty', type: 'series int/float', optional: true },
      { name: 'limit', type: 'series int/float', optional: true },
      { name: 'stop', type: 'series int/float', optional: true },
      { name: 'oca_name', type: 'series string', optional: true },
      { name: 'oca_type', type: 'const string', optional: true, description: '`strategy.oca.cancel` / `strategy.oca.reduce`' },
      { name: 'comment', type: 'series string', optional: true },
      { name: 'alert_message', type: 'series string', optional: true },
      { name: 'disable_alert', type: 'series bool', optional: true },
    ],
    example: 'strategy.order("L", strategy.long, qty=1)',
  },
  'request.security': {
    name: 'request.security',
    params: [
      { name: 'symbol', type: 'simple string', description: '`syminfo.tickerid` or `"BINANCE:BTCUSDT"`' },
      { name: 'timeframe', type: 'simple string', description: '`"60"`, `"D"`, `timeframe.period`' },
      { name: 'expression', description: 'Value to request (`close`, a tuple, …)' },
      { name: 'gaps', type: 'simple string', optional: true, description: '`barmerge.gaps_off` / `barmerge.gaps_on`' },
      { name: 'lookahead', type: 'simple string', optional: true, description: '`barmerge.lookahead_off` (default)' },
      { name: 'ignore_invalid_symbol', type: 'simple bool', optional: true },
      { name: 'currency', type: 'simple string', optional: true, description: '`currency.USD` or `syminfo.currency`' },
      { name: 'calc_bars_count', type: 'simple int', optional: true },
    ],
    example: 'request.security(syminfo.tickerid, "D", close)',
  },
  'request.security_lower_tf': {
    name: 'request.security_lower_tf',
    params: [
      { name: 'symbol', type: 'simple string', description: '`syminfo.tickerid` or `"BINANCE:BTCUSDT"`' },
      { name: 'timeframe', type: 'simple string', description: 'Lower TF (`"1"`, `"5"`, …)' },
      { name: 'expression', description: 'Value to request (`close`, a tuple, …)' },
      { name: 'ignore_invalid_symbol', type: 'simple bool', optional: true },
      { name: 'currency', type: 'simple string', optional: true },
      { name: 'ignore_invalid_timeframe', type: 'simple bool', optional: true },
      { name: 'calc_bars_count', type: 'simple int', optional: true },
    ],
    returns: 'array',
    description: 'Request lower-timeframe values as an array.',
    example: 'request.security_lower_tf(syminfo.tickerid, "1", close)',
  },
  alert: {
    name: 'alert',
    params: [
      { name: 'message', type: 'series string', description: 'Alert text' },
      { name: 'freq', type: 'input string', optional: true, description: '`alert.freq_once_per_bar` / `alert.freq_all`' },
    ],
    example: 'alert("Cross", alert.freq_once_per_bar)',
  },
  nz: {
    name: 'nz',
    params: [
      { name: 'x', description: 'Value that may be `na`' },
      { name: 'y', optional: true, defaultValue: '0', description: 'Replacement when `x` is `na` (default 0)' },
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
  let inStr: QuoteChar | null = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    const abs = base + i;
    if (inStr) {
      cur += c;
      if (c === '\\') {
        if (i + 1 < inner.length) cur += inner[++i];
        continue;
      }
      if (isQuoteClose(inStr, c)) inStr = null;
      continue;
    }
    if (isQuoteChar(c)) {
      inStr = c as QuoteChar;
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

/** Qualifiers / primitives that may lead a typed Pine param (`series float source`). */
const TYPE_TOKEN =
  /^(series|simple|const|input|literal|int|float|bool|string|color|void|na|array|matrix|map|line|label|box|table|polyline|plot|hline|chart\.point|strategy_direction|int\/float|float\/int)(\<[^>]+\>)?$/i;

function looksLikeTypeToken(w: string): boolean {
  const t = w.trim();
  if (!t) return false;
  if (TYPE_TOKEN.test(t)) return true;
  return /[\/<>]/.test(t) && /^[\w./<>]+$/.test(t);
}

function looksLikeTypeString(s: string): boolean {
  const bits = s.trim().split(/\s+/).filter(Boolean);
  if (!bits.length || bits.length > 5) return false;
  return bits.every(looksLikeTypeToken);
}

/** `['series','float','source']` → `series float`; bare `source` → undefined. */
function typeFromLeadingBits(bits: string[]): string | undefined {
  if (bits.length < 2) return undefined;
  const leading = bits.slice(0, -1);
  if (!leading.every(looksLikeTypeToken)) return undefined;
  return leading.join(' ');
}

function parseReturns(line: string): string | undefined {
  const m = String(line || '').match(/(?:→|->)\s*(.+?)\s*$/);
  const t = m?.[1]?.trim();
  return t || undefined;
}

/** Attach `name (series float)` / `name: series float` types from a doc blob. */
function enrichParamsFromDocs(params: PineParamDef[], blob: string): PineParamDef[] {
  const src = String(blob || '');
  if (!src.trim() || !params.length) return params;
  return params.map((p) => {
    if (p.rest || p.type) return p;
    const escaped = p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const paren = new RegExp(`(?:^|[\\n\\r]|\\b)${escaped}\\s*\\(([^)\\n]{1,80})\\)`);
    const m = src.match(paren);
    if (m) {
      const inner = m[1]!.trim();
      if (looksLikeTypeString(inner)) return { ...p, type: inner };
    }
    const colon = new RegExp(`(?:^|[\\n\\r])\\s*${escaped}\\s*:\\s*([^\\n]+)`);
    const c = src.match(colon);
    if (c) {
      const raw = c[1]!.trim().split(/\s+[—–-]\s+/)[0]!.trim();
      const t = raw.replace(/[.,;]+$/, '').trim();
      if (looksLikeTypeString(t)) return { ...p, type: t };
    }
    return p;
  });
}

function formatParamMeta(p: PineParamDef): string | undefined {
  const bits: string[] = [];
  if (p.type) bits.push(p.type);
  if (p.defaultValue) bits.push(`default ${p.defaultValue}`);
  else if (p.optional) bits.push('optional');
  if (p.description) bits.push(p.description);
  return bits.length ? bits.join(' · ') : undefined;
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
    let inStr: QuoteChar | null = null;
    let close = -1;
    for (let i = open; i < s.length; i++) {
      const c = s[i]!;
      if (inStr) {
        if (c === '\\') {
          i++;
          continue;
        }
        if (isQuoteClose(inStr, c)) inStr = null;
        continue;
      }
      if (isQuoteChar(c)) {
        inStr = c as QuoteChar;
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
    const type = typeFromLeadingBits(bits);
    params.push({
      name,
      optional: defaultValue != null || optionalMark,
      defaultValue,
      ...(type ? { type } : {}),
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
        let close = from;
        let depth = 0;
        let inStr: QuoteChar | null = null;
        for (let i = from; i < src.length; i++) {
          const c = src[i]!;
          if (inStr) {
            if (c === '\\') {
              i++;
              continue;
            }
            if (isQuoteClose(inStr, c)) inStr = null;
            continue;
          }
          if (isQuoteChar(c)) {
            inStr = c as QuoteChar;
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
        let end = close + 1;
        const after = src.slice(end);
        const ret = after.match(/^\s*(?:→|->)\s*[^\n]+/);
        if (ret) end += ret[0].length;
        return src
          .slice(m.index, end)
          .replace(/^[`\s]+|[`\s]+$/g, '')
          .replace(/^Signature:\s*/i, '')
          .replace(/\s+/g, ' ');
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
  parsed = enrichParamsFromDocs(parsed, blob);
  return {
    name: n,
    params: parsed,
    returns: parseReturns(line || ''),
    description: extra?.documentation || extra?.brief || undefined,
  };
}

function matchCloseParen(src: string, openParen: number): number {
  let depth = 0;
  let inStr: QuoteChar | null = null;
  for (let k = openParen; k < src.length; k++) {
    const c = src[k]!;
    if (inStr) {
      if (c === '\\') {
        k++;
        continue;
      }
      if (isQuoteClose(inStr, c)) inStr = null;
      continue;
    }
    if (isQuoteChar(c)) {
      inStr = c as QuoteChar;
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
  let inStr: QuoteChar | null = null;
  for (let i = 0; i < pos; i++) {
    const c = src[i]!;
    if (inStr) {
      if (c === '\\') {
        i++;
        continue;
      }
      // Pine strings do not span lines — recover from a missing closer.
      if (c === '\n' || isQuoteClose(inStr, c)) inStr = null;
      continue;
    }
    if (isQuoteChar(c)) {
      inStr = c as QuoteChar;
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

/**
 * Every non-control call in `source` (nested calls included).
 * Used by pre-eval to lint named arguments (`coltor=` → `color=`).
 */
export function scanAllCallSites(source: string): CallSite[] {
  const src = String(source ?? '');
  const out: CallSite[] = [];
  let inStr: QuoteChar | null = null;
  let inBlock = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    const n = src[i + 1];
    if (inStr) {
      if (c === '\\') {
        i += 1;
        continue;
      }
      if (c === '\n' || isQuoteClose(inStr, c)) inStr = null;
      continue;
    }
    if (inBlock) {
      if (c === '*' && n === '/') {
        inBlock = false;
        i += 1;
      }
      continue;
    }
    if (isQuoteChar(c)) {
      inStr = c as QuoteChar;
      continue;
    }
    if (c === '/' && n === '/') {
      const nl = src.indexOf('\n', i);
      if (nl < 0) break;
      i = nl;
      continue;
    }
    if (c === '/' && n === '*') {
      inBlock = true;
      i += 1;
      continue;
    }
    if (c !== '(') continue;
    const name = identBefore(src, i);
    if (!name || !/^[A-Za-z_]/.test(name)) continue;
    const head = name.includes('.') ? name.slice(0, name.indexOf('.')) : name;
    if (CONTROL_CALLS.has(name) || CONTROL_CALLS.has(head)) continue;
    const site = findCallSite(src, i + 1);
    if (site && site.openParen === i) out.push(site);
  }
  return out;
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
  const typedNameMatches = !!typedName && sig.params.some((p) => p.name === typedName);
  const out: Array<PineParamDef & { used: boolean; current: boolean }> = [];
  for (let i = 0; i < sig.params.length; i++) {
    const p = sig.params[i]!;
    let used = named.has(p.name);
    if (!used && !p.rest && budget > 0) {
      used = true;
      budget -= 1;
    }
    const current = typedNameMatches
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
      description: formatParamMeta(p),
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
      const type = p.type ? ` (\`${p.type}\`)` : '';
      const opt = p.optional ? ' *(optional)*' : '';
      const d = p.description ? ` — ${p.description}` : '';
      const def = p.defaultValue ? ` (default \`${p.defaultValue}\`)` : '';
      parts.push(`- \`${p.name}\`${type}${opt}${d}${def}`);
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
  if (param.type) bits.push(`\`${param.type}\``);
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
