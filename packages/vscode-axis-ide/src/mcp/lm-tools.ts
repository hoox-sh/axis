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
} as const;

export type LmToolName = (typeof LM_TOOL_NAMES)[keyof typeof LM_TOOL_NAMES];

export type AxisRunScriptInput = {
  mode?: RunMode | string;
  focus?: boolean;
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

/**
 * Scrub meta for LM: allowlisted scalar fields only; plot_meta → key list;
 * string values pass through {@link scrubSecrets}.
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
  return {
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
  };
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

/**
 * Register the three AXIS languageModelTools.
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
  ];
  context.subscriptions.push(...disposables);
  return disposables;
}
