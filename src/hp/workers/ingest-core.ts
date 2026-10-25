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
import type { Axb1Frame, Axb1OhlcvSnapshot, Axb1TipFields, Axb1Unknown } from '../axb1/types';
import { INGEST_TIP_COALESCE_MS } from './protocol';

export type IngestDecode =
  | { ok: true; kind: 'pong' }
  | { ok: true; kind: 'frames'; frames: Redesign2Frame[] }
  | { ok: true; kind: 'unknown-opcode'; opcode: number; id: string; seq: number }
  | { ok: false; kind: 'malformed'; reason: string };

export type CursorBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type SubCursor = {
  count: number;
  closedUpto: number;
  sessionId: string;
  priceScale: number;
  lastBar: CursorBar | null;
};

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

  rememberInbound(frame: WireFrame): void {
    this.rememberOutbound(frame);
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

function utf8From(raw: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    raw instanceof ArrayBuffer
      ? new Uint8Array(raw)
      : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  return new TextDecoder().decode(bytes);
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

function barFromTip(tip: Axb1TipFields, scale: number, prev: CursorBar | null): CursorBar {
  const base: CursorBar = prev ?? { time: 0, open: 0, high: 0, low: 0, close: 0, volume: 0 };
  const price = (ticks: bigint | undefined, fallback: number) =>
    ticks == null ? fallback : ticksToPrice(ticks, scale);
  return {
    time: tip.mask & TipMask.TIME && tip.timeS != null ? tip.timeS : base.time,
    open: tip.mask & TipMask.OPEN ? price(tip.open, base.open) : base.open,
    high: tip.mask & TipMask.HIGH ? price(tip.high, base.high) : base.high,
    low: tip.mask & TipMask.LOW ? price(tip.low, base.low) : base.low,
    close: tip.mask & TipMask.CLOSE ? price(tip.close, base.close) : base.close,
    volume: tip.mask & TipMask.VOLUME && tip.volume != null ? tip.volume : base.volume,
  };
}

function snapshotBars(snap: Axb1OhlcvSnapshot): CursorBar[] {
  const bars: CursorBar[] = [];
  for (let i = 0; i < snap.count; i++) {
    bars.push({
      time: snap.timeS[i] ?? 0,
      open: ticksToPrice(snap.open[i] ?? 0n, snap.priceScale),
      high: ticksToPrice(snap.high[i] ?? 0n, snap.priceScale),
      low: ticksToPrice(snap.low[i] ?? 0n, snap.priceScale),
      close: ticksToPrice(snap.close[i] ?? 0n, snap.priceScale),
      volume: snap.volume[i] ?? 0,
    });
  }
  return bars;
}

function mapAxb1(ax: Axb1Frame | Axb1Unknown, table: IngestCursorTable): IngestDecode {
  const id = table.resolveSubId(ax.subIdHash);
  const sessionId = table.resolveSession(ax.sessionHash);
  const ts = Number(ax.tsMs);
  const seq = ax.seq;
  if ('unknown' in ax && ax.unknown === true) {
    return { ok: true, kind: 'unknown-opcode', opcode: ax.opcode, id, seq };
  }
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
      count: ax.count,
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
        count: ax.count,
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
    const frame: Redesign2Frame = {
      type: 'close',
      id,
      sessionId: cur.sessionId,
      seq,
      ts,
      payload: {
        index: ax.index,
        time: ax.timeS,
        ohlcv: {
          open: ticksToPrice(ax.open, cur.priceScale),
          high: ticksToPrice(ax.high, cur.priceScale),
          low: ticksToPrice(ax.low, cur.priceScale),
          close: ticksToPrice(ax.close, cur.priceScale),
          volume: ax.volume,
        },
      },
    };
    return { ok: true, kind: 'frames', frames: [frame] };
  }

  if (ax.opcode === Axb1Opcode.APPEND_BAR) {
    const closed: CursorBar = {
      time: ax.closedTime,
      open: ticksToPrice(ax.open, ax.priceScale),
      high: ticksToPrice(ax.high, ax.priceScale),
      low: ticksToPrice(ax.low, ax.priceScale),
      close: ticksToPrice(ax.close, ax.priceScale),
      volume: ax.volume,
    };
    const hasTip = (ax.tip.mask & TipMask.TIME) !== 0;
    const nextCount = cur.count + (hasTip ? 1 : 0);
    const nextBar = hasTip ? barFromTip(ax.tip, ax.priceScale, closed) : closed;
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
        time: ax.closedTime,
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

  return { ok: false, kind: 'malformed', reason: `opcode:${opcode}` };
}

/**
 * Decode one inbound socket payload. JSON stays the compatibility path;
 * AXB1 is detected by magic. `table` restores subscription ids from hashes.
 */
export function decodeInbound(raw: unknown, table: IngestCursorTable): IngestDecode {
  if (typeof raw === 'string') return decodeJsonText(raw, table);
  if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) {
    const view = raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw;
    if (looksLikeAxb1(view)) {
      try {
        return mapAxb1(decodeFrame(view), table);
      } catch (e) {
        return { ok: false, kind: 'malformed', reason: e instanceof Error ? e.message : 'axb1' };
      }
    }
    return decodeJsonText(utf8From(view), table);
  }
  return { ok: false, kind: 'malformed', reason: 'type' };
}

function payloadOf(frame: Redesign2Frame): Record<string, unknown> {
  return isRecord(frame.payload) ? frame.payload : {};
}

function seqOfFrame(frame: Redesign2Frame): number | null {
  return 'seq' in frame && typeof frame.seq === 'number' && Number.isFinite(frame.seq) ? frame.seq : null;
}

type SeqChain = { cursor: number; seenTo: number; broken: boolean };

/** Keepalive. No bars and no plot columns — safe to drop. */
function isUnchangedFrame(frame: Redesign2Frame): boolean {
  if (frame.type !== 'delta') return false;
  const payload = payloadOf(frame);
  if (payload.unchanged !== true) return false;
  if (payload.bars != null || payload.series != null || payload.plots != null) return false;
  return true;
}

function isFormingTip(frame: Redesign2Frame): boolean {
  if (frame.type !== 'delta' || !frame.id || isUnchangedFrame(frame)) return false;
  return payloadOf(frame).forming === true;
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
  const bars = np.bars !== undefined ? np.bars : pp.bars;
  const series = np.series !== undefined ? unionColumns(pp.series, np.series) : pp.series;
  const plots = np.plots !== undefined ? unionColumns(pp.plots, np.plots) : pp.plots;
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
 * by key. A non-tip frame flushes the pending tip for that subscription
 * first. `UNCHANGED` keepalives are dropped. Their seq, and any tip seq
 * folded into the one frame we keep, stays on a per-subscription chain.
 * The frame we release carries `seqAckFrom` (the cursor before that run)
 * so the applier advances through it. A seq we never saw breaks the chain
 * and stays a real gap.
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
        this.observe(frame);
        continue;
      }
      if (isFormingTip(frame) && frame.id) {
        this.observe(frame);
        const prev = this.pending.get(frame.id);
        this.pending.set(frame.id, prev ? mergeTip(prev, frame) : frame);
        this.arm();
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
