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
 * RunOrchestrator — monotonic epoch + Pro `/run` on mock bars (PR-06).
 */

import type { OhlcvBar } from '../host/mock-bars';
import type { ChartFullPayload, HostRunStatusPayload } from '../protocol';
import { PRO_KEY_ERROR } from '../secrets/slots';
import { validateProKey } from '../secrets/validate';
import type { ChartNotifyMessage } from './chart-bus';
import {
  DEFAULT_ENGINE_ENDPOINT,
  type EngineCompileDiagnostic,
  type EngineRunResult,
  type FetchLike,
  type RunMode,
  postEngineRun,
} from './engine-http';
import type { ResultsFocusStore } from './results-store';
import { scrubSecrets } from './scrub';

export type { RunMode };

export interface RunRequest {
  script: string;
  uri?: string;
  mode: RunMode;
  focus: boolean;
  bars: OhlcvBar[];
  seriesKey: string;
  engineId: string;
  signal?: AbortSignal;
  /** Handshake / session seq — run paint must use seq > this (webview lastSeq gate). */
  baseSeq?: number;
  /** Optional symbol label for the Pro body (defaults from seriesKey). */
  symbol?: string;
}

export const MISSING_PRO_KEY_ERROR =
  'AXIS Pro API key missing. Run “AXIS: Set Pro API Key” (SecretStorage pyn_…) before running.';

export const UNSUPPORTED_ENGINE_ERROR =
  'AXIS Run supports engine id "server" only in this release (pyne-worker lands later).';

export interface RunSecrets {
  /** Resolve Pro (`pyn_…`) key for engineId `server`. Never-throw. */
  getProKey(): Promise<string | undefined>;
}

export interface RunOutput {
  appendLine(line: string): void;
}

/** Minimal DiagnosticCollection surface (vscode-free for unit tests). */
export interface RunDiagnostic {
  message: string;
  severity: 'error' | 'warning' | 'info';
  line?: number;
  column?: number;
}

export interface RunDiagnostics {
  /** Clear diagnostics for one URI (empty set). Prefer over wiping the collection. */
  set(uri: string | undefined, items: RunDiagnostic[]): void;
}

export interface RunDeps {
  secrets: RunSecrets;
  /** Engine base URL (`axis.engine.endpoint`) — already gated by caller. */
  endpoint: string;
  /** Optional injectable fetch (tests). */
  fetchImpl?: FetchLike;
  bus: {
    notifyChart(message: ChartNotifyMessage): void;
  };
  results: Pick<ResultsFocusStore, 'publish'>;
  output: RunOutput;
  diagnostics: RunDiagnostics;
  /** Optional `host.run.status` fan-out. */
  onRunStatus?: (payload: HostRunStatusPayload) => void;
}

export type RunOutcome =
  | { ok: true; epoch: number; runId: string; result: EngineRunResult; seq: number }
  | {
      ok: false;
      epoch: number;
      reason: 'stale' | 'error' | 'aborted';
      error?: string;
      result?: EngineRunResult;
    };

function symbolFromSeriesKey(seriesKey: string): string {
  const parts = String(seriesKey ?? '').split('|');
  const sym = parts.length >= 3 ? parts[2] : '';
  return sym && sym.trim() ? sym.trim() : 'CHART';
}

function toRunDiagnostics(items: EngineCompileDiagnostic[]): RunDiagnostic[] {
  return items.map((d) => ({
    message: scrubSecrets(d.message),
    severity: d.severity ?? 'error',
    line: d.line,
    column: d.column,
  }));
}

function combineSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
  if (!a && !b) return undefined;
  if (a && !b) return a;
  if (!a && b) return b;
  if (a!.aborted || b!.aborted) {
    const c = new AbortController();
    c.abort();
    return c.signal;
  }
  const c = new AbortController();
  const onAbort = (): void => c.abort();
  a!.addEventListener('abort', onAbort, { once: true });
  b!.addEventListener('abort', onAbort, { once: true });
  return c.signal;
}

