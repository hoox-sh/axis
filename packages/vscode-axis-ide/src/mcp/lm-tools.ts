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
 * VS Code languageModelTools for AXIS IDE (Task 22).
 *
 * Summaries only — never secrets, never full plot/series arrays.
 * package.json merge is deferred — see `lm-tools-contributes.fragment.json`.
 */

import {
  LanguageModelTextPart,
  LanguageModelToolResult,
  MarkdownString,
  lm,
  type CancellationToken,
  type ExtensionContext,
  type LanguageModelTool,
  type LanguageModelToolInvocationOptions,
  type LanguageModelToolInvocationPrepareOptions,
  type PreparedToolInvocation,
} from 'vscode';
import type { RunMode } from '../run/engine-http';
import type { ResultsFocusStore, RunResultRecord } from '../run/results-store';
import { scrubSecrets } from '../run/scrub';

/** Keep in sync with lm-tools-contributes.fragment.json. */
export const LM_TOOL_NAMES = {
  runScript: 'axis_run_script',
  getResultsFocus: 'axis_get_results_focus',
  chartSnapshotMeta: 'axis_chart_snapshot_meta',
  getRunLogs: 'axis_get_run_logs',
  getProfiler: 'axis_get_profiler',
} as const;

export type LmToolName = (typeof LM_TOOL_NAMES)[keyof typeof LM_TOOL_NAMES];

export type AxisRunScriptInput = {
  mode?: RunMode | string;
  focus?: boolean;
};

export type HotLineSummary = {
  line: number;
  ms: number;
  pct: number;
};

/** Compact lastRun view for LM / MCP — no plot arrays, no series values. */
export type LastRunSummary = {
  id: string;
  status: 'success' | 'error';
  seriesKey: string;
  engineId: string;
  error?: string;
  plotCount: number;
  plotKeys: string[];
  seriesKeys: string[];
  hasStrategyReport: boolean;
  meta: Record<string, unknown> | null;
  createdAt: number;
  logCount: number;
  diagnosticCount: number;
  profileMs?: number;
  profileLineCount?: number;
  hotLines?: HotLineSummary[];
};

export type ResultsFocusLmPayload = {
  resultsFocusId: string | null;
  newestRunId: string | null;
  lastRunSummary: LastRunSummary | null;
};

/** Chart meta for LM — no bars, no secrets. */
export type ChartSnapshotMeta = {
  seriesKey: string;
  interval: string;
  symbol?: string;
  exchange?: string;
  market?: string;
  scriptIds: string[];
  live: 'live' | 'degraded' | 'off' | string;
};

export type LmRunScriptResult = {
  ok: boolean;
  mode: RunMode;
  focus: boolean;
  epoch?: number;
  runId?: string;
  reason?: string;
  error?: string;
  /** Focus snapshot after the run (summaries only). */
  results?: ResultsFocusLmPayload;
};

export type LmLogRow = {
  level: string;
  message: string;
  line: number | null;
};

export type RunLogsLmPayload = {
  runId: string | null;
  status: string | null;
  total: number;
  rows: LmLogRow[];
};

export type ProfilerLmPayload = {
  runId: string | null;
  ms: number;
  status: string | null;
  engineId: string | null;
  plotCount: number;
  seriesCount: number;
  profileMs?: number;
  profileLineCount?: number;
  hotLines?: HotLineSummary[];
  phases?: Record<string, unknown>;
  error?: string;
};

/**
 * Injectable seams — wiring agent binds orchestrator / ResultsFocusStore /
 * chart+live snapshot. Unit tests supply fakes.
 */
export type LmToolsDeps = {
  /**
   * Run the active Pine buffer (side-effecting). Must not return secrets or
   * full plot arrays — prefer calling {@link summarizeRunRecord} after publish.
   */
  runScript(input: {
    mode: RunMode;
    focus: boolean;
    token: CancellationToken;
  }): Promise<LmRunScriptResult>;

  /** Results focus store (or a pick with the getters below). */
  results: Pick<
    ResultsFocusStore,
    'getResultsFocusId' | 'getNewestRunId' | 'getLastRun'
  >;

  /** Active chart document + live HUD — never include bars or keys. */
  getChartSnapshotMeta(): ChartSnapshotMeta | null;
};

