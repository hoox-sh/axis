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
 * Pure Results / Strategy presenters (no DOM). Consume `results.set` payload.
 */

export type ResultsKind = 'results' | 'strategy';
export type ResultsStatus = 'success' | 'error' | 'idle';

export type ResultsRow = {
  key: string;
  label: string;
  value: string;
};

export type ResultsView = {
  kind: ResultsKind;
  title: string;
  status: ResultsStatus;
  statusLabel: string;
  focusLine: string;
  empty: boolean;
  emptyMessage: string;
  /** Primary card rows (run summary or strategy stats). */
  rows: ResultsRow[];
  /** Compact strategy snippet (results panel) or unused. */
  strategyRows: ResultsRow[];
  /** Shown when the strategy panel has no report object. */
  strategyNote: string | null;
  showStrategy: boolean;
};

export const EMPTY_RUN_HINT = 'Run a Pine Script™ (Ctrl+Enter)';
export const NO_STRATEGY_REPORT = 'No strategy report';
export const NO_RUN_FOCUSED = 'No run focused';

const STATUS_LABEL: Record<ResultsStatus, string> = {
  idle: 'Idle',
  success: 'Success',
  error: 'Error',
};

/** Known strategy stats — aliases match PWA StrategyStats + engine JSON. */
export const STRATEGY_FIELDS: ReadonlyArray<{
  id: string;
  label: string;
  aliases: readonly string[];
  format: 'number' | 'percent' | 'count';
}> = [
  { id: 'netprofit', label: 'Net profit', aliases: ['netprofit', 'netProfit', 'net_profit', 'totalPnl', 'total_pnl', 'net'], format: 'number' },
  { id: 'winrate', label: 'Win rate', aliases: ['winrate', 'winRate', 'win_rate'], format: 'percent' },
  { id: 'trades', label: 'Trades', aliases: ['trades', 'tradeCount', 'nTrades'], format: 'count' },
  { id: 'wins', label: 'Wins', aliases: ['wins'], format: 'count' },
  { id: 'losses', label: 'Losses', aliases: ['losses'], format: 'count' },
  { id: 'profitfactor', label: 'Profit factor', aliases: ['profitFactor', 'profit_factor', 'profitfactor'], format: 'number' },
  { id: 'avgtrade', label: 'Avg trade', aliases: ['avgTrade', 'avg_trade'], format: 'number' },
  { id: 'avgwin', label: 'Avg win', aliases: ['avgWin', 'avg_win'], format: 'number' },
  { id: 'avgloss', label: 'Avg loss', aliases: ['avgLoss', 'avg_loss'], format: 'number' },
  { id: 'maxdd', label: 'Max DD', aliases: ['maxDD', 'maxDd', 'max_dd', 'maxDrawdown', 'max_drawdown'], format: 'percent' },
  { id: 'grossprofit', label: 'Gross profit', aliases: ['grossProfit', 'gross_profit'], format: 'number' },
  { id: 'grossloss', label: 'Gross loss', aliases: ['grossLoss', 'gross_loss'], format: 'number' },
  { id: 'returnpct', label: 'Return %', aliases: ['returnPct', 'return_pct', 'return'], format: 'percent' },
];

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function read(obj: Record<string, unknown>, key: string): unknown {
  try {
    return obj[key];
  } catch {
    return undefined;
  }
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const t = value.trim();
    return t ? t : undefined;
  }
  return undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return String(value);
  const abs = Math.abs(value);
  if (abs >= 100) return value.toFixed(2);
  if (abs >= 1) {
    const s = value.toFixed(4);
    return s.replace(/0+$/, '').replace(/\.$/, '');
  }
  return value.toPrecision(4).replace(/0+$/, '').replace(/\.$/, '');
}

