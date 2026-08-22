// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pine enum / style constants shared by pre-eval allowlists and editor
 * completions. Covers values used after named args (`style=`, `shape=`,
 * `location=`, `size=`, `color=`, …) across **all** Pine call sites — not only
 * `plot()`.
 *
 * Paths mirror pyne runtime / language reference (`plot.style_*`, `shape.*`, …).
 *
 * @module editor/pine-enums
 */

/** One catalog entry for completion + hover. */
export type PineEnumMeta = {
  path: string;
  detail: string;
  brief: string;
};

/**
 * Full set of runtime enum/style paths (missing or incomplete in
 * pyne-builtins.json). Used by pre-eval {@link EXTRA_KNOWN_BUILTIN_PATHS}
 * and completion injection.
 */
export const PINE_ENUM_PATHS: readonly string[] = [
  // ── strategy qty / direction / OCA / commission ──────────────────────────
  'strategy.fixed',
  'strategy.percent_of_equity',
  'strategy.cash',
  'strategy.long',
  'strategy.short',
  'strategy.direction.long',
  'strategy.direction.short',
  'strategy.direction.all',
  'strategy.oca.none',
  'strategy.oca.cancel',
  'strategy.oca.reduce',
  'strategy.commission.percent',
  'strategy.commission.cash_per_order',
  'strategy.commission.cash_per_contract',

  // ── plot.style_* ─────────────────────────────────────────────────────────
  'plot.style_line',
  'plot.style_linebr',
  'plot.style_stepline',
  'plot.style_steplinebr',
  'plot.style_stepline_diamond',
  'plot.style_histogram',
  'plot.style_columns',
  'plot.style_cross',
  'plot.style_area',
  'plot.style_areabr',
  'plot.style_circles',

  // ── hline.style_* ────────────────────────────────────────────────────────
  'hline.style_solid',
  'hline.style_dashed',
  'hline.style_dotted',

  // ── line.style_* ─────────────────────────────────────────────────────────
  'line.style_solid',
  'line.style_dashed',
  'line.style_dotted',
  'line.style_arrow_left',
  'line.style_arrow_right',
  'line.style_arrow_both',

  // ── label.style_* ────────────────────────────────────────────────────────
  'label.style_none',
  'label.style_xcross',
  'label.style_cross',
  'label.style_triangleup',
  'label.style_triangledown',
  'label.style_flag',
  'label.style_circle',
  'label.style_arrowup',
  'label.style_arrowdown',
  'label.style_label_up',
  'label.style_label_down',
  'label.style_label_left',
  'label.style_label_right',
  'label.style_label_lower_left',
  'label.style_label_lower_right',
  'label.style_label_upper_left',
  'label.style_label_upper_right',
  'label.style_label_center',
  'label.style_square',
  'label.style_diamond',
  'label.style_text_outline',

  // ── plotshape / plotchar ─────────────────────────────────────────────────
  'shape.arrowup',
  'shape.arrowdown',
  'shape.circle',
  'shape.cross',
  'shape.diamond',
  'shape.flag',
  'shape.labelup',
  'shape.labeldown',
  'shape.square',
  'shape.triangledown',
  'shape.triangleup',
  'shape.xcross',
  'location.abovebar',
  'location.belowbar',
  'location.top',
  'location.bottom',
  'location.absolute',
  'size.auto',
  'size.tiny',
  'size.small',
  'size.normal',
  'size.large',
  'size.huge',

  // ── drawings / table ─────────────────────────────────────────────────────
  'xloc.bar_index',
  'xloc.bar_time',
  'yloc.price',
  'yloc.abovebar',
  'yloc.belowbar',
  'extend.none',
  'extend.left',
  'extend.right',
  'extend.both',
  'display.none',
  'display.all',
  'display.pane',
  'display.data_window',
  'display.price_scale',
  'display.status_line',
  'position.top_left',
  'position.top_center',
  'position.top_right',
  'position.middle_left',
  'position.middle_center',
  'position.middle_right',
  'position.bottom_left',
  'position.bottom_center',
  'position.bottom_right',

  // ── format / order / text / alert / math ─────────────────────────────────
  'format.mintick',
  'format.percent',
  'format.volume',
  'format.price',
  'order.ascending',
  'order.descending',
  'text.formatting.none',
  'text.formatting.bold',
  'text.formatting.italic',
  'text.formatting.bold_italic',
  'text.align_left',
  'text.align_center',
  'text.align_right',
  'text.align_top',
  'text.align_bottom',
  'text.wrap_none',
  'text.wrap_auto',
  'text.format_none',
  'text.format_bold',
  'text.format_italic',
  'alert.freq_once_per_bar',
  'alert.freq_once_per_bar_close',
  'alert.freq_all',
  'math.pi',
  'math.e',
  'math.phi',
  'math.rphi',

  // ── barstate / session / scale ───────────────────────────────────────────
  'barstate.islast',
  'barstate.isfirst',
  'barstate.ishistory',
  'barstate.isrealtime',
  'barstate.isnew',
  'barstate.isconfirmed',
  'barstate.islastconfirmedhistory',
  'session.regular',
  'session.extended',
  'scale.right',
  'scale.left',
  'scale.none',
];

