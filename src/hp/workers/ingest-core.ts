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
 * Pure ingest decode: JSON `/ws/live` or AXB1 bytes → Redesign2 frames.
 *
 * No Worker, no WebSocket. The ingest worker and unit tests share this.
 *
 * @module hp/workers/ingest-core
 */

import {
  normalizeRedesign2Frame,
  stripSeqAck,
  validateRedesign2Frame,
  type Redesign2Frame,
} from '../../engine/frames';
import type { WireFrame } from '../../engine/live-wire';
import { Axb1Opcode, PRICE_SCALE_DEFAULT, TipMask, ValueKind } from '../axb1/constants';
import { decodeFrame, looksLikeAxb1 } from '../axb1/decode';
import { fnv1a32 } from '../axb1/hash';
import { ticksToPrice } from '../axb1/ticks';
import { normalizeBarTime } from '../../data/parse-bars';
import type { Axb1Frame, Axb1OhlcvSnapshot, Axb1TipFields, Axb1Unknown } from '../axb1/types';
import { INGEST_TIP_COALESCE_MS } from './protocol';

/**
 * Outcome of decoding one inbound socket payload. `malformed` and
 * `unknown-opcode` are values, not throws: the worker keeps the socket up and
 * reports them so the host can degrade that subscription only.
 */
export type IngestDecode =
  | { ok: true; kind: 'pong' }
  | { ok: true; kind: 'frames'; frames: Redesign2Frame[] }
  | { ok: true; kind: 'unknown-opcode'; opcode: number; id: string; seq: number }
  | { ok: false; kind: 'malformed'; reason: string };

export { shouldAuthBlock } from '../../engine/frames';

/**
 * Per-subscription OHLCV cursor bar. `closed` is set only by append/close
 * opcodes — a forming tip is never closed.
 */
export type CursorBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Set only by APPEND_BAR / CLOSE_VERIFY. A tip is never closed. */
  closed?: boolean;
};

