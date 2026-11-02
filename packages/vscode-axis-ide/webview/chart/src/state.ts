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
 * Pure chart webview reducer — apply chart.init / chart.full / chart.delta.
 * Bar wire shape matches host mock: `{ time, open, high, low, close, volume? }`
 * (also accepts short keys t/o/h/l/c/v).
 *
 * Seq gap on `chart.delta` → `requestReload: true` (post `chart.requestReload`).
 */

export interface ChartBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface ChartViewState {
  seriesKey: string;
  theme: string;
  panes: unknown;
  bars: ChartBar[];
  seq: number;
  ready: boolean;
}

/** Outcome of one host message — gap sets `requestReload`. */
export type ChartReduceOutcome = {
  state: ChartViewState;
  /** Webview should post `chart.requestReload` (seq gap / unsafe delta). */
  requestReload: boolean;
};

export function initialChartState(): ChartViewState {
  return {
    seriesKey: '',
    theme: '',
    panes: null,
    bars: [],
    seq: 0,
    ready: false,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Normalize one bar; returns null when OHLC/time are unusable. */
export function normalizeBar(raw: unknown): ChartBar | null {
  try {
    if (!isPlainObject(raw)) return null;
    const time = num(raw.time) ?? num(raw.t);
    const open = num(raw.open) ?? num(raw.o);
    const high = num(raw.high) ?? num(raw.h);
    const low = num(raw.low) ?? num(raw.l);
    const close = num(raw.close) ?? num(raw.c);
    if (
      time === null ||
      open === null ||
      high === null ||
      low === null ||
      close === null
    ) {
      return null;
    }
    const volume = num(raw.volume) ?? num(raw.v) ?? undefined;
    const bar: ChartBar = { time, open, high, low, close };
    if (volume !== undefined) bar.volume = volume;
    return bar;
  } catch {
    return null;
  }
}

/** Replace-series normalize for chart.full.bars (skips invalid entries). */
export function normalizeBars(raw: unknown): ChartBar[] {
  try {
    if (!Array.isArray(raw)) return [];
    const out: ChartBar[] = [];
    for (const entry of raw) {
      const bar = normalizeBar(entry);
      if (bar) out.push(bar);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Merge `tail` onto `bars` at `baseIndex` (slice head + concat tail).
 * Returns null when baseIndex is out of range.
 */
export function mergeBarTail(
  bars: ChartBar[],
  baseIndex: number,
  tail: ChartBar[],
): ChartBar[] | null {
  if (!Number.isFinite(baseIndex) || baseIndex < 0 || baseIndex > bars.length) {
    return null;
  }
  if (baseIndex === 0) return tail.slice();
  return bars.slice(0, baseIndex).concat(tail);
}

/**
 * Classify delta seq vs last applied seq.
 * - continuous: seq === lastSeq + 1
 * - duplicate: seq === lastSeq
 * - gap: anything else (including delta before first full)
 */
export function classifyDeltaSeq(
  lastSeq: number,
  seq: number,
): 'continuous' | 'duplicate' | 'gap' {
  if (!(typeof lastSeq === 'number' && Number.isFinite(lastSeq))) return 'gap';
  if (!(typeof seq === 'number' && Number.isFinite(seq))) return 'gap';
  if (lastSeq <= 0) return 'gap';
  if (seq === lastSeq + 1) return 'continuous';
  if (seq === lastSeq) return 'duplicate';
  return 'gap';
}

function applyDelta(
  state: ChartViewState,
  payload: Record<string, unknown>,
): ChartReduceOutcome {
  const seq = num(payload.seq);
  const baseIndex = num(payload.baseIndex) ?? num(payload.base_index);
  if (seq === null || baseIndex === null || !('tail' in payload)) {
    // Malformed — ignore without thrashing reload.
    return { state, requestReload: false };
  }

  const kind = classifyDeltaSeq(state.seq, seq);
  if (kind === 'duplicate') {
    return { state, requestReload: false };
  }
  if (kind === 'gap') {
    return { state, requestReload: true };
  }

  const tail = normalizeBars(payload.tail);
  const merged = mergeBarTail(state.bars, baseIndex, tail);
  if (merged === null) {
    return { state, requestReload: true };
  }
  return {
    state: { ...state, bars: merged, seq },
    requestReload: false,
  };
}

/**
 * Apply one decoded host message. Unknown types leave state unchanged.
 * `chart.full` replaces `bars` + `seq`.
 * `chart.delta` merges `tail` at `baseIndex`; seq gap → `requestReload`.
 */
export function applyChartHostMessage(
  state: ChartViewState,
  type: string,
  payload: Record<string, unknown>,
): ChartReduceOutcome {
  try {
    if (type === 'chart.init') {
      return {
        state: {
          ...state,
          ready: true,
          // Clear prior series on re-init; chart.full (possibly empty) follows.
          bars: [],
          seq: 0,
          theme: typeof payload.theme === 'string' ? payload.theme : state.theme,
          seriesKey:
            typeof payload.seriesKey === 'string' ? payload.seriesKey : state.seriesKey,
          panes: 'panes' in payload ? payload.panes : state.panes,
        },
        requestReload: false,
      };
    }
    if (type === 'chart.full') {
      const seq = num(payload.seq);
      return {
        state: {
          ...state,
          bars: normalizeBars(payload.bars),
          seq: seq === null ? state.seq : seq,
        },
        requestReload: false,
      };
    }
    if (type === 'chart.delta') {
      return applyDelta(state, payload);
    }
    return { state, requestReload: false };
  } catch {
    return { state, requestReload: false };
  }
}

/**
 * Apply one decoded host message (state only). Prefer {@link applyChartHostMessage}
 * when the caller must honour seq-gap → `chart.requestReload`.
 */
export function reduceChartMessage(
  state: ChartViewState,
  type: string,
  payload: Record<string, unknown>,
): ChartViewState {
  return applyChartHostMessage(state, type, payload).state;
}
