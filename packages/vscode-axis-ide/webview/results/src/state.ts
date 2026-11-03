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
 * Never surfaces secrets — only known summary / strategy field aliases.
 */

export type ResultsKind = 'results' | 'strategy';
export type ResultsStatus = 'success' | 'error' | 'idle';

export type ResultsRow = {
  key: string;
  label: string;
  value: string;
};

export type ResultsMetaChip = {
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
  emptyTitle: string;
  emptyMessage: string;
  /** Primary card rows (run summary or non-KPI strategy stats). */
  rows: ResultsRow[];
  /** Compact strategy snippet (results panel) or unused. */
  strategyRows: ResultsRow[];
  /** Shown when the strategy panel has no report object. */
  strategyNote: string | null;
  showStrategy: boolean;
  /** Dense KPI cards (strategy panel when a report exists). */
  kpiRows: ResultsRow[];
  runId: string | null;
  createdAt: number | null;
  relativeTime: string;
  absoluteTime: string;
  metaChips: ResultsMetaChip[];
  /** Polite live-region text for status / focus changes. */
  liveMessage: string;
};

export const EMPTY_RUN_TITLE = 'No run yet';
export const EMPTY_RUN_HINT = 'Run a Pine script with Ctrl/Cmd+Enter';
export const NO_STRATEGY_REPORT = 'This run has no strategy report';
export const NO_STRATEGY_HINT = 'Open a strategy script and run with Ctrl/Cmd+Enter';
export const NO_RUN_FOCUSED = 'No run focused';
export const ERROR_RUN_HINT = 'Fix the error and re-run with Ctrl/Cmd+Enter';

/** Primary strategy KPIs shown as dense cards. */
export const STRATEGY_KPI_IDS: readonly string[] = [
  'netprofit',
  'winrate',
  'trades',
  'profitfactor',
  'maxdd',
];

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

/** Split strategy rows into KPI cards vs denser table remainder. */
export function splitStrategyKpis(rows: ResultsRow[]): { kpis: ResultsRow[]; rest: ResultsRow[] } {
  const kpiSet = new Set(STRATEGY_KPI_IDS);
  const kpis: ResultsRow[] = [];
  const rest: ResultsRow[] = [];
  for (const row of rows) {
    if (kpiSet.has(row.key)) kpis.push(row);
    else rest.push(row);
  }
  // Preserve STRATEGY_KPI_IDS order for cards.
  kpis.sort((a, b) => STRATEGY_KPI_IDS.indexOf(a.key) - STRATEGY_KPI_IDS.indexOf(b.key));
  return { kpis, rest };
}

export function countPlots(plots: unknown): number {
  if (plots == null) return 0;
  if (Array.isArray(plots)) return plots.length;
  if (typeof plots === 'object') return Object.keys(plots as object).length;
  return 0;
}

export function countSeries(series: unknown): number {
  if (series == null) return 0;
  if (Array.isArray(series)) return series.length;
  if (typeof series === 'object') return Object.keys(series as object).length;
  return 0;
}