type SubCursor = {
  count: number;
  closedUpto: number;
  sessionId: string;
  priceScale: number;
  lastBar: CursorBar | null;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Largest plot/series column length in a full payload (0 when none). */
function columnCount(payload: Record<string, unknown>): number {
  let n = 0;
  const series = payload['series'];
  if (isRecord(series)) {
    for (const values of Object.values(series)) {
      if (Array.isArray(values) && values.length > n) n = values.length;
    }
  }
  const plots = payload['plots'];
  if (Array.isArray(plots)) {
    for (const column of plots) {
      if (Array.isArray(column) && column.length > n) n = column.length;
    }
  }
  return n;
}

/**
 * Bar count a full frame really carries.
 *
 * A pooled engine session can be longer than the `history_bars` a subscribe
 * asked for, so `payload.count` can disagree with the columns. Live deltas are
 * numbered from the session, not from the request: the AXB1 cursor must follow
 * the payload's real length, or the next tip is reconstructed at the wrong
 * index and the applier rejects every delta as `needs-full`.
 */
function fullBarCount(payload: Record<string, unknown>): number | null {
  const bars = payload['bars'];
  if (Array.isArray(bars) && bars.length > 0) return bars.length;
  const columns = columnCount(payload);
  if (columns > 0) return columns;
  const declared = finiteNumber(payload['count']);
  return declared != null && declared > 0 ? declared : null;
}

function barFromJson(raw: unknown): CursorBar | null {
  if (!isRecord(raw)) return null;
  const time = finiteNumber(raw['time']);
  const open = finiteNumber(raw['open']);
  const high = finiteNumber(raw['high']);
  const low = finiteNumber(raw['low']);
  const close = finiteNumber(raw['close']);
  const volume = finiteNumber(raw['volume']);
  if (
    time == null ||
    open == null ||
    high == null ||
    low == null ||
    close == null ||
    volume == null
  ) {
    return null;
  }
  return { time, open, high, low, close, volume, closed: raw['closed'] === true };
}

function lastJsonBar(payload: Record<string, unknown>): CursorBar | null {
  const bars = payload['bars'];
  if (Array.isArray(bars) && bars.length) return barFromJson(bars[bars.length - 1]);
  return null;
}

/** Subscription / session hashes plus per-sub OHLCV cursor for AXB1 tips. */
export class IngestCursorTable {
  private readonly subIds = new Map<number, string>();
  private readonly sessions = new Map<number, string>();
  private readonly cursors = new Map<string, SubCursor>();

  rememberId(id: string): void {
    if (id) this.subIds.set(fnv1a32(id), id);
  }

  rememberSession(sessionId: string): void {
    if (sessionId) this.sessions.set(fnv1a32(sessionId), sessionId);
  }

  rememberOutbound(frame: WireFrame): void {
    if (frame.id) this.rememberId(frame.id);
    if (frame.sessionId) this.rememberSession(frame.sessionId);
  }

  /**
   * Remember ids and advance the OHLCV/plot cursor from a JSON frame.
   *
   * AXB1 tips (`TIP_UPDATE` / `PLOT_TIP` / `APPEND_BAR`) carry no count of
   * their own — the decoder numbers them from this cursor. A JSON full is the
   * normal fallback when the engine cannot encode a snapshot losslessly (for
   * example a pooled session whose columns are longer than the requested
   * `history_bars`). Without this sync the next binary tip keeps the old
   * count, the applier's positional splice rejects it, and the live wire
   * resubscribes for a full snapshot on every tick.
   */
  rememberInbound(frame: WireFrame): void {
    this.rememberOutbound(frame);
    const id = frame.id;
    if (!id) return;
    const payload = isRecord(frame.payload) ? frame.payload : {};
    const prev = this.cursors.get(id);
    if (frame.type === 'full') {
      const count = fullBarCount(payload);
      if (count == null) return;
      this.cursors.set(id, {
        count,
        closedUpto: finiteNumber(payload['closed_upto']) ?? prev?.closedUpto ?? 0,
        sessionId: frame.sessionId ?? prev?.sessionId ?? '',
        priceScale: prev?.priceScale ?? PRICE_SCALE_DEFAULT,
        lastBar: lastJsonBar(payload) ?? prev?.lastBar ?? null,
      });
      return;
    }
    if (frame.type === 'delta') {
      const count = finiteNumber(payload['count']);
      if (count == null || count < 1) return;
      this.cursors.set(id, {
        count,
        closedUpto: finiteNumber(payload['closed_upto']) ?? prev?.closedUpto ?? 0,
        sessionId: frame.sessionId ?? prev?.sessionId ?? '',
        priceScale: prev?.priceScale ?? PRICE_SCALE_DEFAULT,
        lastBar: lastJsonBar(payload) ?? prev?.lastBar ?? null,
      });
      return;
    }
    if (frame.type === 'close') {
      const ohlcv = isRecord(payload['ohlcv']) ? payload['ohlcv'] : {};
      const bar = barFromJson({ ...ohlcv, time: payload['time'], closed: true });
      if (!bar) return;
      this.cursors.set(id, {
        count: prev?.count ?? 1,
        closedUpto: prev?.closedUpto ?? 0,
        sessionId: frame.sessionId ?? prev?.sessionId ?? '',
        priceScale: prev?.priceScale ?? PRICE_SCALE_DEFAULT,
        lastBar: bar,
      });
    }
  }

  resolveSubId(hash: number): string {
    return this.subIds.get(hash >>> 0) ?? `h:${hash >>> 0}`;
  }

  resolveSession(hash: number): string {
    return this.sessions.get(hash >>> 0) ?? `ax:${hash >>> 0}`;
  }

  cursor(id: string): SubCursor | undefined {
    return this.cursors.get(id);
  }

  setCursor(id: string, next: SubCursor): void {
    this.cursors.set(id, next);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isBlob(raw: unknown): raw is Blob {
  return typeof Blob !== 'undefined' && raw instanceof Blob;
}

/** Exact payload bytes. A view's offset/length are kept so a subarray cannot see padding. */
function inboundBytes(raw: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
}

/**
 * AXB1 i64/f64 readers assert absolute buffer alignment. A view whose
 * `byteOffset` is not a multiple of 8 (a sliced frame) fails that check even
 * when the relative payload layout is valid — a false malformed that drops
 * the snapshot and can push the live wire into JSON fallback. Copy onto a
 * fresh buffer so decode sees offset 0.
 */
function axb1Bytes(view: Uint8Array): Uint8Array {
  if (view.byteOffset % 8 === 0) return view;
  return view.slice();
}

function utf8From(raw: ArrayBuffer | ArrayBufferView): string {
  return new TextDecoder().decode(inboundBytes(raw));
}

function decodeJsonText(text: string, table: IngestCursorTable): IngestDecode {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, kind: 'malformed', reason: 'json' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, kind: 'malformed', reason: 'json-shape' };
  }
  const frame = stripSeqAck(normalizeRedesign2Frame(parsed)) as Redesign2Frame;
  if (!frame || typeof frame.type !== 'string') {
    return { ok: false, kind: 'malformed', reason: 'type' };
  }
  if (frame.type === 'pong') return { ok: true, kind: 'pong' };
  if (!validateRedesign2Frame(frame)) {
    return { ok: false, kind: 'malformed', reason: frame.type || 'invalid' };
  }
  table.rememberInbound(frame);
  return { ok: true, kind: 'frames', frames: [frame] };
}

const PRICE_BITS = TipMask.OPEN | TipMask.HIGH | TipMask.LOW | TipMask.CLOSE;

/**
 * Build the forming tip bar. Returns null when there is no prior tip and the
 * tip carries no price bits — emitting a 0-priced bar would fabricate a price
 * (the store sanitizer cannot catch it because 0 is finite).
 */
function barFromTip(tip: Axb1TipFields, scale: number, prev: CursorBar | null): CursorBar | null {
  const hasPrice = (tip.mask & PRICE_BITS) !== 0;
  if (!prev && !hasPrice) return null;
  // Resolve time first: never emit epoch 0. Tip time wins when normalizable,
  // else fall back to the prior tip's real time; with neither, there is no
  // honest time for a forming bar.
  const tipTime = (tip.mask & TipMask.TIME) !== 0 ? normalizeBarTime(tip.timeS) : null;
  const time = tipTime ?? prev?.time ?? null;
  if (time == null) return null;
  const price = (ticks: bigint | undefined, fallback: number) =>
    ticks == null ? fallback : ticksToPrice(ticks, scale);
  let base: CursorBar | null = prev;
  if (!base) {
    // No prior tip: seed missing OHLC from whichever price bits the tip
    // carries so we never present a fabricated 0 as a real price.
    const o = tip.mask & TipMask.OPEN && tip.open != null ? ticksToPrice(tip.open, scale) : null;
    const h = tip.mask & TipMask.HIGH && tip.high != null ? ticksToPrice(tip.high, scale) : null;
    const l = tip.mask & TipMask.LOW && tip.low != null ? ticksToPrice(tip.low, scale) : null;
    const c = tip.mask & TipMask.CLOSE && tip.close != null ? ticksToPrice(tip.close, scale) : null;
    const present = [o, h, l, c].filter((v): v is number => v != null);
    if (!present.length) return null;
    const seed = present[0] as number;
    base = {
      time,
      open: o ?? seed,
      high: h ?? seed,
      low: l ?? seed,
      close: c ?? seed,
      volume: 0,
    };
  }
  return {
    time,
    open: tip.mask & TipMask.OPEN ? price(tip.open, base.open) : base.open,
    high: tip.mask & TipMask.HIGH ? price(tip.high, base.high) : base.high,
    low: tip.mask & TipMask.LOW ? price(tip.low, base.low) : base.low,
    close: tip.mask & TipMask.CLOSE ? price(tip.close, base.close) : base.close,
    volume: tip.mask & TipMask.VOLUME && tip.volume != null ? tip.volume : base.volume,
    closed: false,
  };
}

/**
 * Build one closed bar from raw AXB1 arrays. Returns null when the time or any
 * OHLC tick is missing — a claimed bar that cannot be built from real data is
 * skipped, never emitted as a 0n-priced or epoch-0 bar. Volume defaults to a
 * real 0 when absent (legitimate for a fresh bar with known price).
 */
function barFromArrays(
  timeRaw: number | null | undefined,
  o: bigint | undefined,
  h: bigint | undefined,
  l: bigint | undefined,
  c: bigint | undefined,
  volume: number | undefined,
  scale: number,
): CursorBar | null {
  if (timeRaw == null) return null;
  const time = normalizeBarTime(timeRaw);
  if (time == null) return null;
  if (o == null || h == null || l == null || c == null) return null;
  return {
    time,
    open: ticksToPrice(o, scale),
    high: ticksToPrice(h, scale),
    low: ticksToPrice(l, scale),
    close: ticksToPrice(c, scale),
    volume: volume ?? 0,
    closed: true,
  };
}

function snapshotBars(snap: Axb1OhlcvSnapshot): CursorBar[] {
  const bars: CursorBar[] = [];
  for (let i = 0; i < snap.count; i++) {
    const bar = barFromArrays(snap.timeS[i], snap.open[i], snap.high[i], snap.low[i], snap.close[i], snap.volume[i], snap.priceScale);
    if (bar) bars.push(bar);
  }
  return bars;
}

function isAxb1Unknown(ax: Axb1Frame | Axb1Unknown): ax is Axb1Unknown {
  return 'unknown' in ax && ax.unknown === true;
}

export function mapAxb1(frame: Axb1Frame | Axb1Unknown, table: IngestCursorTable): IngestDecode {
  const id = table.resolveSubId(frame.subIdHash);
  const sessionId = table.resolveSession(frame.sessionHash);
  const ts = Number(frame.tsMs);
  const seq = frame.seq;
  if (isAxb1Unknown(frame)) {
    return { ok: true, kind: 'unknown-opcode', opcode: frame.opcode, id, seq };
  }
  const ax: Axb1Frame = frame;
  /** Captured before the opcode narrowing below (the fallback sees `never`). */
  const opcode = ax.opcode;

  if (ax.opcode === Axb1Opcode.HEARTBEAT) return { ok: true, kind: 'pong' };

  if (ax.opcode === Axb1Opcode.STATUS) {
    return {
      ok: true,
      kind: 'frames',
      frames: [
        {
          type: 'status',
          id,
          ts,
          payload: {
            code: ax.statusCode,
            detail: ax.detail,
            have: ax.have,
            need: ax.need,
          },
        },
      ],
    };
  }

  if (ax.opcode === Axb1Opcode.ERROR) {
    return {
      ok: true,
      kind: 'frames',
      frames: [
        {
          type: 'error',
          id,
          sessionId,
          ts,
          payload: { code: ax.code, message: ax.message, retryable: ax.retryable },
        },
      ],
    };
  }

  if (ax.opcode === Axb1Opcode.JSON_BLOB) {
    return decodeJsonText(ax.json, table);
  }

  if (ax.opcode === Axb1Opcode.SNAPSHOT_OHLCV) {
    const bars = snapshotBars(ax);
    table.rememberId(id);
    table.rememberSession(sessionId);
    table.setCursor(id, {
      count: bars.length,
      closedUpto: ax.closedUpto,
      sessionId,
      priceScale: ax.priceScale,
      lastBar: bars.length ? (bars[bars.length - 1] as CursorBar) : null,
    });
    const frame: Redesign2Frame = {
      type: 'full',
      id,
      sessionId,
      seq,
      ts,
      payload: {
        seriesKey: id,
        count: bars.length,
        closed_upto: ax.closedUpto,
        bars,
      },
    };
    return { ok: true, kind: 'frames', frames: [frame] };
  }

  if (ax.opcode === Axb1Opcode.SNAPSHOT_PLOTS) {
    const series: Record<string, unknown[]> = {};
    for (const col of ax.plots) {
      if (col.kind === ValueKind.PriceTicks && col.ticks) {
        series[col.key] = col.ticks.map((t) => ticksToPrice(t, PRICE_SCALE_DEFAULT));
      } else {
        series[col.key] = col.values ?? [];
      }
    }
    table.rememberId(id);
    table.rememberSession(sessionId);
    const prev = table.cursor(id);
    table.setCursor(id, {
      count: ax.count,
      closedUpto: ax.closedUpto,
      sessionId,
      priceScale: prev?.priceScale ?? PRICE_SCALE_DEFAULT,
      lastBar: prev?.lastBar ?? null,
    });
    const frame: Redesign2Frame = {
      type: 'full',
      id,
      sessionId,
      seq,
      ts,
      payload: {
        seriesKey: id,
        count: ax.count,
        closed_upto: ax.closedUpto,
        series,
        ...(ax.times ? { bar_times: ax.times } : {}),
      },
    };
    return { ok: true, kind: 'frames', frames: [frame] };
  }

  const cur = table.cursor(id) ?? {
    count: 1,
    closedUpto: 0,
    sessionId,
    priceScale: PRICE_SCALE_DEFAULT,
    lastBar: null,
  };

  if (ax.opcode === Axb1Opcode.UNCHANGED) {
    const frame: Redesign2Frame = {
      type: 'delta',
      id,
      sessionId: cur.sessionId,
      seq,
      ts,
      payload: {
        base_index: Math.max(0, cur.count - 1),
        count: cur.count,
        tail_len: 1,
        closed_upto: cur.closedUpto,
        unchanged: true,
        forming: true,
      },
    };
    return { ok: true, kind: 'frames', frames: [frame] };
  }

  if (ax.opcode === Axb1Opcode.TIP_UPDATE) {
    const bar = barFromTip(ax, cur.priceScale, cur.lastBar);
    if (!bar) {
      // No prior tip and no price bits: emit nothing rather than a fabricated 0-price bar.
      return { ok: true, kind: 'frames', frames: [] };
    }
    table.setCursor(id, { ...cur, lastBar: bar, sessionId: cur.sessionId });
    const frame: Redesign2Frame = {
      type: 'delta',
      id,
      sessionId: cur.sessionId,
      seq,
      ts,
      payload: {
        base_index: Math.max(0, cur.count - 1),
        count: cur.count,
        tail_len: 1,
        closed_upto: cur.closedUpto,
        forming: true,
        bars: [bar],
      },
    };
    return { ok: true, kind: 'frames', frames: [frame] };
  }

  if (ax.opcode === Axb1Opcode.PLOT_TIP) {
    const series: Record<string, unknown[]> = {};
    for (const p of ax.plots) {
      const key = `p:${p.keyHash >>> 0}`;
      if (p.kind === ValueKind.PriceTicks && p.ticks != null) {
        series[key] = [ticksToPrice(p.ticks, cur.priceScale)];
      } else {
        series[key] = [p.value ?? null];
      }
    }
    const frame: Redesign2Frame = {
      type: 'delta',
      id,
      sessionId: cur.sessionId,
      seq,
      ts,
      payload: {
        base_index: Math.max(0, cur.count - 1),
        count: cur.count,
        tail_len: 1,
        closed_upto: cur.closedUpto,
        forming: true,
        series,
      },
    };
    return { ok: true, kind: 'frames', frames: [frame] };
  }

  if (ax.opcode === Axb1Opcode.CLOSE_VERIFY) {
    const time = normalizeBarTime(ax.timeS) ?? cur.lastBar?.time ?? null;
    if (time == null) {
      // No usable time and no prior bar: emit nothing rather than epoch 0.
      return { ok: true, kind: 'frames', frames: [] };
    }
    const verified: CursorBar = {
      time,
      open: ticksToPrice(ax.open, cur.priceScale),
      high: ticksToPrice(ax.high, cur.priceScale),
      low: ticksToPrice(ax.low, cur.priceScale),
      close: ticksToPrice(ax.close, cur.priceScale),
      volume: ax.volume,
      closed: true,
    };
    table.setCursor(id, { ...cur, lastBar: verified, sessionId: cur.sessionId });
    const closeFrame: Redesign2Frame = {
      type: 'close',
      id,
      sessionId: cur.sessionId,
      seq,
      ts,
      payload: {
        index: ax.index,
        time,
        ohlcv: {
          open: verified.open,
          high: verified.high,
          low: verified.low,
          close: verified.close,
          volume: verified.volume,
        },
      },
    };
    const delta: Redesign2Frame = {
      type: 'delta',
      id,
      sessionId: cur.sessionId,
      seq,
      ts,
      payload: {
        base_index: Math.max(0, cur.count - 1),
        count: cur.count,
        tail_len: 1,
        closed_upto: cur.closedUpto,
        forming: false,
        bars: [verified],
      },
    };
    return { ok: true, kind: 'frames', frames: [delta, closeFrame] };
  }

  if (ax.opcode === Axb1Opcode.APPEND_BAR) {
    const closedTime = normalizeBarTime(ax.closedTime) ?? cur.lastBar?.time ?? null;
    if (closedTime == null) {
      // No usable time and no prior bar: emit nothing rather than epoch 0.
      return { ok: true, kind: 'frames', frames: [] };
    }
    const closed: CursorBar = {
      time: closedTime,
      open: ticksToPrice(ax.open, ax.priceScale),
      high: ticksToPrice(ax.high, ax.priceScale),
      low: ticksToPrice(ax.low, ax.priceScale),
      close: ticksToPrice(ax.close, ax.priceScale),
      volume: ax.volume,
      closed: true,
    };
    const hasTipBit = (ax.tip.mask & TipMask.TIME) !== 0;
    const tipBar = hasTipBit ? barFromTip(ax.tip, ax.priceScale, closed) : null;
    const hasTip = hasTipBit && tipBar != null;
    const nextCount = cur.count + (hasTip ? 1 : 0);
    const nextBar = tipBar ?? closed;
    table.setCursor(id, {
      count: Math.max(nextCount, 1),
      closedUpto: ax.closedIndex,
      sessionId: cur.sessionId,
      priceScale: ax.priceScale,
      lastBar: nextBar,
    });
    const closeFrame: Redesign2Frame = {
      type: 'close',
      id,
      sessionId: cur.sessionId,
      seq,
      ts,
      payload: {
        index: ax.closedIndex,
        time: closedTime,
        ohlcv: {
          open: closed.open,
          high: closed.high,
          low: closed.low,
          close: closed.close,
          volume: closed.volume,
        },
      },
    };
    const bars = hasTip ? [closed, nextBar] : [closed];
    const delta: Redesign2Frame = {
      type: 'delta',
      id,
      sessionId: cur.sessionId,
      seq,
      ts,
      payload: {
        base_index: Math.max(0, cur.count - 1),
        count: Math.max(nextCount, cur.count),
        tail_len: bars.length,
        closed_upto: ax.closedIndex,
        forming: hasTip,
        bars,
      },
    };
    return { ok: true, kind: 'frames', frames: [delta, closeFrame] };
  }

  if (ax.opcode === Axb1Opcode.APPEND_BARS) {
    const n = ax.count;
    const closedBars: CursorBar[] = [];
    for (let i = 0; i < n; i++) {
      const bar = barFromArrays(ax.timeS[i], ax.open[i], ax.high[i], ax.low[i], ax.close[i], ax.volume[i], ax.priceScale);
      if (bar) closedBars.push(bar);
    }
    const lastClosed = closedBars.length ? (closedBars[closedBars.length - 1] as CursorBar) : null;
    const hasTipBit = (ax.tip.mask & TipMask.TIME) !== 0;
    const tipBar = hasTipBit ? barFromTip(ax.tip, ax.priceScale, lastClosed) : null;
    const hasTip = hasTipBit && tipBar != null;
    const nextBar = hasTip ? tipBar : lastClosed;
    const baseIndex = Math.max(0, cur.count);
    const nextCount = cur.count + closedBars.length + (hasTip ? 1 : 0);
    table.setCursor(id, {
      count: Math.max(nextCount, 1),
      closedUpto: ax.closedUpto,
      sessionId: cur.sessionId,
      priceScale: ax.priceScale,
      lastBar: nextBar,
    });
    const bars: CursorBar[] = [...closedBars, ...(hasTip && nextBar ? [nextBar] : [])];
    const delta: Redesign2Frame = {
      type: 'delta',
      id,
      sessionId: cur.sessionId,
      seq,
      ts,
      payload: {
        base_index: baseIndex,
        count: Math.max(nextCount, cur.count),
        tail_len: bars.length,
        closed_upto: ax.closedUpto,
        forming: hasTip,
        bars,
      },
    };
    const frames: Redesign2Frame[] = [delta];
    if (lastClosed) {
      frames.push({
        type: 'close',
        id,
        sessionId: cur.sessionId,
        seq,
        ts,
        payload: {
          index: ax.closedIndex,
          time: lastClosed.time,
          ohlcv: {
            open: lastClosed.open,
            high: lastClosed.high,
            low: lastClosed.low,
            close: lastClosed.close,
            volume: lastClosed.volume,
          },
        },
      });
    }
    return { ok: true, kind: 'frames', frames };
  }

  return { ok: false, kind: 'malformed', reason: `opcode:${opcode}` };
}

/**
 * Decode one inbound socket payload. JSON stays the compatibility path;
 * AXB1 is detected by magic. `table` restores subscription ids from hashes.
 *
 * Sync for `string | ArrayBuffer | ArrayBufferView`. A `Blob` (Cloudflare
 * binary WS on compat ≥ 2026-03-17) is not readable here — use
 * {@link decodeInboundAsync}. Passing a Blob is `malformed` (`blob`), not
 * `type` and not a TextDecoder of the bytes.
 */
export function decodeInbound(raw: unknown, table: IngestCursorTable): IngestDecode {
  if (typeof raw === 'string') return decodeJsonText(raw, table);
  if (isBlob(raw)) return { ok: false, kind: 'malformed', reason: 'blob' };
  if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) {
    const view = inboundBytes(raw);
    if (looksLikeAxb1(view)) {
      try {
        return mapAxb1(decodeFrame(axb1Bytes(view)), table);
      } catch (e) {
        return { ok: false, kind: 'malformed', reason: e instanceof Error ? e.message : 'axb1' };
      }
    }
    return decodeJsonText(utf8From(view), table);
  }
  return { ok: false, kind: 'malformed', reason: 'type' };
}