function formatPercent(value: number): string {
  const pct = Math.abs(value) <= 1 ? value * 100 : value;
  const body = Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${body}%`;
}

function formatField(format: 'number' | 'percent' | 'count', value: unknown): string | undefined {
  if (format === 'count' && Array.isArray(value)) return String(value.length);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  const n = asFiniteNumber(value);
  if (n == null) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    return undefined;
  }
  if (format === 'percent') return formatPercent(n);
  if (format === 'count') return String(Math.round(n));
  return formatNumber(n);
}

function lookupAlias(bag: Record<string, unknown>, aliases: readonly string[]): unknown {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(bag, alias)) {
      const v = read(bag, alias);
      if (v != null) return v;
    }
  }
  const lower: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(bag)) {
    lower[key.toLowerCase()] = read(bag, key);
  }
  for (const alias of aliases) {
    const v = lower[alias.toLowerCase()];
    if (v != null) return v;
  }
  return undefined;
}

/** Flatten `stats` onto the report so nested PWA reports still match. */
export function strategyBag(report: unknown): Record<string, unknown> | null {
  if (!isPlainObject(report)) return null;
  const stats = read(report, 'stats');
  if (isPlainObject(stats)) return { ...report, ...stats };
  return report;
}

export function pickStrategyRows(report: unknown): ResultsRow[] {
  const bag = strategyBag(report);
  if (!bag) return [];
  const rows: ResultsRow[] = [];
  for (const field of STRATEGY_FIELDS) {
    const raw = lookupAlias(bag, field.aliases);
    const value = formatField(field.format, raw);
    if (value == null) continue;
    rows.push({ key: field.id, label: field.label, value });
  }
  return rows;
}

export function countPlots(plots: unknown): number {
  if (plots == null) return 0;
  if (Array.isArray(plots)) return plots.length;
  if (typeof plots === 'object') return Object.keys(plots as object).length;
  return 0;
}

function metaOf(lastRun: Record<string, unknown>): Record<string, unknown> {
  const meta = read(lastRun, 'meta');
  return isPlainObject(meta) ? meta : {};
}

function scriptName(lastRun: Record<string, unknown>, meta: Record<string, unknown>): string | undefined {
  return (
    asString(read(meta, 'script_name')) ||
    asString(read(meta, 'scriptName')) ||
    asString(read(meta, 'name')) ||
    asString(read(lastRun, 'script_name')) ||
    asString(read(lastRun, 'name'))
  );
}

function engineId(lastRun: Record<string, unknown>, meta: Record<string, unknown>): string | undefined {
  return (
    asString(read(lastRun, 'engineId')) ||
    asString(read(lastRun, 'engine')) ||
    asString(read(meta, 'engineId')) ||
    asString(read(meta, 'engine'))
  );
}

function seriesKeyOf(lastRun: Record<string, unknown>, meta: Record<string, unknown>): string | undefined {
  return asString(read(lastRun, 'seriesKey')) || asString(read(meta, 'seriesKey'));
}

function msOf(lastRun: Record<string, unknown>, meta: Record<string, unknown>): number | undefined {
  const fromMeta = asFiniteNumber(read(meta, 'ms'));
  if (fromMeta != null) return fromMeta;
  return asFiniteNumber(read(lastRun, 'ms'));
}

export function statusOf(lastRun: Record<string, unknown> | null): ResultsStatus {
  if (!lastRun) return 'idle';
  const status = asString(read(lastRun, 'status'));
  const error = asString(read(lastRun, 'error'));
  if (status === 'error' || error) return 'error';
  if (status === 'success' || status == null) return 'success';
  return 'idle';
}

export function runSummaryRows(lastRun: Record<string, unknown>): ResultsRow[] {
  const meta = metaOf(lastRun);
  const id = asString(read(lastRun, 'id')) ?? '—';
  const name = scriptName(lastRun, meta) ?? '—';
  const engine = engineId(lastRun, meta) ?? '—';
  const seriesKey = seriesKeyOf(lastRun, meta) ?? '—';
  const ms = msOf(lastRun, meta);
  const plots = countPlots(read(lastRun, 'plots'));
  const error = asString(read(lastRun, 'error'));
  const rows: ResultsRow[] = [
    { key: 'id', label: 'Run id', value: id },
    { key: 'script', label: 'Script', value: name },
    { key: 'engine', label: 'Engine', value: engine },
    { key: 'seriesKey', label: 'seriesKey', value: seriesKey },
    { key: 'ms', label: 'Duration', value: ms == null ? '—' : `${Math.round(ms)} ms` },
    { key: 'plots', label: 'Plots', value: String(plots) },
  ];
  if (error) rows.push({ key: 'error', label: 'Error', value: error });
  return rows;
}

function idleView(kind: ResultsKind, focusLine: string): ResultsView {
  return {
    kind,
    title: kind === 'strategy' ? 'Strategy' : 'Results',
    status: 'idle',
    statusLabel: STATUS_LABEL.idle,
    focusLine,
    empty: true,
    emptyMessage: EMPTY_RUN_HINT,
    rows: [],
    strategyRows: [],
    strategyNote: null,
    showStrategy: false,
  };
}

function focusLineOf(focusId: unknown): string {
  if (focusId == null) return NO_RUN_FOCUSED;
  const id = typeof focusId === 'string' ? focusId.trim() : String(focusId).trim();
  if (!id) return NO_RUN_FOCUSED;
  return `Focus: ${id}`;
}

/** Build the Results / Strategy card model from a `results.set` payload. Never throws. */
export function buildResultsView(kind: ResultsKind, payload: unknown): ResultsView {
  try {
    const rec = isPlainObject(payload) ? payload : {};
    const focusLine = focusLineOf(read(rec, 'focusId'));
    const lastRunRaw = read(rec, 'lastRun');
    const lastRun = isPlainObject(lastRunRaw) ? lastRunRaw : null;
    const report = read(rec, 'strategyReport');
    const strategyRows = pickStrategyRows(report);
    const hasReportObject = isPlainObject(report);

    if (!lastRun) {
      return idleView(kind, focusLine);
    }

    const status = statusOf(lastRun);
    const summary = runSummaryRows(lastRun);
    const title = kind === 'strategy' ? 'Strategy' : 'Results';

    if (kind === 'strategy') {
      if (hasReportObject && strategyRows.length > 0) {
        return {
          kind,
          title,
          status,
          statusLabel: STATUS_LABEL[status],
          focusLine,
          empty: false,
          emptyMessage: EMPTY_RUN_HINT,
          rows: strategyRows,
          strategyRows: [],
          strategyNote: null,
          showStrategy: false,
        };
      }
      return {
        kind,
        title,
        status,
        statusLabel: STATUS_LABEL[status],
        focusLine,
        empty: false,
        emptyMessage: EMPTY_RUN_HINT,
        rows: summary,
        strategyRows: [],
        strategyNote: NO_STRATEGY_REPORT,
        showStrategy: true,
      };
    }

    return {
      kind,
      title,
      status,
      statusLabel: STATUS_LABEL[status],
      focusLine,
      empty: false,
      emptyMessage: EMPTY_RUN_HINT,
      rows: summary,
      strategyRows,
      strategyNote: null,
      showStrategy: strategyRows.length > 0,
    };
  } catch {
    return idleView(kind === 'strategy' ? 'strategy' : 'results', NO_RUN_FOCUSED);
  }
}