const META_ALLOW = new Set([
  'ms',
  'transport',
  'mode',
  'script_name',
  'plot_meta',
  'code',
]);

const PLOT_KEYS_MAX = 40;
const LOG_ROWS_CAP = 40;
const HOT_LINES_MAX = 5;

function isRunMode(value: unknown): value is RunMode {
  return value === 'auto' || value === 'interpret' || value === 'compile';
}

export function normalizeRunMode(raw: unknown): RunMode {
  if (isRunMode(raw)) return raw;
  if (typeof raw === 'string') {
    const t = raw.trim().toLowerCase();
    if (isRunMode(t)) return t;
  }
  return 'auto';
}

function countPlots(plots: unknown): { count: number; keys: string[] } {
  if (plots == null) return { count: 0, keys: [] };
  if (Array.isArray(plots)) {
    return { count: plots.length, keys: [] };
  }
  if (typeof plots === 'object') {
    const keys = Object.keys(plots as object).slice(0, PLOT_KEYS_MAX);
    return { count: keys.length, keys };
  }
  return { count: 0, keys: [] };
}

function seriesKeysOf(series: unknown): string[] {
  if (!series || typeof series !== 'object' || Array.isArray(series)) return [];
  return Object.keys(series as object).slice(0, PLOT_KEYS_MAX);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asLineNumber(value: unknown): number | null {
  const n = asFiniteNumber(value);
  if (n == null) return null;
  const line = Math.trunc(n);
  return line >= 1 ? line : null;
}

type ProfileSummary = {
  profileMs?: number;
  profileLineCount?: number;
  hotLines?: HotLineSummary[];
  phases?: Record<string, unknown>;
};

/**
 * Derive LM-safe profile fields from `meta.profile`. Never invents lines;
 * never dumps the full profile object.
 */
export function summarizeProfile(profile: unknown): ProfileSummary {
  if (!isPlainObject(profile)) return {};
  const out: ProfileSummary = {};

  const totalRaw =
    asFiniteNumber(profile.totalMs) ?? asFiniteNumber(profile.total_ms);
  if (totalRaw != null && totalRaw >= 0) {
    out.profileMs = totalRaw;
  }

  const rows = Array.isArray(profile.lines)
    ? profile.lines
    : Array.isArray(profile.line_stats)
      ? profile.line_stats
      : undefined;

  if (rows !== undefined) {
    out.profileLineCount = rows.length;
    const parsed: HotLineSummary[] = [];
    let sumMs = 0;
    for (const row of rows) {
      if (!isPlainObject(row)) continue;
      const line =
        asLineNumber(row.line) ??
        asLineNumber(row.line_no) ??
        asLineNumber(row.lineno);
      if (line == null) continue;
      const ms =
        asFiniteNumber(row.ms) ??
        asFiniteNumber(row.time_ms) ??
        asFiniteNumber(row.time) ??
        0;
      if (!(ms >= 0)) continue;
      sumMs += ms;
      const pctRaw = asFiniteNumber(row.pct);
      parsed.push({
        line,
        ms,
        pct: pctRaw != null && pctRaw >= 0 ? pctRaw : -1,
      });
    }
    const total = out.profileMs != null && out.profileMs > 0 ? out.profileMs : sumMs;
    for (const row of parsed) {
      if (row.pct < 0) {
        row.pct = total > 0 && row.ms > 0 ? (row.ms / total) * 100 : 0;
      }
    }
    parsed.sort((a, b) => b.ms - a.ms || a.line - b.line);
    out.hotLines = parsed.slice(0, HOT_LINES_MAX);
  }

  if (isPlainObject(profile.phases)) {
    const phases: Record<string, unknown> = {};
    for (const key of Object.keys(profile.phases).slice(0, PLOT_KEYS_MAX)) {
      const v = profile.phases[key];
      if (typeof v === 'string') {
        phases[key] = scrubSecrets(v);
      } else if (
        typeof v === 'number' ||
        typeof v === 'boolean' ||
        v === null
      ) {
        phases[key] = v;
      }
    }
    if (Object.keys(phases).length > 0) out.phases = phases;
  }

  return out;
}

/**
 * Scrub meta for LM: allowlisted scalar fields only; plot_meta → key list;
 * string values pass through {@link scrubSecrets}. Profile is summarized
 * separately via {@link summarizeProfile} — never dumped raw.
 */
export function summarizeMeta(
  meta: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(meta)) {
    if (!META_ALLOW.has(key)) continue;
    const v = meta[key];
    if (key === 'plot_meta') {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        out.plot_meta_keys = Object.keys(v as object).slice(0, PLOT_KEYS_MAX);
      }
      continue;
    }
    if (typeof v === 'string') {
      out[key] = scrubSecrets(v);
    } else if (
      typeof v === 'number' ||
      typeof v === 'boolean' ||
      v === null
    ) {
      out[key] = v;
    }
  }
  // Derived profile summary fields (not the raw profile bag).
  const profileSummary = summarizeProfile(meta.profile);
  if (profileSummary.profileMs != null) out.profileMs = profileSummary.profileMs;
  if (profileSummary.profileLineCount != null) {
    out.profileLineCount = profileSummary.profileLineCount;
  }
  if (profileSummary.hotLines) out.hotLines = profileSummary.hotLines;
  if (profileSummary.phases) out.phases = profileSummary.phases;
  return Object.keys(out).length > 0 ? out : null;
}