/**
 * Same as {@link decodeInbound}, plus `Blob` via `arrayBuffer()`.
 * AXB1 magic is inspected on those bytes — never TextDecoder a binary frame.
 * A failed Blob read or malformed bytes is `malformed`, not a throw.
 */
export async function decodeInboundAsync(
  raw: unknown,
  table: IngestCursorTable,
): Promise<IngestDecode> {
  if (isBlob(raw)) {
    try {
      return decodeInbound(await raw.arrayBuffer(), table);
    } catch (e) {
      return { ok: false, kind: 'malformed', reason: e instanceof Error ? e.message : 'blob' };
    }
  }
  return decodeInbound(raw, table);
}

function payloadOf(frame: Redesign2Frame): Record<string, unknown> {
  return isRecord(frame.payload) ? frame.payload : {};
}

function seqOfFrame(frame: Redesign2Frame): number | null {
  return 'seq' in frame && typeof frame.seq === 'number' && Number.isFinite(frame.seq)
    ? frame.seq
    : null;
}

type SeqChain = { cursor: number; seenTo: number; broken: boolean };

/** Keepalive. No bars and no plot columns — safe to drop. */
function isUnchangedFrame(frame: Redesign2Frame): boolean {
  if (frame.type !== 'delta') return false;
  const payload = payloadOf(frame);
  if (payload['unchanged'] !== true) return false;
  if (payload['bars'] != null || payload['series'] != null || payload['plots'] != null)
    return false;
  return true;
}

