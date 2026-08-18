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
 * Strategy Properties — parse / override `strategy()` declaration kwargs for
 * the Script Settings modal (Properties tab).
 *
 * PYNE applies declaration kwargs at run time (`initial_capital`, `pyramiding`,
 * `default_qty_*`, `commission_*`, `leverage`, `margin_*`, …). Engines do not
 * expose a separate properties bag on `/run`, so overrides are merged into a
 * transformed copy of the source via {@link applyStrategyPropsToSource}
 * (user buffer is not rewritten unless the host chooses to).
 *
 * @module results/strategy-props
 */

export type StrategyPropType = 'int' | 'float' | 'bool' | 'string' | 'enum';

export interface StrategyPropDef {
  /** Pine kwarg name (`initial_capital`, …) */
  id: string;
  title: string;
  type: StrategyPropType;
  /** Platform default when absent from `strategy()` */
  default: unknown;
  /** Current value (after merge of declaration + overrides) */
  value?: unknown;
  min?: number | null;
  max?: number | null;
  step?: number | null;
  options?: string[];
  group?: string;
  tooltip?: string;
}

/** Qty type options (Pine `strategy.*` constants). */
export const QTY_TYPE_OPTIONS = [
  'strategy.fixed',
  'strategy.percent_of_equity',
  'strategy.cash',
] as const;

/** Commission type options. */
export const COMMISSION_TYPE_OPTIONS = [
  'strategy.commission.percent',
  'strategy.commission.cash_per_order',
  'strategy.commission.cash_per_contract',
] as const;

/**
 * Editable strategy() properties (subset of Pine declaration + pyne leverage).
 * Order is UI order; groups mirror a Properties panel layout.
 */
export const STRATEGY_PROP_CATALOG: readonly Omit<StrategyPropDef, 'value'>[] = [
  {
    id: 'initial_capital',
    title: 'Initial capital',
    type: 'float',
    default: 100_000,
    min: 0,
    step: 1000,
    group: 'Capital',
    tooltip: 'Starting equity for the strategy broker (strategy.initial_capital).',
  },
  {
    id: 'currency',
    title: 'Currency',
    type: 'string',
    default: 'USD',
    group: 'Capital',
    tooltip: 'Account currency label (strategy(..., currency=…)).',
  },
  {
    id: 'default_qty_type',
    title: 'Order size type',
    type: 'enum',
    default: 'strategy.fixed',
    options: [...QTY_TYPE_OPTIONS],
    group: 'Order size',
    tooltip: 'How default order size is measured (fixed / % of equity / cash).',
  },
  {
    id: 'default_qty_value',
    title: 'Order size value',
    type: 'float',
    default: 1,
    min: 0,
    step: 0.1,
    group: 'Order size',
    tooltip: 'Quantity, percent, or cash amount depending on order size type.',
  },
  {
    id: 'pyramiding',
    title: 'Pyramiding',
    type: 'int',
    default: 0,
    min: 0,
    max: 100,
    step: 1,
    group: 'Order size',
    tooltip: 'Max additional entries in the same direction (0 = single entry).',
  },
  {
    id: 'commission_type',
    title: 'Commission type',
    type: 'enum',
    default: 'strategy.commission.percent',
    options: [...COMMISSION_TYPE_OPTIONS],
    group: 'Commission',
    tooltip: 'Percent of trade value, cash per order, or cash per contract.',
  },
  {
    id: 'commission_value',
    title: 'Commission value',
    type: 'float',
    default: 0,
    min: 0,
    step: 0.01,
    group: 'Commission',
    tooltip: 'Commission amount in the units of commission type.',
  },
  {
    id: 'slippage',
    title: 'Slippage (ticks)',
    type: 'int',
    default: 0,
    min: 0,
    step: 1,
    group: 'Commission',
    tooltip: 'Simulated fill slippage in ticks.',
  },
  {
    id: 'leverage',
    title: 'Leverage',
    type: 'float',
    default: 1,
    min: 1,
    step: 0.5,
    group: 'Margin',
    tooltip:
      'Buying-power multiplier (pyne extension). Prefer over margin % when set.',
  },
  {
    id: 'margin_long',
    title: 'Margin long (%)',
    type: 'float',
    default: 100,
    min: 0.01,
    max: 100,
    step: 1,
    group: 'Margin',
    tooltip: 'Margin % of position for longs (100 = no leverage).',
  },
  {
    id: 'margin_short',
    title: 'Margin short (%)',
    type: 'float',
    default: 100,
    min: 0.01,
    max: 100,
    step: 1,
    group: 'Margin',
    tooltip: 'Margin % of position for shorts (100 = no leverage).',
  },
  {
    id: 'process_orders_on_close',
    title: 'Process orders on close',
    type: 'bool',
    default: false,
    group: 'Execution',
    tooltip:
      'TV: fill at the generating bar’s close. PYNE already fills on the visit bar (close). This flag is stored but not a separate broker mode.',
  },
  {
    id: 'calc_on_order_fills',
    title: 'Calc on order fills',
    type: 'bool',
    default: false,
    group: 'Execution',
    tooltip:
      'TV: re-run after an intra-bar fill. Not implemented in PYNE — changing this does not change fills.',
  },
  {
    id: 'calc_on_every_tick',
    title: 'Calc on every tick',
    type: 'bool',
    default: false,
    group: 'Execution',
    tooltip:
      'TV: re-run on every realtime tick. AXIS live re-runs use Settings → Live (every tick / bar close), not this kwarg.',
  },
] as const;

