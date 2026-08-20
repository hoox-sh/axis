// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Drive a strategy study: prefer pyne `POST /optimize`, else client random loop.
 *
 * @module optimize/client
 */

import { buildStrategyReport, type StrategyStats } from '../results/strategy';
import { runScript } from '../indicators/runner';
import { getActiveEngine, getActiveEngineConfig } from '../plugins/active';
import type { Bar } from '../store/types';
import { beginStudy, endStudy } from './guard';
import { randomAssignment, toPyneSpace } from './space';
import type { ParamSpec, ParamValue } from './types';
import {
  MAX_ENGINE_RUNS,
  MAX_TRIALS,
  type ObjectiveId,
  type SamplerId,
  type StudySnapshot,
  type TrialRow,
  type ValidationSpec,
} from './types';

const REJECT = Number.NEGATIVE_INFINITY;

export interface RunStudyOpts {
  script: string;
  bars: Bar[];
  params: ParamSpec[];
  nTrials: number;
  sampler: SamplerId;
  objective: ObjectiveId;
  validation: ValidationSpec;
  minTrades: number;
  signal?: AbortSignal;
  onTrial?: (row: TrialRow, snap: Partial<StudySnapshot>) => void;
  /** Current Script Settings — merged under each trial (searched keys win). */
  fixedInputs?: Record<string, unknown>;
}

function scoreStats(stats: StrategyStats | null | undefined, objective: ObjectiveId, minTrades: number): number {
  if (!stats || stats.trades < minTrades) return REJECT;
  if (objective === 'net_pnl') return stats.totalPnl;
  if (objective === 'profit_factor') {
    const pf = stats.profitFactor;
    return Number.isFinite(pf) ? pf : pf > 0 ? 1e6 : REJECT;
  }
  if (objective === 'calmar') return stats.totalPnl / Math.max(stats.maxDD, 1e-9);
  const sign = stats.totalPnl >= 0 ? 1 : -1;
  return (sign * Math.abs(stats.totalPnl) * Math.sqrt(Math.max(stats.trades, 1))) / (1 + stats.maxDD);
}

function holdoutOk(n: number, frac: number): boolean {
  const f = frac >= 0.05 && frac <= 0.8 ? frac : 0.3;
  const testN = Math.max(1, Math.round(n * f));
  return n - testN >= 2;
}

function sliceBars(bars: Bar[], start: number, end: number): Bar[] {
  return bars.slice(start, end);
}

function engineEndpoint(): string {
  const cfg = getActiveEngineConfig() || {};
  return String(cfg.endpoint || '').replace(/\/$/, '');
}

function engineAuthHeaders(): Record<string, string> {
  const cfg = getActiveEngineConfig() || {};
  const key = String(cfg.apiKey || '').trim();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) {
    headers['X-API-Key'] = key;
    headers.Authorization = `Bearer ${key}`;
  }
  return headers;
}

function mapPyneStudy(raw: Record<string, unknown>, backend: 'pyne'): StudySnapshot {
  const val = (raw.validation || {}) as Record<string, unknown>;
  const trials = Array.isArray(raw.trials) ? raw.trials : [];
  return {
    status: String(raw.status || 'success'),
    sampler: String(raw.sampler || ''),
    objective: String(raw.objective || ''),
    validation: {
      mode: (val.mode as ValidationSpec['mode']) || 'holdout',
      holdoutFrac: Number(val.holdout_frac ?? 0.3),
      trainBars: Number(val.train_bars ?? 200),
      testBars: Number(val.test_bars ?? 50),
      stepBars: Number(val.step_bars ?? 50),
    },
    nTrials: Number(raw.n_trials ?? trials.length),
    trials: trials.map((t) => {
      const row = t as Record<string, unknown>;
      return {
        index: Number(row.index ?? 0),
        params: (row.params || {}) as TrialRow['params'],
        isStats: (row.is_stats as TrialRow['isStats']) ?? null,
        oosStats: (row.oos_stats as TrialRow['oosStats']) ?? null,
        isScore: row.is_score == null ? null : Number(row.is_score),
        oosScore: row.oos_score == null ? null : Number(row.oos_score),
        error: row.error == null ? null : String(row.error),
        engineRuns: Number(row.engine_runs ?? 0),
        ms: Number(row.ms ?? 0),
      };
    }),
    bestIndex: raw.best_index == null ? null : Number(raw.best_index),
    bestParams: (raw.best_params as StudySnapshot['bestParams']) ?? null,
    bestIsScore: raw.best_is_score == null ? null : Number(raw.best_is_score),
    bestOosScore: raw.best_oos_score == null ? null : Number(raw.best_oos_score),
    engineRuns: Number(raw.engine_runs ?? 0),
    ms: Number(raw.ms ?? 0),
    warning: raw.warning == null ? null : String(raw.warning),
    error: raw.error == null ? raw.message == null ? null : String(raw.message) : String(raw.error),
    backend,
  };
}