function safeLog(output: RunOutput, line: string): void {
  try {
    output.appendLine(scrubSecrets(line));
  } catch {
    // ignore
  }
}

export class RunOrchestrator {
  private epoch = 0;
  private seq = 0;
  /** Aborts the previous in-flight fetch when a new run starts or abortAll(). */
  private inflight: AbortController | undefined;

  /** Current epoch (last started run). */
  get currentEpoch(): number {
    return this.epoch;
  }

  /** Last chart.full seq posted by a successful run. */
  get currentSeq(): number {
    return this.seq;
  }

  /** Abort any in-flight `/run` (deactivate / supersede). */
  abortAll(): void {
    this.inflight?.abort();
    this.inflight = undefined;
  }

  /**
   * Bump epoch, abort prior fetch, resolve Pro key, POST `/run`, apply
   * chart/results/diagnostics only when the epoch is still current.
   * Never logs secret material.
   */
  async run(req: RunRequest, deps: RunDeps): Promise<RunOutcome> {
    // Supersede any prior in-flight request (epoch bump + AbortSignal).
    this.inflight?.abort();
    const localAbort = new AbortController();
    this.inflight = localAbort;
    const signal = combineSignals(req.signal, localAbort.signal);

    const my = ++this.epoch;
    const started = Date.now();
    try {
      safeLog(
        deps.output,
        `run start epoch=${my} engine=${req.engineId} series=${req.seriesKey} bars=${req.bars.length} focus=${req.focus}`,
      );
      this.emitStatus(deps, {
        epoch: my,
        state: 'running',
        message: `epoch ${my}`,
        seriesKey: req.seriesKey,
      });

      if (req.engineId && req.engineId !== 'server') {
        const error = UNSUPPORTED_ENGINE_ERROR;
        this.setDiags(deps, req.uri, [{ message: error, severity: 'error' }]);
        safeLog(deps.output, `run error epoch=${my}: ${error}`);
        this.emitStatus(deps, {
          epoch: my,
          state: 'error',
          message: error,
          seriesKey: req.seriesKey,
        });
        return { ok: false, epoch: my, reason: 'error', error };
      }

      if (signal?.aborted) {
        safeLog(deps.output, `run aborted epoch=${my}`);
        this.emitStatus(deps, {
          epoch: my,
          state: 'aborted',
          seriesKey: req.seriesKey,
        });
        return { ok: false, epoch: my, reason: 'aborted', error: 'Aborted' };
      }

      const rawKey = await deps.secrets.getProKey();
      if (my !== this.epoch) {
        safeLog(deps.output, `drop stale epoch ${my}`);
        return { ok: false, epoch: my, reason: 'stale' };
      }
      const checked = validateProKey(rawKey ?? '');
      if (!checked.ok || !rawKey) {
        const error = !rawKey ? MISSING_PRO_KEY_ERROR : PRO_KEY_ERROR;
        this.setDiags(deps, req.uri, [{ message: error, severity: 'error' }]);
        safeLog(deps.output, `run error epoch=${my}: ${error}`);
        this.emitStatus(deps, {
          epoch: my,
          state: 'error',
          message: error,
          seriesKey: req.seriesKey,
        });
        return { ok: false, epoch: my, reason: 'error', error };
      }

      const endpoint = String(deps.endpoint ?? '').trim() || DEFAULT_ENGINE_ENDPOINT;
      const result = await postEngineRun({
        endpoint,
        script: req.script,
        bars: req.bars,
        mode: req.mode || 'auto',
        symbol: req.symbol || symbolFromSeriesKey(req.seriesKey),
        apiKey: rawKey,
        signal,
        fetchImpl: deps.fetchImpl,
      });

      if (my !== this.epoch) {
        safeLog(deps.output, `drop stale epoch ${my}`);
        return { ok: false, epoch: my, reason: 'stale', result };
      }

      if (signal?.aborted) {
        safeLog(deps.output, `run aborted epoch=${my}`);
        this.emitStatus(deps, {
          epoch: my,
          state: 'aborted',
          seriesKey: req.seriesKey,
        });
        return { ok: false, epoch: my, reason: 'aborted', error: 'Aborted', result };
      }

      const ms = result.meta.ms ?? Date.now() - started;
      const scrubbedError = result.error ? scrubSecrets(result.error) : undefined;

      if (result.status === 'error') {
        const diags = toRunDiagnostics(result.diagnostics);
        this.setDiags(
          deps,
          req.uri,
          diags.length > 0
            ? diags
            : [{ message: scrubbedError || 'Engine error', severity: 'error' }],
        );
        deps.results.publish({
          status: 'error',
          focus: req.focus,
          seriesKey: req.seriesKey,
          engineId: req.engineId,
          error: scrubbedError,
          plots: result.plots,
          series: result.series,
          meta: { ...result.meta, ms },
        });
        safeLog(
          deps.output,
          `run error epoch=${my} ms=${Math.round(ms)} ${result.code ? `code=${result.code} ` : ''}${scrubbedError ?? ''}`.trim(),
        );
        this.emitStatus(deps, {
          epoch: my,
          state: 'error',
          message: scrubbedError,
          seriesKey: req.seriesKey,
        });
        return { ok: false, epoch: my, reason: 'error', error: scrubbedError, result };
      }

      // Success — clear prior compile diagnostics for this URI only; paint chart.full.
      this.setDiags(deps, req.uri, []);
      const base = typeof req.baseSeq === 'number' && Number.isFinite(req.baseSeq) ? req.baseSeq : 0;
      const nextSeq = Math.max(this.seq, base) + 1;
      this.seq = nextSeq;
      const full: ChartFullPayload = {
        bars: req.bars,
        plots: result.plots,
        series: result.series,
        drawings: result.drawings,
        seq: nextSeq,
      };
      deps.bus.notifyChart({
        type: 'chart.full',
        payload: full,
        seriesKey: req.seriesKey,
      });

      const runId = deps.results.publish({
        status: 'success',
        focus: req.focus,
        seriesKey: req.seriesKey,
        engineId: req.engineId,
        plots: result.plots,
        series: result.series,
        meta: { ...result.meta, ms },
      });

      safeLog(deps.output, `run ok epoch=${my} ms=${Math.round(ms)} runId=${runId} seq=${nextSeq}`);
      this.emitStatus(deps, {
        epoch: my,
        state: 'ok',
        message: `ms=${Math.round(ms)}`,
        seriesKey: req.seriesKey,
      });
      return { ok: true, epoch: my, runId, result, seq: nextSeq };
    } catch (e) {
      if (my !== this.epoch) {
        safeLog(deps.output, `drop stale epoch ${my}`);
        return { ok: false, epoch: my, reason: 'stale' };
      }
      const error = scrubSecrets(e instanceof Error ? e.message : String(e));
      safeLog(deps.output, `run error epoch=${my}: ${error}`);
      this.emitStatus(deps, {
        epoch: my,
        state: 'error',
        message: error,
        seriesKey: req.seriesKey,
      });
      this.setDiags(deps, req.uri, [{ message: error, severity: 'error' }]);
      return { ok: false, epoch: my, reason: 'error', error };
    } finally {
      if (this.inflight === localAbort) this.inflight = undefined;
    }
  }

  private setDiags(
    deps: RunDeps,
    uri: string | undefined,
    items: RunDiagnostic[],
  ): void {
    try {
      deps.diagnostics.set(uri, items);
    } catch {
      // ignore
    }
  }

  private emitStatus(
    deps: RunDeps,
    payload: HostRunStatusPayload & { seriesKey?: string },
  ): void {
    try {
      const { seriesKey, ...status } = payload;
      deps.bus.notifyChart({
        type: 'host.run.status',
        payload: status,
        seriesKey,
      });
      deps.onRunStatus?.(status);
    } catch {
      // optional path
    }
  }
}
