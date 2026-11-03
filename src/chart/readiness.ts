// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Chart Generation Readiness — full-chart splash until OHLCV (+ visible
 * scripts) for generation G have settled. Live tips may update after reveal;
 * foreign generations must not paint.
 *
 * @module chart/readiness
 */

import { createStore } from 'solid-js/store';

/** Splash / settle phases for one chart generation. */
export type ChartReadinessPhase =
  | 'ready'
  | 'loading-data'
  | 'binding-engine'
  | 'applying-scripts'
  | 'error';

export interface ChartReadinessState {
  /** Monotonic generation; matches {@link beginChartReadiness} / load race token. */
  generation: number;
  phase: ChartReadinessPhase;
  symbol: string;
  interval: string;
  source: string;
  /** Visible scripts expected to settle for this generation (0 = OHLCV-only). */
  scriptsTotal: number;
  /** Scripts that reported ok or fail for this generation. */
  scriptsSettled: number;
  title: string;
  sentence: string;
}

const PHASE_TITLE: Record<ChartReadinessPhase, string> = {
  ready: '',
  'loading-data': 'Loading market data',
  'binding-engine': 'Binding engine',
  'applying-scripts': 'Applying scripts',
  error: 'Chart failed to load',
};

const [readiness, setReadiness] = createStore<ChartReadinessState>({
  generation: 0,
  phase: 'ready',
  symbol: '',
  interval: '',
  source: '',
  scriptsTotal: 0,
  scriptsSettled: 0,
  title: '',
  sentence: '',
});

/** Ids already counted for the active applying-scripts generation. */
const settledIds = new Set<string>();

/**
 * Generation that may accept venue/engine live paints. Cleared on
 * {@link beginChartReadiness}; set on {@link revealChart}. Foreign or
 * pre-reveal ticks must not mutate the chart.
 */
let liveArmedGeneration = 0;

/** Identity from the previous ready/loading generation (for session invalidate). */
let priorIdentity: { symbol: string; interval: string; source: string } | null = null;

/** Reactive readiness snapshot (Solid store). */
export function getChartReadiness(): ChartReadinessState {
  return readiness;
}

/**
 * Sanitized readiness strip for MCP `chart.get` / `chart.lag` (and tests).
 * No secrets — generation, phase, script settle counts, live-paint arm.
 */
export function chartReadinessSnapshot(): {
  generation: number;
  phase: ChartReadinessPhase;
  symbol: string;
  interval: string;
  source: string;
  scriptsTotal: number;
  scriptsSettled: number;
  blocking: boolean;
  livePaintAllowed: boolean;
  liveArmedGeneration: number;
} {
  return {
    generation: readiness.generation,
    phase: readiness.phase,
    symbol: readiness.symbol,
    interval: readiness.interval,
    source: readiness.source,
    scriptsTotal: readiness.scriptsTotal,
    scriptsSettled: readiness.scriptsSettled,
    blocking: readiness.phase !== 'ready',
    livePaintAllowed: isLivePaintAllowed(),
    liveArmedGeneration: liveArmedGeneration,
  };
}

/** True when the shell may show the painted chart for the current generation. */
export function isChartReady(): boolean {
  return readiness.phase === 'ready';
}

/** True when the full-chart HooxLoader overlay should cover the plot. */
export function isChartReadinessBlocking(): boolean {
  return readiness.phase !== 'ready';
}

export function chartReadinessStillCurrent(generation: number): boolean {
  return generation > 0 && generation === readiness.generation;
}

/**
 * True when venue / engine live tips may paint. After a chart load claims a
 * generation, paints stay blocked until {@link revealChart} arms that
 * generation. Generation 0 (no load claimed — boot / tests) stays open while
 * phase is ready.
 */
export function isLivePaintAllowed(): boolean {
  if (readiness.phase !== 'ready') return false;
  if (readiness.generation === 0) return true;
  return liveArmedGeneration > 0 && liveArmedGeneration === readiness.generation;
}

/** Generation currently armed for live paint (0 = none). */
export function chartLiveArmedGeneration(): number {
  return liveArmedGeneration;
}

/** Prior chart identity before the latest {@link beginChartReadiness} claim. */
export function priorChartReadinessIdentity(): {
  symbol: string;
  interval: string;
  source: string;
} | null {
  return priorIdentity;
}

function phaseSentence(
  phase: ChartReadinessPhase,
  symbol: string,
  interval: string,
  scriptsSettled: number,
  scriptsTotal: number,
): string {
  const id = [symbol, interval].filter(Boolean).join(' ');
  if (phase === 'applying-scripts' && scriptsTotal > 0) {
    return id
      ? `${id} · ${scriptsSettled}/${scriptsTotal} scripts`
      : `${scriptsSettled}/${scriptsTotal} scripts`;
  }
  return id;
}