const CATALOG_IDS = new Set(STRATEGY_PROP_CATALOG.map((d) => d.id));

function findMatchingParen(src: string, openIdx: number): number {
  let depth = 0;
  let inStr: '"' | "'" | null = null;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i]!;
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
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevelArgs(inner: string): string[] {
  const args: string[] = [];
  let cur = '';
  let depth = 0;
  let inStr: '"' | "'" | null = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (inStr) {
      cur += c;
      if (c === '\\') {
        i++;
        if (i < inner.length) cur += inner[i];
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
      args.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) args.push(cur.trim());
  return args;
}

function unquote(s: string): string {
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

function parseLiteral(raw: string): unknown {
  const s = raw.trim();
  if (!s) return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'na' || s === 'None' || s === 'null') return null;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d+\.\d+([eE][+-]?\d+)?$/.test(s)) return Number(s);
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return unquote(s);
  }
  return s;
}

/**
 * Locate first top-level `strategy(...)` declaration.
 * `startIdx` is the index of `s` in `strategy`; `openIdx` is `(`.
 * Does not match `strategy.entry(` / `strategy.close(` (word boundary + `(`).
 */
export function findStrategyCall(source: string): {
  startIdx: number;
  openIdx: number;
  closeIdx: number;
  inner: string;
} | null {
  const src = String(source ?? '');
  // Bare declaration only: strategy(… not strategy.entry(
  const re = /\bstrategy\s*\(/g;
  const m = re.exec(src);
  if (!m) return null;
  const startIdx = m.index;
  const openIdx = m.index + m[0].length - 1;
  const closeIdx = findMatchingParen(src, openIdx);
  if (closeIdx < 0) return null;
  return {
    startIdx,
    openIdx,
    closeIdx,
    inner: src.slice(openIdx + 1, closeIdx),
  };
}

/**
 * Parse named kwargs from the first `strategy(...)` declaration.
 * Positional title/shorttitle/overlay are ignored (not overridable here).
 */
export function parseStrategyDeclaration(
  source: string,
): Record<string, unknown> {
  const call = findStrategyCall(source);
  if (!call) return {};
  const args = splitTopLevelArgs(call.inner);
  const out: Record<string, unknown> = {};
  for (const a of args) {
    const eq = a.indexOf('=');
    if (eq <= 0) continue;
    const key = a.slice(0, eq).trim();
    if (!/^[A-Za-z_]\w*$/.test(key)) continue;
    if (!CATALOG_IDS.has(key)) {
      // Still capture catalog-adjacent known keys for rewrite merge
      if (
        ![
          'title',
          'shorttitle',
          'overlay',
          'format',
          'precision',
          'scale',
          'max_bars_back',
          'max_lines_count',
          'max_labels_count',
          'max_boxes_count',
          'max_polylines_count',
          'explicit_plot_zorder',
          'dynamic_requests',
          'use_bar_magnifier',
          'fill_orders_on_standard_ohlc',
          'close_entries_rule',
          'avg_price_model',
          'risk_free_rate',
          'backtest_fill_limits_assumption',
        ].includes(key)
      ) {
        // keep unknown named kwargs for rewrite preservation
      }
    }
    out[key] = parseLiteral(a.slice(eq + 1).trim());
  }
  return out;
}

/** Normalize qty/commission enum tokens for UI select values. */
export function normalizeStrategyEnum(id: string, value: unknown): unknown {
  if (value == null) return value;
  const s = String(value).trim();
  if (id === 'default_qty_type') {
    const bare = s.replace(/^strategy\./, '').toLowerCase();
    if (bare === 'fixed') return 'strategy.fixed';
    if (bare === 'percent_of_equity' || bare === 'percent' || bare === 'percentage') {
      return 'strategy.percent_of_equity';
    }
    if (bare === 'cash') return 'strategy.cash';
    if (QTY_TYPE_OPTIONS.includes(s as (typeof QTY_TYPE_OPTIONS)[number])) return s;
    return s.startsWith('strategy.') ? s : `strategy.${bare}`;
  }
  if (id === 'commission_type') {
    const bare = s.replace(/^strategy\.commission\./, '').replace(/^strategy\./, '').toLowerCase();
    if (bare === 'percent' || bare === 'commission.percent') {
      return 'strategy.commission.percent';
    }
    if (bare === 'cash_per_order' || bare === 'commission.cash_per_order') {
      return 'strategy.commission.cash_per_order';
    }
    if (bare === 'cash_per_contract' || bare === 'commission.cash_per_contract') {
      return 'strategy.commission.cash_per_contract';
    }
    if (COMMISSION_TYPE_OPTIONS.includes(s as (typeof COMMISSION_TYPE_OPTIONS)[number])) {
      return s;
    }
    return s.startsWith('strategy.') ? s : `strategy.commission.${bare}`;
  }
  return value;
}

/**
 * Build field defs for the Properties tab: catalog defaults ← declaration ← overrides.
 */
export function resolveStrategyProps(
  source: string,
  overrides?: Record<string, unknown> | null,
): StrategyPropDef[] {
  const declared = parseStrategyDeclaration(source);
  return STRATEGY_PROP_CATALOG.map((base) => {
    let defVal = base.default;
    if (declared[base.id] !== undefined && declared[base.id] !== null) {
      defVal =
        base.type === 'enum'
          ? normalizeStrategyEnum(base.id, declared[base.id])
          : declared[base.id];
    }
    let value = defVal;
    if (overrides && overrides[base.id] !== undefined && overrides[base.id] !== null) {
      value =
        base.type === 'enum'
          ? normalizeStrategyEnum(base.id, overrides[base.id])
          : overrides[base.id];
    } else if (base.type === 'enum') {
      value = normalizeStrategyEnum(base.id, value);
    }
    return {
      ...base,
      default: defVal,
      value,
    };
  });
}

/** Relative/absolute slack so 100/3-style floats do not look dirty. */
const PROP_NUM_EPS = 1e-9;

function samePropValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    return (
      Number.isFinite(a) &&
      Number.isFinite(b) &&
      Math.abs(a - b) < PROP_NUM_EPS
    );
  }
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  return false;
}