function isFormingTip(frame: Redesign2Frame): boolean {
  if (frame.type !== 'delta' || !frame.id || isUnchangedFrame(frame)) return false;
  return payloadOf(frame)['forming'] === true;
}

/** Record columns union by key. A non-record (a plot array) is replaced whole. */
function unionColumns(prev: unknown, next: unknown): unknown {
  if (next === undefined) return prev;
  if (!isRecord(prev) || !isRecord(next)) return next;
  return { ...prev, ...next };
}

/**
 * Last OHLC tip wins. Plot columns already pending stay unless this tip
 * replaces that key. The later seq wins.
 */
function mergeTip(prev: Redesign2Frame, next: Redesign2Frame): Redesign2Frame {
  const pp = payloadOf(prev);
  const np = payloadOf(next);
  const bars = np['bars'] !== undefined ? np['bars'] : pp['bars'];
  const series =
    np['series'] !== undefined ? unionColumns(pp['series'], np['series']) : pp['series'];
  const plots = np['plots'] !== undefined ? unionColumns(pp['plots'], np['plots']) : pp['plots'];
  const prevSeq = 'seq' in prev && typeof prev.seq === 'number' ? prev.seq : 0;
  const nextSeq = 'seq' in next && typeof next.seq === 'number' ? next.seq : prevSeq;
  return {
    ...next,
    seq: Math.max(prevSeq, nextSeq),
    payload: {
      ...pp,
      ...np,
      ...(bars !== undefined ? { bars } : {}),
      ...(series !== undefined ? { series } : {}),
      ...(plots !== undefined ? { plots } : {}),
      forming: true,
    },
  } as Redesign2Frame;
}