/** Build a lastRun summary — strips plots/series payloads. */
export function summarizeRunRecord(
  record: RunResultRecord | null | undefined,
): LastRunSummary | null {
  if (!record) return null;
  const { count, keys } = countPlots(record.plots);
  const error =
    typeof record.error === 'string' && record.error
      ? scrubSecrets(record.error)
      : undefined;
  const profileSummary = summarizeProfile(
    record.meta && isPlainObject(record.meta) ? record.meta.profile : undefined,
  );
  const summary: LastRunSummary = {
    id: record.id,
    status: record.status,
    seriesKey: record.seriesKey,
    engineId: record.engineId,
    ...(error ? { error } : {}),
    plotCount: count,
    plotKeys: keys,
    seriesKeys: seriesKeysOf(record.series),
    hasStrategyReport: record.strategyReport != null,
    meta: summarizeMeta(record.meta),
    createdAt: record.createdAt,
    logCount: Array.isArray(record.logs) ? record.logs.length : 0,
    diagnosticCount: Array.isArray(record.diagnostics)
      ? record.diagnostics.length
      : 0,
  };
  if (profileSummary.profileMs != null) summary.profileMs = profileSummary.profileMs;
  if (profileSummary.profileLineCount != null) {
    summary.profileLineCount = profileSummary.profileLineCount;
  }
  if (profileSummary.hotLines) summary.hotLines = profileSummary.hotLines;
  return summary;
}

export function buildResultsFocusPayload(
  results: Pick<
    ResultsFocusStore,
    'getResultsFocusId' | 'getNewestRunId' | 'getLastRun'
  >,
): ResultsFocusLmPayload {
  return {
    resultsFocusId: results.getResultsFocusId(),
    newestRunId: results.getNewestRunId(),
    lastRunSummary: summarizeRunRecord(results.getLastRun()),
  };
}