/** Persist only values that differ from the declaration (or catalog) default. */
export function strategyOverridesFromDefs(
  defs: StrategyPropDef[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of defs) {
    const v = d.value !== undefined ? d.value : d.default;
    if (samePropValue(v, d.default)) continue;
    out[d.id] = v;
  }
  return out;
}

/** Apply stored overrides onto field list (value slot). */
export function applyStrategyOverrides(
  defs: StrategyPropDef[],
  overrides?: Record<string, unknown> | null,
): StrategyPropDef[] {
  if (!overrides || !Object.keys(overrides).length) return defs;
  return defs.map((d) => {
    if (overrides[d.id] === undefined || overrides[d.id] === null) return d;
    const v =
      d.type === 'enum'
        ? normalizeStrategyEnum(d.id, overrides[d.id])
        : overrides[d.id];
    return { ...d, value: v };
  });
}

function formatPineKwarg(id: string, value: unknown): string {
  if (typeof value === 'boolean') return `${id}=${value ? 'true' : 'false'}`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Number.isInteger(value)) return `${id}=${value}`;
    return `${id}=${value}`;
  }
  if (typeof value === 'string') {
    // Enums / dotted constants stay bare identifiers
    if (/^strategy\./.test(value) || /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)+$/.test(value)) {
      return `${id}=${value}`;
    }
    // Simple identifiers (currency=USD) — still quote for safety when non-ident
    if (/^[A-Za-z_]\w*$/.test(value) && id !== 'currency') {
      return `${id}=${value}`;
    }
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `${id}="${escaped}"`;
  }
  if (value == null) return `${id}=na`;
  return `${id}=${JSON.stringify(value)}`;
}

/**
 * Merge catalog overrides into the first `strategy(...)` call.
 * Returns original source when there is no declaration or nothing to apply.
 */
export function applyStrategyPropsToSource(
  source: string,
  overrides?: Record<string, unknown> | null,
): string {
  if (!source?.trim() || !overrides || !Object.keys(overrides).length) {
    return source;
  }
  const call = findStrategyCall(source);
  if (!call) return source;

  const args = splitTopLevelArgs(call.inner);
  const positionals: string[] = [];
  const kwargs = new Map<string, string>();

  for (const a of args) {
    const eq = a.indexOf('=');
    if (eq > 0 && /^[A-Za-z_]\w*\s*$/.test(a.slice(0, eq))) {
      const key = a.slice(0, eq).trim();
      kwargs.set(key, a.slice(eq + 1).trim());
    } else {
      positionals.push(a);
    }
  }

  for (const [key, val] of Object.entries(overrides)) {
    if (!CATALOG_IDS.has(key)) continue;
    if (val === undefined) continue;
    const v: unknown =
      key === 'default_qty_type' || key === 'commission_type'
        ? normalizeStrategyEnum(key, val)
        : val;
    kwargs.set(key, formatPineKwarg(key, v).slice(key.length + 1));
  }

  const parts = [
    ...positionals,
    ...[...kwargs.entries()].map(([k, raw]) => `${k}=${raw}`),
  ];
  const rebuilt = `strategy(${parts.join(', ')})`;
  return source.slice(0, call.startIdx) + rebuilt + source.slice(call.closeIdx + 1);
}

/**
 * True when source is a strategy script with a declaration we can configure.
 */
export function hasStrategyDeclaration(source: string): boolean {
  return findStrategyCall(source) != null;
}