/**
 * Hold forming tip deltas per subscription and flush on a timer.
 *
 * Within the window, OHLC is a fold (last bar wins) and plot columns union
 * by key. A quiet first tip waits {@link INGEST_TIP_COALESCE_MS}. A second
 * tip for the same id folds onto the pending one and releases immediately
 * so `batch:post` is not stuck behind the rest of the window under load.
 * A non-tip frame (`close`, APPEND_BAR / `forming: false`) flushes the
 * pending tip for that subscription first. `UNCHANGED` keepalives flush
 * any pending tip then forward so the applier advances seq one-by-one —
 * dropping them used to force `seqAckFrom` holes that `client-apply`
 * counted as `droppedTip` even though no tip payload was lost. Tip seqs
 * folded into the one frame we keep still ride `seqAckFrom`. A seq we
 * never saw breaks the chain and stays a real gap.
 */
/**
 * Holds forming tip deltas per subscription and flushes them on a timer.
 *
 * Within the window OHLC folds (last bar wins) and plot columns union by key;
 * a second tip for the same id folds and releases immediately, and any non-tip
 * frame flushes that subscription's pending tip first so ordering survives.
 *
 * @param emit Receives the frames to post, already seq-released
 * @param delayMs Coalescing window; defaults to {@link INGEST_TIP_COALESCE_MS}
 * @param schedule Timer seam `(fn, ms) => cancel`; injectable for tests
 */