async function tryPyneOptimize(opts: RunStudyOpts): Promise<StudySnapshot | null> {
  const engine = getActiveEngine();
  if (engine.id === 'pyodide') return null;
  const endpoint = engineEndpoint();
  if (!endpoint || /pyodide/i.test(endpoint)) return null;
  let libraries: unknown[] | undefined;
  try {
    const { resolveLibrariesForScript } = await import('../storage/library-publish-io');
    const resolved = await resolveLibrariesForScript(opts.script);
    if (resolved.libraries.length) libraries = resolved.libraries;
  } catch {
    /* optional */
  }
  const body = {
    script: opts.script,
    data: opts.bars,
    space: toPyneSpace(opts.params),
    n_trials: Math.min(MAX_TRIALS, Math.max(1, opts.nTrials)),
    sampler: opts.sampler,
    objective: opts.objective,
    validation: {
      mode: opts.validation.mode,
      holdout_frac: opts.validation.holdoutFrac,
      train_bars: opts.validation.trainBars,
      test_bars: opts.validation.testBars,
      step_bars: opts.validation.stepBars,
    },
    min_trades: opts.minTrades,
    oos_every_trial: true,
    ...(opts.fixedInputs && Object.keys(opts.fixedInputs).length
      ? { fixed_inputs: opts.fixedInputs }
      : {}),
    ...(libraries?.length ? { libraries } : {}),
  };
  try {
    const res = await fetch(`${endpoint}/optimize`, {
      method: 'POST',
      headers: engineAuthHeaders(),
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (res.status === 404) return null;
    const text = await res.text();
    if (!text.trim()) return null;
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }
    if (json.code === 'UNKNOWN_FIELDS' || /not found|404/i.test(String(json.message || ''))) {
      return null;
    }
    return mapPyneStudy(json, 'pyne');
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    return null;
  }
}

async function evalWindow(
  script: string,
  bars: Bar[],
  inputs: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ stats: StrategyStats | null; error?: string }> {
  const result = await runScript(script, {
    isolate: true,
    silent: true,
    claimEpoch: false,
    inputs,
    // Study source is already rewritten; empty bag = do not merge editor leftovers.
    strategyProps: {},
    bars,
    signal,
  });
  if (result.status === 'error') {
    return { stats: null, error: result.error || 'engine error' };
  }
  const { stats } = buildStrategyReport(result.events || [], bars);
  return { stats };
}

function scoreFinite(n: number | null | undefined): boolean {
  return typeof n === 'number' && Number.isFinite(n);
}

function pickWinner(trials: TrialRow[], mode: ValidationSpec['mode']): TrialRow | null {
  const ok = trials.filter(
    (t) => !t.error && (scoreFinite(t.oosScore) || scoreFinite(t.isScore)),
  );
  if (!ok.length) return null;
  const key = (t: TrialRow): [number, number] => {
    const oos = t.oosScore ?? REJECT;
    const inn = t.isScore ?? REJECT;
    return mode === 'in-sample' ? [inn, oos] : [oos, inn];
  };
  return ok.reduce((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (kb[0] !== ka[0]) return kb[0] > ka[0] ? b : a;
    return kb[1] > ka[1] ? b : a;
  });
}

async function runClientStudy(opts: RunStudyOpts): Promise<StudySnapshot> {
  const n = Math.min(MAX_TRIALS, Math.max(1, opts.nTrials));
  const bars = opts.bars;
  const enabled = opts.params.filter((p) => p.enabled !== false);
  const trials: TrialRow[] = [];
  let engineRuns = 0;
  const t0 = performance.now();
  let warning: string | null = null;
  if (opts.validation.mode === 'in-sample') {
    warning = 'In-sample only overfits. Prefer Holdout.';
  }
  if (opts.sampler === 'tpe') {
    warning = (warning ? `${warning} ` : '') + 'TPE needs pyne POST /optimize; using random.';
  }
  if (opts.sampler === 'grid') {
    warning = (warning ? `${warning} ` : '') + 'Grid needs pyne POST /optimize; using random.';
  }

  const nBars = bars.length;
  const frac = opts.validation.holdoutFrac;
  const testN = Math.max(1, Math.round(nBars * (frac >= 0.05 && frac <= 0.8 ? frac : 0.3)));
  const split = nBars - testN;
  const holdoutOk = opts.validation.mode !== 'holdout' || split >= 2;

  for (let i = 0; i < n; i++) {
    if (opts.signal?.aborted) break;
    const params: Record<string, ParamValue> = {
      ...(opts.fixedInputs as Record<string, ParamValue> || {}),
      ...randomAssignment(enabled),
    };
    let isStats: StrategyStats | null = null;
    let oosStats: StrategyStats | null = null;
    let error: string | null = null;
    if (opts.validation.mode === 'in-sample') {
      engineRuns += 1;
      const r = await evalWindow(opts.script, bars, params, opts.signal);
      isStats = r.stats;
      error = r.error ?? null;
    } else if (opts.validation.mode === 'holdout') {
      if (!holdoutOk) error = 'holdout split needs more bars';
      else {
        engineRuns += 2;
        const a = await evalWindow(opts.script, sliceBars(bars, 0, split), params, opts.signal);
        isStats = a.stats;
        if (a.error) error = a.error;
        else {
          const b = await evalWindow(opts.script, sliceBars(bars, split, nBars), params, opts.signal);
          oosStats = b.stats;
          if (b.error) error = b.error;
        }
      }
    } else {
      const train = Math.max(2, opts.validation.trainBars);
      const test = Math.max(1, opts.validation.testBars);
      const step = Math.max(1, opts.validation.stepBars);
      const isRows: StrategyStats[] = [];
      const oosRows: StrategyStats[] = [];
      let start = train;
      while (start + test <= nBars && engineRuns < MAX_ENGINE_RUNS) {
        if (opts.signal?.aborted) break;
        engineRuns += 2;
        const a = await evalWindow(opts.script, sliceBars(bars, 0, start), params, opts.signal);
        const b = await evalWindow(
          opts.script,
          sliceBars(bars, start, start + test),
          params,
          opts.signal,
        );
        if (a.error || b.error) {
          error = a.error || b.error || null;
          break;
        }
        if (a.stats) isRows.push(a.stats);
        if (b.stats) oosRows.push(b.stats);
        start += step;
      }
      if (!error && isRows.length) {
        isStats = averageStats(isRows);
        oosStats = oosRows.length ? averageStats(oosRows) : null;
      }
      if (!isRows.length && !error) error = 'walk-forward produced no windows';
    }
    const row: TrialRow = {
      index: i,
      params,
      isStats,
      oosStats,
      isScore: error ? null : scoreStats(isStats, opts.objective, opts.minTrades),
      oosScore: error || !oosStats ? null : scoreStats(oosStats, opts.objective, opts.minTrades),
      error,
      engineRuns: 0,
      ms: 0,
    };
    trials.push(row);
    opts.onTrial?.(row, { trials: [...trials], engineRuns });
  }

  const winner = pickWinner(trials, opts.validation.mode);
  return {
    status: opts.signal?.aborted ? 'cancelled' : 'success',
    sampler: opts.sampler === 'tpe' ? 'random' : opts.sampler,
    objective: opts.objective,
    validation: opts.validation,
    nTrials: n,
    trials,
    bestIndex: winner?.index ?? null,
    bestParams: winner?.params ?? null,
    bestIsScore: winner?.isScore ?? null,
    bestOosScore: winner?.oosScore ?? null,
    engineRuns,
    ms: performance.now() - t0,
    warning,
    backend: 'client',
  };
}

function averageStats(rows: StrategyStats[]): StrategyStats {
  const n = rows.length || 1;
  const acc: StrategyStats = {
    totalPnl: 0,
    winRate: 0,
    profitFactor: 0,
    avgTrade: 0,
    avgWin: 0,
    avgLoss: 0,
    maxDD: 0,
    wins: 0,
    losses: 0,
    trades: 0,
  };
  for (const s of rows) {
    acc.totalPnl += s.totalPnl;
    acc.winRate += s.winRate;
    acc.profitFactor += Number.isFinite(s.profitFactor) ? s.profitFactor : 0;
    acc.avgTrade += s.avgTrade;
    acc.avgWin += s.avgWin;
    acc.avgLoss += s.avgLoss;
    acc.maxDD += s.maxDD;
    acc.wins += s.wins;
    acc.losses += s.losses;
    acc.trades += s.trades;
  }
  acc.totalPnl /= n;
  acc.winRate /= n;
  acc.profitFactor /= n;
  acc.avgTrade /= n;
  acc.avgWin /= n;
  acc.avgLoss /= n;
  acc.maxDD /= n;
  acc.wins = Math.round(acc.wins / n);
  acc.losses = Math.round(acc.losses / n);
  acc.trades = Math.round(acc.trades / n);
  return acc;
}

export async function runHpoStudy(opts: RunStudyOpts): Promise<StudySnapshot> {
  const n = Math.min(MAX_TRIALS, Math.max(1, opts.nTrials));
  const est =
    opts.validation.mode === 'in-sample'
      ? n
      : opts.validation.mode === 'holdout'
        ? n * 2
        : n * 4;
  if (est > MAX_ENGINE_RUNS) {
    return {
      status: 'error',
      sampler: opts.sampler,
      objective: opts.objective,
      validation: opts.validation,
      nTrials: n,
      trials: [],
      engineRuns: 0,
      ms: 0,
      error: `TOO_MANY_RUNS: estimated ${est} (cap ${MAX_ENGINE_RUNS})`,
    };
  }
  beginStudy();
  try {
    const remote = await tryPyneOptimize(opts);
    if (remote) return remote;
    return await runClientStudy(opts);
  } finally {
    endStudy();
  }
}

export function persistStudy(snap: StudySnapshot | null): void {
  try {
    if (!snap) {
      localStorage.removeItem('pynescript.axis.hpo.v1');
      return;
    }
    localStorage.setItem('pynescript.axis.hpo.v1', JSON.stringify(snap));
  } catch {
    /* quota */
  }
}

export function loadPersistedStudy(): StudySnapshot | null {
  try {
    const raw = localStorage.getItem('pynescript.axis.hpo.v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StudySnapshot;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** @internal — exported for tests */
export function _scoreStatsForTests(
  stats: StrategyStats,
  objective: ObjectiveId,
  minTrades: number,
): number {
  return scoreStats(stats, objective, minTrades);
}

/** @internal */
export function _holdoutOk(n: number, frac: number): boolean {
  return holdoutOk(n, frac);
}

/** @internal */
export function _pickWinnerForTests(
  trials: TrialRow[],
  mode: ValidationSpec['mode'],
): TrialRow | null {
  return pickWinner(trials, mode);
}