/**
 * Built-in series variables and type qualifiers the pyne LSP metadata omits
 * (its catalog only lists functions/namespaces). Kept here so pre-eval typo
 * checks and completions treat them as known identifiers.
 */
export const PINE_BUILTIN_VARS: readonly string[] = [
  // OHLCV + derived
  'open',
  'high',
  'low',
  'close',
  'volume',
  'hl2',
  'hlc3',
  'ohlc4',
  'hlcc4',
  // time / bar state
  'time',
  'time_close',
  'time_tradingday',
  'bar_index',
  'last_bar_index',
  'last_bar_time',
  // calendar parts
  'year',
  'month',
  'weekofyear',
  'dayofmonth',
  'dayofweek',
  'hour',
  'minute',
  'second',
  // type qualifiers (declaration/param modifiers, never values)
  'simple',
  'series',
  'const',
];

/** Human-readable meta for completion tooltips (path → detail/brief). */
const ENUM_BLURBS: Record<string, { detail: string; brief: string }> = {
  // plot styles
  'plot.style_line': { detail: 'plot style', brief: 'Continuous line' },
  'plot.style_linebr': { detail: 'plot style', brief: 'Line with breaks on na' },
  'plot.style_stepline': { detail: 'plot style', brief: 'Step line' },
  'plot.style_steplinebr': { detail: 'plot style', brief: 'Step line with breaks' },
  'plot.style_stepline_diamond': { detail: 'plot style', brief: 'Step line with diamonds' },
  'plot.style_histogram': { detail: 'plot style', brief: 'Histogram columns' },
  'plot.style_columns': { detail: 'plot style', brief: 'Column histogram' },
  'plot.style_cross': { detail: 'plot style', brief: 'Cross markers' },
  'plot.style_area': { detail: 'plot style', brief: 'Filled area' },
  'plot.style_areabr': { detail: 'plot style', brief: 'Area with breaks on na' },
  'plot.style_circles': { detail: 'plot style', brief: 'Circle markers' },
  'display.pane': { detail: 'display', brief: 'Show on the chart pane' },
  // hline / line / label
  'hline.style_solid': { detail: 'hline style', brief: 'Solid horizontal line' },
  'hline.style_dashed': { detail: 'hline style', brief: 'Dashed horizontal line' },
  'hline.style_dotted': { detail: 'hline style', brief: 'Dotted horizontal line' },
  'line.style_solid': { detail: 'line style', brief: 'Solid drawing line' },
  'line.style_dashed': { detail: 'line style', brief: 'Dashed drawing line' },
  'line.style_dotted': { detail: 'line style', brief: 'Dotted drawing line' },
  'line.style_arrow_left': { detail: 'line style', brief: 'Arrow at start' },
  'line.style_arrow_right': { detail: 'line style', brief: 'Arrow at end' },
  'line.style_arrow_both': { detail: 'line style', brief: 'Arrows both ends' },
};

function defaultBlurb(path: string): { detail: string; brief: string } {
  const known = ENUM_BLURBS[path];
  if (known) return known;
  const ns = path.includes('.') ? path.slice(0, path.indexOf('.')) : path;
  const member = path.includes('.') ? path.slice(path.indexOf('.') + 1) : path;
  return {
    detail: `${ns} enum`,
    brief: member.replace(/_/g, ' '),
  };
}

/** Full meta list for injecting into the completion index. */
export function pineEnumMetas(): PineEnumMeta[] {
  return PINE_ENUM_PATHS.map((path) => {
    const b = defaultBlurb(path);
    return { path, detail: b.detail, brief: b.brief };
  });
}

/**
 * Named-arg → default namespace roots for value completions.
 * `style` is call-sensitive and resolved separately.
 */
export const NAMED_ARG_ENUM_ROOTS: Readonly<Record<string, readonly string[]>> = {
  style: ['plot.style_', 'line.style_', 'hline.style_', 'label.style_'],
  shape: ['shape.'],
  location: ['location.'],
  size: ['size.'],
  xloc: ['xloc.'],
  yloc: ['yloc.'],
  extend: ['extend.'],
  display: ['display.'],
  position: ['position.'],
  format: ['format.'],
  // colors (named color constants under color.*)
  color: ['color.'],
  bgcolor: ['color.'],
  textcolor: ['color.'],
  border_color: ['color.'],
  trackprice: [], // bool — skip
  // strategy / alert
  default_qty_type: ['strategy.fixed', 'strategy.percent_of_equity', 'strategy.cash'],
  default_qty_value: [],
  overlay: [],
  oca_type: ['strategy.oca.'],
  commission_type: ['strategy.commission.'],
  direction: ['strategy.direction.', 'strategy.long', 'strategy.short'],
  qty_type: ['strategy.fixed', 'strategy.percent_of_equity', 'strategy.cash'],
  freq: ['alert.freq_'],
  // text
  text_formatting: ['text.formatting.', 'text.format_'],
  // scale on indicator()
  scale: ['scale.'],
};