export class TipCoalescer {
  private readonly pending = new Map<string, Redesign2Frame>();
  private readonly chains = new Map<string, SeqChain>();
  private cancel: (() => void) | null = null;

  constructor(
    private readonly emit: (frames: Redesign2Frame[]) => void,
    private readonly delayMs: number = INGEST_TIP_COALESCE_MS,
    private readonly schedule: (fn: () => void, ms: number) => () => void = (fn, ms) => {
      const t = setTimeout(fn, ms);
      return () => clearTimeout(t);
    },
  ) {}

  push(frames: Redesign2Frame[]): void {
    const out: Redesign2Frame[] = [];
    for (const frame of frames) {
      if (isUnchangedFrame(frame)) {
        const id = frame.id;
        const seq = seqOfFrame(frame);
        const chain = id != null ? this.chains.get(id) : undefined;
        const contiguous =
          chain != null && !chain.broken && seq != null && seq === chain.seenTo + 1;
        if (contiguous) {
          // Pending tip first so its payload is not stranded behind a keepalive.
          for (const prior of this.take(id)) out.push(this.releaseSeq(prior));
          out.push(this.releaseSeq(frame));
        } else {
          // Hole or no cursor: observe only (may mark broken). Do not emit a
          // gap keepalive — that would force the applier to resync.
          this.observe(frame);
        }
        continue;
      }
      if (isFormingTip(frame) && frame.id) {
        this.observe(frame);
        const prev = this.pending.get(frame.id);
        if (prev) {
          // Under load: fold then release now. One pending tip per id —
          // the queue stays bounded while the host sees the tip sooner.
          this.pending.set(frame.id, mergeTip(prev, frame));
          for (const prior of this.take(frame.id)) out.push(this.releaseSeq(prior));
        } else {
          this.pending.set(frame.id, frame);
          this.arm();
        }
        continue;
      }
      // Release the non-tip before later keepalives in this batch are
      // observed, so those keepalives extend the chain this frame just set.
      for (const prior of this.take(frame.id)) out.push(this.releaseSeq(prior));
      out.push(this.releaseSeq(frame));
    }
    if (out.length) this.emit(out);
  }

