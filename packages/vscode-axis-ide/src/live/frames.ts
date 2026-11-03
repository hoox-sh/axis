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
 * StreamLiveWire-compat frame → chart.full / chart.delta payloads.
 * Accepts top-level or nested `payload` shapes; snake_case `base_index`.
 */

import type { ChartDeltaPayload, ChartFullPayload } from '../protocol';

export type WireFrameKind = 'full' | 'delta' | 'close' | 'status' | 'unknown';

export type NormalizedWireFrame =
  | {
      kind: 'full';
      seq: number;
      bars: unknown;
      plots?: unknown;
      seriesKey?: string;
    }
  | {
      kind: 'delta';
      seq: number;
      baseIndex: number;
      tail: unknown;
      plots?: unknown;
      seriesKey?: string;
    }
  | {
      kind: 'close';
      seq: number | null;
      bar: Record<string, number> | null;
      seriesKey?: string;
    }
  | { kind: 'status'; status: string }
  | { kind: 'unknown' };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** `series:binance|spot|BTC/USDT|1m` → `binance|spot|BTC/USDT|1m`. */
export function seriesKeyFromFrameId(id: unknown): string | undefined {
  if (typeof id !== 'string' || !id) return undefined;
  if (id.startsWith('series:')) return id.slice('series:'.length) || undefined;
  if (id.includes('|')) return id;
  return undefined;
}

function readBody(frame: Record<string, unknown>): Record<string, unknown> {
  if (isPlainObject(frame.payload)) return frame.payload;
  return frame;
}

function readType(frame: Record<string, unknown>): string {
  const t = frame.type ?? frame.kind;
  return typeof t === 'string' ? t.trim().toLowerCase() : '';
}

function barFromOhlcv(time: number, ohlcv: Record<string, unknown>): Record<string, number> | null {
  const open = num(ohlcv.open) ?? num(ohlcv.o);
  const high = num(ohlcv.high) ?? num(ohlcv.h);
  const low = num(ohlcv.low) ?? num(ohlcv.l);
  const close = num(ohlcv.close) ?? num(ohlcv.c);
  if (open === null || high === null || low === null || close === null) return null;
  const volume = num(ohlcv.volume) ?? num(ohlcv.v);
  const bar: Record<string, number> = { time, open, high, low, close };
  if (volume !== null) bar.volume = volume;
  return bar;
}

/**
 * Normalize one untrusted live WS frame. Never throws.
 */
export function normalizeLiveFrame(raw: unknown): NormalizedWireFrame {
  try {
    if (!isPlainObject(raw)) return { kind: 'unknown' };
    const type = readType(raw);
    const body = readBody(raw);
    const seriesKey = seriesKeyFromFrameId(raw.id) ?? seriesKeyFromFrameId(body.id);

    if (type === 'status') {
      const status =
        typeof body.status === 'string'
          ? body.status
          : typeof raw.status === 'string'
            ? raw.status
            : '';
      return { kind: 'status', status };
    }

    if (type === 'full') {
      const seq = num(raw.seq) ?? num(body.seq);
      if (seq === null) return { kind: 'unknown' };
      const bars = body.bars ?? raw.bars ?? [];
      const plots = 'plots' in body ? body.plots : 'plots' in raw ? raw.plots : undefined;
      return plots !== undefined
        ? { kind: 'full', seq, bars, plots, seriesKey }
        : { kind: 'full', seq, bars, seriesKey };
    }

    if (type === 'delta') {
      const seq = num(raw.seq) ?? num(body.seq);
      if (seq === null) return { kind: 'unknown' };
      const baseIndex =
        num(body.baseIndex) ??
        num(body.base_index) ??
        num(raw.baseIndex) ??
        num(raw.base_index);
      const tail = body.tail ?? body.bars ?? raw.tail ?? raw.bars;
      if (baseIndex === null || tail === undefined) return { kind: 'unknown' };
      const plots = 'plots' in body ? body.plots : 'plots' in raw ? raw.plots : undefined;
      return plots !== undefined
        ? { kind: 'delta', seq, baseIndex, tail, plots, seriesKey }
        : { kind: 'delta', seq, baseIndex, tail, seriesKey };
    }

    if (type === 'close') {
      const seq = num(raw.seq) ?? num(body.seq);
      const time = num(body.time) ?? num(raw.time);
      let ohlcv: Record<string, unknown> | null = null;
      if (isPlainObject(body.ohlcv)) ohlcv = body.ohlcv;
      else if (isPlainObject(raw.ohlcv)) ohlcv = raw.ohlcv;
      let bar: Record<string, number> | null = null;
      if (time !== null && ohlcv) {
        bar = barFromOhlcv(time, ohlcv);
      } else if (time !== null && isPlainObject(body)) {
        bar = barFromOhlcv(time, body);
      }
      return { kind: 'close', seq, bar, seriesKey };
    }

    return { kind: 'unknown' };
  } catch {
    return { kind: 'unknown' };
  }
}

/** Build chart.full payload from a normalized full frame. */
export function toChartFullPayload(frame: Extract<NormalizedWireFrame, { kind: 'full' }>): ChartFullPayload {
  const payload: ChartFullPayload = { bars: frame.bars, seq: frame.seq };
  if (frame.plots !== undefined) payload.plots = frame.plots;
  return payload;
}

/** Build chart.delta payload from a normalized delta frame. */
export function toChartDeltaPayload(
  frame: Extract<NormalizedWireFrame, { kind: 'delta' }>,
): ChartDeltaPayload {
  const payload: ChartDeltaPayload = {
    baseIndex: frame.baseIndex,
    tail: frame.tail,
    seq: frame.seq,
  };
  if (frame.plots !== undefined) payload.plots = frame.plots;
  return payload;
}