/**
 * Claim a new chart generation (symbol / interval / source / reload).
 * Call at the start of {@link loadSymbolData} with the same race token.
 */
export function beginChartReadiness(
  generation: number,
  identity: { symbol: string; interval: string; source: string },
): void {
  const symbol = String(identity.symbol || '');
  const interval = String(identity.interval || '');
  const source = String(identity.source || '');
  if (readiness.generation > 0 && (readiness.symbol || readiness.interval || readiness.source)) {
    priorIdentity = {
      symbol: readiness.symbol,
      interval: readiness.interval,
      source: readiness.source,
    };
  } else {
    priorIdentity = null;
  }
  liveArmedGeneration = 0;
  settledIds.clear();
  setReadiness({
    generation: Math.max(0, Math.floor(generation)),
    phase: 'loading-data',
    symbol,
    interval,
    source,
    scriptsTotal: 0,
    scriptsSettled: 0,
    title: PHASE_TITLE['loading-data'],
    sentence: phaseSentence('loading-data', symbol, interval, 0, 0),
  });
}

/** Advance phase for the active generation (no-op when stale). */
export function setChartReadinessPhase(
  generation: number,
  phase: ChartReadinessPhase,
  opts?: { scriptsTotal?: number; message?: string },
): void {
  if (!chartReadinessStillCurrent(generation)) return;
  const scriptsTotal =
    opts?.scriptsTotal != null
      ? Math.max(0, Math.floor(opts.scriptsTotal))
      : readiness.scriptsTotal;
  if (phase === 'applying-scripts') settledIds.clear();
  const settled = phase === 'applying-scripts' ? 0 : readiness.scriptsSettled;
  setReadiness({
    phase,
    scriptsTotal,
    scriptsSettled: settled,
    title: opts?.message?.trim() || PHASE_TITLE[phase],
    sentence:
      phase === 'error' && opts?.message?.trim()
        ? opts.message.trim()
        : phaseSentence(phase, readiness.symbol, readiness.interval, settled, scriptsTotal),
  });
}

/** Record one visible script settled (ok or fail) for generation G. */
export function noteChartScriptSettled(generation: number, indicatorId?: string): void {
  if (!chartReadinessStillCurrent(generation)) return;
  if (readiness.phase !== 'applying-scripts') return;
  const id = String(indicatorId || '').trim();
  if (id) {
    if (settledIds.has(id)) return;
    settledIds.add(id);
  }
  const scriptsSettled = Math.min(readiness.scriptsTotal, readiness.scriptsSettled + 1);
  setReadiness({
    scriptsSettled,
    sentence: phaseSentence(
      'applying-scripts',
      readiness.symbol,
      readiness.interval,
      scriptsSettled,
      readiness.scriptsTotal,
    ),
  });
}

/**
 * Mark every expected script settled in one step (backfill after a forced
 * reapply so a mid-loop supersede cannot trap the splash).
 */
export function settleAllChartScripts(generation: number): void {
  if (!chartReadinessStillCurrent(generation)) return;
  setReadiness({
    scriptsSettled: readiness.scriptsTotal,
    sentence: phaseSentence(
      'applying-scripts',
      readiness.symbol,
      readiness.interval,
      readiness.scriptsTotal,
      readiness.scriptsTotal,
    ),
  });
}

/** Reveal the chart for generation G (OHLCV + scripts settled, or error path). */
export function revealChart(generation: number): void {
  if (!chartReadinessStillCurrent(generation)) return;
  liveArmedGeneration = generation;
  setReadiness({
    phase: 'ready',
    title: '',
    sentence: '',
    scriptsSettled: readiness.scriptsTotal,
  });
}

/** Hard fail for generation G — keep overlay with error tone via ChartHost. */
export function failChartReadiness(generation: number, message: string): void {
  if (!chartReadinessStillCurrent(generation)) return;
  liveArmedGeneration = 0;
  const msg = String(message || 'Chart failed to load').slice(0, 160);
  setReadiness({
    phase: 'error',
    title: PHASE_TITLE.error,
    sentence: msg,
  });
}

/** @internal test helper */
export function _resetChartReadinessForTests(): void {
  settledIds.clear();
  liveArmedGeneration = 0;
  priorIdentity = null;
  setReadiness({
    generation: 0,
    phase: 'ready',
    symbol: '',
    interval: '',
    source: '',
    scriptsTotal: 0,
    scriptsSettled: 0,
    title: '',
    sentence: '',
  });
}