export function countList(value: unknown): number {
  if (value == null) return 0;
  if (Array.isArray(value)) return value.length;
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

function createdAtOf(lastRun: Record<string, unknown>, meta: Record<string, unknown>): number | null {
  const candidates = [
    asFiniteNumber(read(lastRun, 'createdAt')),
    asFiniteNumber(read(lastRun, 'at')),
    asFiniteNumber(read(meta, 'createdAt')),
    asFiniteNumber(read(meta, 'at')),
  ];
  for (const n of candidates) {
    if (n != null && n > 0) return n;
  }
  return null;
}

/** Relative age for sticky header (never throws). */
export function formatRelativeTime(ms: number, now = Date.now()): string {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const d = now - ms;
  if (!Number.isFinite(d)) return '';
  if (d < 5_000) return 'just now';
  if (d < 60_000) return `${Math.max(1, Math.round(d / 1000))}s ago`;
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h ago`;
  return `${Math.round(d / 86_400_000)}d ago`;
}

export function formatAbsoluteTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
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

export function buildMetaChips(lastRun: Record<string, unknown>): ResultsMetaChip[] {
  const meta = metaOf(lastRun);
  const ms = msOf(lastRun, meta);
  const plots = countPlots(read(lastRun, 'plots'));
  const series = countSeries(read(lastRun, 'series'));
  const logs = countList(read(lastRun, 'logs'));
  const diags = countList(read(lastRun, 'diagnostics'));
  const chips: ResultsMetaChip[] = [];
  if (ms != null) chips.push({ key: 'ms', label: 'ms', value: String(Math.round(ms)) });
  chips.push({ key: 'plots', label: 'plots', value: String(plots) });
  chips.push({ key: 'series', label: 'series', value: String(series) });
  chips.push({ key: 'logs', label: 'logs', value: String(logs) });
  chips.push({ key: 'diags', label: 'diags', value: String(diags) });
  return chips;
}

/** Case-insensitive filter over label/value (local UI only). */
export function filterRows(rows: ResultsRow[], query: string): ResultsRow[] {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (row) => row.label.toLowerCase().includes(q) || row.value.toLowerCase().includes(q) || row.key.toLowerCase().includes(q),
  );
}

function idleView(kind: ResultsKind, focusLine: string): ResultsView {
  return {
    kind,
    title: kind === 'strategy' ? 'Strategy' : 'Results',
    status: 'idle',
    statusLabel: STATUS_LABEL.idle,
    focusLine,
    empty: true,
    emptyTitle: EMPTY_RUN_TITLE,
    emptyMessage: EMPTY_RUN_HINT,
    rows: [],
    strategyRows: [],
    strategyNote: null,
    showStrategy: false,
    kpiRows: [],
    runId: null,
    createdAt: null,
    relativeTime: '',
    absoluteTime: '',
    metaChips: [],
    liveMessage: 'Idle — no run focused',
  };
}

function focusLineOf(focusId: unknown): string {
  if (focusId == null) return NO_RUN_FOCUSED;
  const id = typeof focusId === 'string' ? focusId.trim() : String(focusId).trim();
  if (!id) return NO_RUN_FOCUSED;
  return `Focus: ${id}`;
}

/** Build the Results / Strategy card model from a `results.set` payload. Never throws. */
export function buildResultsView(kind: ResultsKind, payload: unknown, now = Date.now()): ResultsView {
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
    const meta = metaOf(lastRun);
    const runId = asString(read(lastRun, 'id')) ?? null;
    const createdAt = createdAtOf(lastRun, meta);
    const relativeTime = createdAt != null ? formatRelativeTime(createdAt, now) : '';
    const absoluteTime = createdAt != null ? formatAbsoluteTime(createdAt) : '';
    const metaChips = buildMetaChips(lastRun);
    const emptyMessage = status === 'error' ? ERROR_RUN_HINT : EMPTY_RUN_HINT;
    const liveMessage = `${STATUS_LABEL[status]}${runId ? ` — ${runId}` : ''}`;

    if (kind === 'strategy') {
      if (hasReportObject && strategyRows.length > 0) {
        const { kpis, rest } = splitStrategyKpis(strategyRows);
        return {
          kind,
          title,
          status,
          statusLabel: STATUS_LABEL[status],
          focusLine,
          empty: false,
          emptyTitle: EMPTY_RUN_TITLE,
          emptyMessage,
          // KPI cards take primary metrics; denser table shows the remainder (or all if none match).
          rows: kpis.length > 0 ? rest : strategyRows,
          strategyRows: [],
          strategyNote: null,
          showStrategy: false,
          kpiRows: kpis,
          runId,
          createdAt,
          relativeTime,
          absoluteTime,
          metaChips,
          liveMessage,
        };
      }
      return {
        kind,
        title,
        status,
        statusLabel: STATUS_LABEL[status],
        focusLine,
        empty: false,
        emptyTitle: EMPTY_RUN_TITLE,
        emptyMessage,
        rows: summary,
        strategyRows: [],
        strategyNote: `${NO_STRATEGY_REPORT}. ${NO_STRATEGY_HINT}`,
        showStrategy: true,
        kpiRows: [],
        runId,
        createdAt,
        relativeTime,
        absoluteTime,
        metaChips,
        liveMessage,
      };
    }

    return {
      kind,
      title,
      status,
      statusLabel: STATUS_LABEL[status],
      focusLine,
      empty: false,
      emptyTitle: EMPTY_RUN_TITLE,
      emptyMessage,
      rows: summary,
      strategyRows,
      strategyNote: null,
      showStrategy: strategyRows.length > 0,
      kpiRows: [],
      runId,
      createdAt,
      relativeTime,
      absoluteTime,
      metaChips,
      liveMessage,
    };
  } catch {
    return idleView(kind === 'strategy' ? 'strategy' : 'results', NO_RUN_FOCUSED);
  }
}