/** Named args that should trigger enum completion when `arg=` is typed. */
export const NAMED_ENUM_ARGS = new Set(Object.keys(NAMED_ARG_ENUM_ROOTS));

/**
 * Call identifiers that own a `style=` namespace.
 * Methods like `line.set_style` map via the object prefix.
 */
const STYLE_CALL_NS: Record<string, string> = {
  plot: 'plot',
  plotshape: 'shape',
  plotchar: 'shape',
  plotarrow: 'shape',
  plotcandle: 'plot',
  plotbar: 'plot',
  hline: 'hline',
  line: 'line',
  label: 'label',
  box: 'line', // border often uses line-like styles in scripts
  polyline: 'line',
};

/**
 * Find nearest call / method name before cursor for style resolution.
 * Scans multi-line text (not only the current line).
 */
export function findNearestCallName(textBefore: string): string | null {
  // Prefer object.method / bare call: line.new(, label.set_style(, plot(
  const re =
    /\b((?:plotshape|plotchar|plotarrow|plotcandle|plotbar|plot|hline|line|label|box|polyline|table|strategy|indicator|alertcondition|alert|color)(?:\.\w+)?)\s*\(/g;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(textBefore)) !== null) {
    last = m[1]!;
  }
  return last;
}

/** Map a call like `line.new` / `plot` / `label.set_style` → style namespace. */
export function styleNamespaceForCall(call: string | null): string {
  if (!call) return 'plot';
  const root = call.includes('.') ? call.slice(0, call.indexOf('.')) : call;
  return STYLE_CALL_NS[root] || 'plot';
}

/**
 * Path prefixes to offer for a named arg, given surrounding call context.
 * Returns prefixes like `plot.style_`, `shape.`, or exact paths for strategy qty.
 */
export function enumPrefixesForArg(arg: string, call: string | null): string[] {
  const key = arg.toLowerCase();
  if (key === 'style') {
    const ns = styleNamespaceForCall(call);
    // plotshape / plotchar / plotarrow take shape.* (not plot.style_*)
    if (ns === 'shape') return ['shape.'];
    return [`${ns}.style_`];
  }
  if (key === 'shape') return ['shape.'];
  if (key === 'location') return ['location.'];
  if (key === 'size') return ['size.'];
  if (key === 'xloc') return ['xloc.'];
  if (key === 'yloc') return ['yloc.'];
  if (key === 'extend') return ['extend.'];
  if (key === 'display') return ['display.'];
  if (key === 'position') return ['position.'];
  if (key === 'format') return ['format.'];
  if (key === 'scale') return ['scale.'];
  if (
    key === 'color' ||
    key === 'bgcolor' ||
    key === 'textcolor' ||
    key === 'border_color'
  ) {
    return ['color.'];
  }
  if (key === 'freq') return ['alert.freq_'];
  if (key === 'text_formatting') return ['text.formatting.', 'text.format_'];
  if (key === 'default_qty_type' || key === 'qty_type') {
    return ['strategy.fixed', 'strategy.percent_of_equity', 'strategy.cash'];
  }
  if (key === 'oca_type') return ['strategy.oca.'];
  if (key === 'commission_type') return ['strategy.commission.'];
  if (key === 'direction') {
    // strategy.entry direction=strategy.long | strategy.short
    return ['strategy.long', 'strategy.short', 'strategy.direction.'];
  }
  const roots = NAMED_ARG_ENUM_ROOTS[key];
  return roots ? [...roots] : [];
}

/**
 * Detect named-arg value position: `style=|`, `shape=tri`, `color=color.re`.
 * `textBefore` should be source from start (or a wide window) through the cursor.
 */
export function namedArgEnumContext(textBefore: string): {
  arg: string;
  prefixes: string[];
  prefix: string;
  /** Offset of value start within `textBefore`. */
  fromOffset: number;
  call: string | null;
} | null {
  // Named args: style=, shape=, location=, size=, color=, default_qty_type=, …
  const m = textBefore.match(
    /\b([A-Za-z_][\w]*)\s*=\s*([A-Za-z_][\w.]*)?$/,
  );
  if (!m) return null;
  const arg = m[1]!;
  if (!NAMED_ENUM_ARGS.has(arg.toLowerCase())) return null;
  const valuePrefix = m[2] || '';
  const fromOffset = textBefore.length - valuePrefix.length;
  const call = findNearestCallName(textBefore);
  const prefixes = enumPrefixesForArg(arg, call);
  if (!prefixes.length) return null;
  return {
    arg: arg.toLowerCase(),
    prefixes,
    prefix: valuePrefix,
    fromOffset,
    call,
  };
}

/** True when path matches any of the enum prefixes (prefix or exact path). */
export function pathMatchesEnumPrefixes(path: string, prefixes: string[]): boolean {
  for (const p of prefixes) {
    if (p.endsWith('.') || p.endsWith('_')) {
      if (path.startsWith(p)) return true;
    } else if (path === p || path.startsWith(`${p}.`)) {
      return true;
    }
  }
  return false;
}