  flush(): void {
    this.disarm();
    this.send(this.drain());
  }

  private send(frames: Redesign2Frame[]): void {
    if (!frames.length) return;
    const out: Redesign2Frame[] = [];
    for (const frame of frames) out.push(this.releaseSeq(frame));
    this.emit(out);
  }

  /** Extend the contiguous run. A hole marks the chain broken. */
  private observe(frame: Redesign2Frame): void {
    const id = frame.id;
    const seq = seqOfFrame(frame);
    if (!id || seq == null) return;
    const chain = this.chains.get(id);
    if (!chain || chain.broken) return;
    if (seq <= chain.seenTo) return;
    if (seq === chain.seenTo + 1) {
      chain.seenTo = seq;
      return;
    }
    chain.broken = true;
  }

  /**
   * Hand one frame to the host. A full snapshot, or a seq behind the
   * cursor, starts a new chain. A contiguous run releases at its high
   * water and names the cursor it started from.
   */
  private releaseSeq(frame: Redesign2Frame): Redesign2Frame {
    const id = frame.id;
    const seq = seqOfFrame(frame);
    if (!id || seq == null) return frame;
    const prev = this.chains.get(id);
    if (frame.type === 'full' || (prev != null && seq < prev.cursor)) {
      this.chains.set(id, { cursor: seq, seenTo: seq, broken: false });
      return frame;
    }
    this.observe(frame);
    const chain = this.chains.get(id);
    if (!chain) {
      this.chains.set(id, { cursor: seq, seenTo: seq, broken: false });
      return frame;
    }
    let released = seq;
    let ackFrom: number | undefined;
    if (!chain.broken && seq > chain.cursor && seq <= chain.seenTo) {
      released = chain.seenTo;
      if (released > chain.cursor + 1) ackFrom = chain.cursor;
    }
    this.chains.set(id, { cursor: released, seenTo: released, broken: false });
    if (released === seq && ackFrom == null) return frame;
    return {
      ...frame,
      seq: released,
      payload: {
        ...payloadOf(frame),
        ...(ackFrom != null ? { seqAckFrom: ackFrom } : {}),
      },
    } as Redesign2Frame;
  }

  private arm(): void {
    if (this.cancel) return;
    this.cancel = this.schedule(() => this.flush(), this.delayMs);
  }

  private disarm(): void {
    this.cancel?.();
    this.cancel = null;
  }

  /** Pending tip for one subscription, or every tip when the frame has no id. */
  private take(id: string | undefined): Redesign2Frame[] {
    if (!id) return this.drain();
    const one = this.pending.get(id);
    if (!one) return [];
    this.pending.delete(id);
    if (!this.pending.size) this.disarm();
    return [one];
  }

  private drain(): Redesign2Frame[] {
    if (!this.pending.size) return [];
    const out = [...this.pending.values()];
    this.pending.clear();
    this.disarm();
    return out;
  }
}