function readProp(value: unknown, key: string): unknown {
  try {
    if (value == null || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function textOf(value: unknown): string | null {
  if (typeof value === 'string') {
    const t = value.trim();
    return t ? t : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

const LEVEL_BY_NAME: Record<string, string> = {
  error: 'error',
  err: 'error',
  fatal: 'error',
  critical: 'error',
  warning: 'warning',
  warn: 'warning',
  info: 'info',
  log: 'info',
  information: 'info',
  debug: 'debug',
  trace: 'debug',
  hint: 'debug',
};

function levelOf(value: unknown, forceError: boolean): string {
  if (forceError) return 'error';
  if (typeof value === 'string') {
    const key = value.trim().toLowerCase();
    if (LEVEL_BY_NAME[key]) return LEVEL_BY_NAME[key];
  }
  if (typeof value === 'number') {
    if (value === 0) return 'error';
    if (value === 1) return 'warning';
    if (value === 2) return 'info';
    if (value === 3) return 'debug';
  }
  return 'info';
}

function messageOf(item: unknown): string | null {
  if (typeof item === 'string') {
    const t = item.trim();
    return t ? scrubSecrets(t) : null;
  }
  if (typeof item === 'number' && Number.isFinite(item)) {
    return scrubSecrets(String(item));
  }
  if (!isPlainObject(item)) return null;
  const raw =
    textOf(item.message) ?? textOf(item.msg) ?? textOf(item.text) ?? null;
  return raw ? scrubSecrets(raw) : null;
}

function lineOf(item: unknown): number | null {
  if (!isPlainObject(item)) return null;
  return (
    asLineNumber(item.line) ??
    asLineNumber(item.lineno) ??
    asLineNumber(item.line_no)
  );
}

function rowFromItem(item: unknown, forceError: boolean): LmLogRow | null {
  if (typeof item === 'string' || typeof item === 'number') {
    const message = messageOf(item);
    if (!message) return null;
    return { level: forceError ? 'error' : 'info', message, line: null };
  }
  if (!isPlainObject(item)) return null;
  const message = messageOf(item);
  if (!message) return null;
  const level = levelOf(
    item.level ?? item.severity,
    forceError,
  );
  return { level, message, line: lineOf(item) };
}

function pushLogSource(value: unknown, out: LmLogRow[]): void {
  if (out.length >= LOG_ROWS_CAP) return;
  if (typeof value === 'string' || isPlainObject(value)) {
    const row = rowFromItem(value, false);
    if (row) out.push(row);
    return;
  }
  if (!Array.isArray(value)) return;
  for (let i = 0; i < value.length && out.length < LOG_ROWS_CAP; i++) {
    const row = rowFromItem(value[i], false);
    if (row) out.push(row);
  }
}

/**
 * Focused log extract for LM tools (same sources as Logs panel, cap 40).
 * Sources: logs, meta.logs, diagnostics, meta.diagnostics, then error.
 */
export function extractLogsForLm(record: unknown): LmLogRow[] {
  const out: LmLogRow[] = [];
  if (record == null || typeof record !== 'object') return out;
  pushLogSource(readProp(record, 'logs'), out);
  const meta = readProp(record, 'meta');
  pushLogSource(readProp(meta, 'logs'), out);
  pushLogSource(readProp(record, 'diagnostics'), out);
  pushLogSource(readProp(meta, 'diagnostics'), out);
  if (out.length < LOG_ROWS_CAP) {
    const err = readProp(record, 'error');
    if (err != null && err !== '') {
      const row = rowFromItem(err, true);
      if (row) out.push(row);
    }
  }
  return out;
}

export function buildRunLogsPayload(
  record: RunResultRecord | null | undefined,
): RunLogsLmPayload {
  if (!record) {
    return { runId: null, status: null, total: 0, rows: [] };
  }
  const rows = extractLogsForLm(record);
  return {
    runId: record.id,
    status: record.status,
    total: rows.length,
    rows,
  };
}

export function buildProfilerPayload(
  record: RunResultRecord | null | undefined,
): ProfilerLmPayload {
  if (!record) {
    return {
      runId: null,
      ms: 0,
      status: null,
      engineId: null,
      plotCount: 0,
      seriesCount: 0,
    };
  }
  const { count: plotCount } = countPlots(record.plots);
  const seriesCount = Array.isArray(record.series)
    ? record.series.length
    : seriesKeysOf(record.series).length;
  const metaMs =
    record.meta && isPlainObject(record.meta)
      ? asFiniteNumber(record.meta.ms)
      : null;
  const profileSummary = summarizeProfile(
    record.meta && isPlainObject(record.meta) ? record.meta.profile : undefined,
  );
  const payload: ProfilerLmPayload = {
    runId: record.id,
    ms: metaMs != null && metaMs >= 0 ? metaMs : 0,
    status: record.status,
    engineId: record.engineId,
    plotCount,
    seriesCount,
  };
  if (profileSummary.profileMs != null) payload.profileMs = profileSummary.profileMs;
  if (profileSummary.profileLineCount != null) {
    payload.profileLineCount = profileSummary.profileLineCount;
  }
  if (profileSummary.hotLines) payload.hotLines = profileSummary.hotLines;
  if (profileSummary.phases) payload.phases = profileSummary.phases;
  if (typeof record.error === 'string' && record.error) {
    payload.error = scrubSecrets(record.error);
  }
  return payload;
}

/** True when a JSON string still embeds a raw Worker/Pro key or Bearer token. */
export function payloadLeaksSecret(text: string): boolean {
  if (/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/i.test(text)) return true;
  if (/pyn_[A-Za-z0-9_-]{20,}/.test(text)) return true;
  if (/pn_[a-fA-F0-9]{16,}/.test(text)) return true;
  return false;
}

function textResult(value: unknown): LanguageModelToolResult {
  const json = JSON.stringify(value);
  // Defense in depth — never hand the model a payload that still has keys.
  const safe = payloadLeaksSecret(json)
    ? JSON.stringify({
        ok: false,
        error: 'AXIS LM tool refused to return a payload that looked like it contained secrets.',
      })
    : json;
  return new LanguageModelToolResult([new LanguageModelTextPart(safe)]);
}

export function createRunScriptTool(
  deps: LmToolsDeps,
): LanguageModelTool<AxisRunScriptInput> {
  return {
    prepareInvocation(
      _options: LanguageModelToolInvocationPrepareOptions<AxisRunScriptInput>,
      _token: CancellationToken,
    ): PreparedToolInvocation {
      return {
        invocationMessage: 'Run Pine via AXIS IDE',
        confirmationMessages: {
          title: 'AXIS: Run Script',
          message: new MarkdownString(
            'Run the active Pine buffer through AXIS IDE and update the chart/results.',
          ),
        },
      };
    },

    async invoke(
      options: LanguageModelToolInvocationOptions<AxisRunScriptInput>,
      token: CancellationToken,
    ): Promise<LanguageModelToolResult> {
      const mode = normalizeRunMode(options.input?.mode);
      const focus = options.input?.focus !== false;
      try {
        const result = await deps.runScript({ mode, focus, token });
        // Prefer caller-provided results; else refresh from store after run.
        const payload: LmRunScriptResult = {
          ...result,
          mode: result.mode ?? mode,
          focus: result.focus ?? focus,
          error: result.error ? scrubSecrets(result.error) : result.error,
          results:
            result.results ??
            (result.ok ? buildResultsFocusPayload(deps.results) : result.results),
        };
        return textResult(payload);
      } catch (e) {
        const error = scrubSecrets(e instanceof Error ? e.message : String(e));
        return textResult({
          ok: false,
          mode,
          focus,
          error: error || 'AXIS run failed',
        } satisfies LmRunScriptResult);
      }
    },
  };
}

export function createGetResultsFocusTool(
  deps: LmToolsDeps,
): LanguageModelTool<object> {
  return {
    prepareInvocation(
      _options: LanguageModelToolInvocationPrepareOptions<object>,
      _token: CancellationToken,
    ): PreparedToolInvocation {
      return { invocationMessage: 'Read AXIS results focus' };
    },

    async invoke(
      _options: LanguageModelToolInvocationOptions<object>,
      _token: CancellationToken,
    ): Promise<LanguageModelToolResult> {
      try {
        return textResult(buildResultsFocusPayload(deps.results));
      } catch (e) {
        const error = scrubSecrets(e instanceof Error ? e.message : String(e));
        return textResult({
          resultsFocusId: null,
          newestRunId: null,
          lastRunSummary: null,
          error: error || 'AXIS results focus unavailable',
        });
      }
    },
  };
}

export function createChartSnapshotMetaTool(
  deps: LmToolsDeps,
): LanguageModelTool<object> {
  return {
    prepareInvocation(
      _options: LanguageModelToolInvocationPrepareOptions<object>,
      _token: CancellationToken,
    ): PreparedToolInvocation {
      return { invocationMessage: 'Read AXIS chart meta' };
    },

    async invoke(
      _options: LanguageModelToolInvocationOptions<object>,
      _token: CancellationToken,
    ): Promise<LanguageModelToolResult> {
      try {
        const meta = deps.getChartSnapshotMeta();
        if (!meta) {
          return textResult({
            ok: false,
            error: 'No active AXIS chart document',
          });
        }
        // Copy + scrub string fields; never pass through unexpected bags.
        const safe: ChartSnapshotMeta = {
          seriesKey: scrubSecrets(meta.seriesKey),
          interval: String(meta.interval ?? ''),
          scriptIds: Array.isArray(meta.scriptIds)
            ? meta.scriptIds.map((id) => scrubSecrets(String(id)))
            : [],
          live: String(meta.live ?? 'off'),
        };
        if (meta.symbol != null) safe.symbol = scrubSecrets(String(meta.symbol));
        if (meta.exchange != null) {
          safe.exchange = scrubSecrets(String(meta.exchange));
        }
        if (meta.market != null) safe.market = scrubSecrets(String(meta.market));
        return textResult(safe);
      } catch (e) {
        const error = scrubSecrets(e instanceof Error ? e.message : String(e));
        return textResult({
          ok: false,
          error: error || 'AXIS chart meta unavailable',
        });
      }
    },
  };
}

export function createGetRunLogsTool(
  deps: LmToolsDeps,
): LanguageModelTool<object> {
  return {
    prepareInvocation(
      _options: LanguageModelToolInvocationPrepareOptions<object>,
      _token: CancellationToken,
    ): PreparedToolInvocation {
      return { invocationMessage: 'Read AXIS run logs' };
    },

    async invoke(
      _options: LanguageModelToolInvocationOptions<object>,
      _token: CancellationToken,
    ): Promise<LanguageModelToolResult> {
      try {
        return textResult(buildRunLogsPayload(deps.results.getLastRun()));
      } catch (e) {
        const error = scrubSecrets(e instanceof Error ? e.message : String(e));
        return textResult({
          runId: null,
          status: null,
          total: 0,
          rows: [],
          error: error || 'AXIS run logs unavailable',
        });
      }
    },
  };
}

export function createGetProfilerTool(
  deps: LmToolsDeps,
): LanguageModelTool<object> {
  return {
    prepareInvocation(
      _options: LanguageModelToolInvocationPrepareOptions<object>,
      _token: CancellationToken,
    ): PreparedToolInvocation {
      return { invocationMessage: 'Read AXIS profiler summary' };
    },

    async invoke(
      _options: LanguageModelToolInvocationOptions<object>,
      _token: CancellationToken,
    ): Promise<LanguageModelToolResult> {
      try {
        return textResult(buildProfilerPayload(deps.results.getLastRun()));
      } catch (e) {
        const error = scrubSecrets(e instanceof Error ? e.message : String(e));
        return textResult({
          runId: null,
          ms: 0,
          status: null,
          engineId: null,
          plotCount: 0,
          seriesCount: 0,
          error: error || 'AXIS profiler unavailable',
        });
      }
    },
  };
}

/**
 * Register AXIS languageModelTools for Copilot Chat / agent mode.
 * Call from activate (wiring agent merges fragment into package.json later).
 */
export function registerLmTools(
  context: ExtensionContext,
  deps: LmToolsDeps,
): { dispose(): void }[] {
  const disposables = [
    lm.registerTool(LM_TOOL_NAMES.runScript, createRunScriptTool(deps)),
    lm.registerTool(
      LM_TOOL_NAMES.getResultsFocus,
      createGetResultsFocusTool(deps),
    ),
    lm.registerTool(
      LM_TOOL_NAMES.chartSnapshotMeta,
      createChartSnapshotMetaTool(deps),
    ),
    lm.registerTool(LM_TOOL_NAMES.getRunLogs, createGetRunLogsTool(deps)),
    lm.registerTool(LM_TOOL_NAMES.getProfiler, createGetProfilerTool(deps)),
  ];
  context.subscriptions.push(...disposables);
  return disposables;
}
