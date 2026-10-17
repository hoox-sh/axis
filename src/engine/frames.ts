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
 * Frame contract for the engine-owned data plane (Redesign3, F-01).
 *
 * One WebSocket per engine endpoint carries N multiplexed subscriptions:
 * `subscribe → status → full → delta → close`, with `resume` / `repair`
 * control frames and a REST tail fallback. Every `full` / `delta` / `close`
 * frame carries a per-subscription monotonic `seq` so the client can detect a
 * dropped frame (`seq > last + 1` → `resume`) instead of silently applying an
 * incomplete delta. The positional `{base_index, count, tail_len}` block
 * (same contract as `engines/session-delta`) detects rebase; `seq` detects gaps.
 *
 * Validators reject malformed frames early so the transport client never
 * dispatches partial or untyped payloads into apply code.
 *
 * @module engine/frames
 */

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** Canonical series identity: `exchange|market|SYMBOL|interval`. */
export interface SeriesMeta {
  exchange: string;
  market: string;
  symbol: string;
  interval: string;
  history_bars?: number;
}

/** One OHLCV bar, unix seconds, oldest → newest. */
export interface FrameBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Positional delta-merge block (mirrors `session_delta`). */
export interface DeltaBlock {
  base_index: number;
  count: number;
  tail_len: number;
}

/** Per-subscription lifecycle states (see final/plan.mdx §7). */
export type SubscriptionStatusCode =
  | 'datafeed-loading'
  | 'datafeed-ready'
  | 'calculating'
  | 'live'
  | 'degraded'
  | 'error';

// ---------------------------------------------------------------------------
// Client → engine frames
// ---------------------------------------------------------------------------

export type Redesign2AuthFrame = {
  type: 'auth';
  id?: string;
  ts?: number;
  payload: { token: string };
};

export type Redesign2SubscribeFrame = {
  type: 'subscribe';
  id: string;
  ts?: number;
  payload: {
    kind: 'series' | 'script';
    meta: SeriesMeta;
    script?: string;
    inputs?: Record<string, unknown>;
    libraries?: unknown;
    mode?: string;
  };
};

export type Redesign2ResumeFrame = {
  type: 'resume';
  id: string;
  ts?: number;
  payload: {
    count: number;
    last_time: number;
    closed_upto?: number;
    /** Last applied per-subscription `seq`; the resync cursor. */
    seq?: number;
  };
};

export type Redesign2RepairFrame = {
  type: 'repair';
  id: string;
  ts?: number;
  payload: { from_time: number };
};

export type Redesign2UnsubscribeFrame = {
  type: 'unsubscribe';
  id: string;
  ts?: number;
  payload?: Record<string, unknown>;
};

export type Redesign2PingFrame = {
  type: 'ping';
  id?: string;
  ts?: number;
  payload?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Engine → client frames
// ---------------------------------------------------------------------------

export type Redesign2AuthOkFrame = {
  type: 'auth.ok';
  id?: string;
  ts?: number;
  payload?: Record<string, unknown>;
};

export type Redesign2StatusFrame = {
  type: 'status';
  id?: string;
  sessionId?: string;
  ts?: number;
  payload: {
    code: SubscriptionStatusCode | string;
    detail?: string;
    progress?: number;
    have?: number;
    need?: number;
    message?: string;
  };
};

export type Redesign2FullFrame = {
  type: 'full';
  id?: string;
  sessionId: string;
  /** Per-subscription monotonic sequence number. */
  seq: number;
  ts?: number;
  payload: {
    seriesKey: string;
    count: number;
    closed_upto: number;
    bars?: FrameBar[];
    bar_times?: number[];
    plots?: Record<string, unknown>;
    series?: Record<string, unknown>;
    plot_meta?: unknown;
    events?: unknown;
    drawings?: unknown;
    meta?: Record<string, unknown>;
  };
};

export type Redesign2DeltaFrame = {
  type: 'delta';
  id?: string;
  sessionId: string;
  /** Per-subscription monotonic sequence number. */
  seq: number;
  ts?: number;
  payload: DeltaBlock & {
    closed_upto: number;
    forming?: boolean;
    unchanged?: boolean;
    plots?: Record<string, unknown>;
    series?: Record<string, unknown>;
    /** Series-kind subscriptions carry candle bars here (no plots/series). */
    bars?: Array<Record<string, unknown>>;
  };
};

export type Redesign2CloseFrame = {
  type: 'close';
  id?: string;
  sessionId: string;
  /** Per-subscription monotonic sequence number. */
  seq: number;
  ts?: number;
  payload: {
    index: number;
    time: number;
    ohlcv: { open: number; high: number; low: number; close: number; volume: number };
  };
};

export type Redesign2VerifyResultFrame = {
  type: 'verify.result';
  id?: string;
  sessionId: string;
  ts?: number;
  payload: { corrected?: boolean; reason?: string };
};

export type Redesign2ErrorFrame = {
  type: 'error';
  id?: string;
  sessionId?: string;
  ts?: number;
  payload: { code: string; message: string; retryable?: boolean };
};

export type Redesign2PongFrame = {
  type: 'pong';
  id?: string;
  ts?: number;
  payload?: Record<string, unknown>;
};

export type Redesign2Frame =
  | Redesign2AuthFrame
  | Redesign2SubscribeFrame
  | Redesign2ResumeFrame
  | Redesign2RepairFrame
  | Redesign2UnsubscribeFrame
  | Redesign2PingFrame
  | Redesign2AuthOkFrame
  | Redesign2StatusFrame
  | Redesign2FullFrame
  | Redesign2DeltaFrame
  | Redesign2CloseFrame
  | Redesign2VerifyResultFrame
  | Redesign2ErrorFrame
  | Redesign2PongFrame;

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isAuthFrame(value: unknown): value is Redesign2AuthFrame {
  if (!isRecord(value)) return false;
  if (value.type !== 'auth') return false;
  const payload = value.payload;
  if (!isRecord(payload)) return false;
  return typeof payload.token === 'string';
}

export function isSubscribeFrame(value: unknown): value is Redesign2SubscribeFrame {
  if (!isRecord(value)) return false;
  if (value.type !== 'subscribe') return false;
  if (!isNonEmptyString(value.id)) return false;
  const payload = value.payload;
  if (!isRecord(payload)) return false;
  if (payload.kind !== 'series' && payload.kind !== 'script') return false;
  const meta = payload.meta;
  if (!isRecord(meta)) return false;
  return (
    typeof meta.exchange === 'string' &&
    typeof meta.market === 'string' &&
    typeof meta.symbol === 'string' &&
    typeof meta.interval === 'string'
  );
}

export function isResumeFrame(value: unknown): value is Redesign2ResumeFrame {
  if (!isRecord(value)) return false;
  if (value.type !== 'resume') return false;
  if (!isNonEmptyString(value.id)) return false;
  const payload = value.payload;
  if (!isRecord(payload)) return false;
  return isFiniteNumber(payload.count) && isFiniteNumber(payload.last_time);
}

export function isRepairFrame(value: unknown): value is Redesign2RepairFrame {
  if (!isRecord(value)) return false;
  if (value.type !== 'repair') return false;
  if (!isNonEmptyString(value.id)) return false;
  const payload = value.payload;
  if (!isRecord(payload)) return false;
  return isFiniteNumber(payload.from_time);
}

export function isUnsubscribeFrame(value: unknown): value is Redesign2UnsubscribeFrame {
  if (!isRecord(value)) return false;
  if (value.type !== 'unsubscribe') return false;
  return isNonEmptyString(value.id);
}

export function isPingFrame(value: unknown): value is Redesign2PingFrame {
  return isRecord(value) && value.type === 'ping';
}

export function isPongFrame(value: unknown): value is Redesign2PongFrame {
  return isRecord(value) && value.type === 'pong';
}

export function isAuthOkFrame(value: unknown): value is Redesign2AuthOkFrame {
  return isRecord(value) && value.type === 'auth.ok';
}

export function isStatusFrame(value: unknown): value is Redesign2StatusFrame {
  if (!isRecord(value)) return false;
  if (value.type !== 'status') return false;
  const payload = value.payload;
  if (!isRecord(payload)) return false;
  if (typeof payload.code !== 'string') return false;
  return true;
}

export function isFullFrame(value: unknown): value is Redesign2FullFrame {
  if (!isRecord(value)) return false;
  if (value.type !== 'full') return false;
  if (typeof value.sessionId !== 'string' || !value.sessionId) return false;
  if (!isFiniteNumber(value.seq)) return false;
  const payload = value.payload;
  if (!isRecord(payload)) return false;
  if (typeof payload.seriesKey !== 'string') return false;
  if (!isFiniteNumber(payload.count)) return false;
  if (!isFiniteNumber(payload.closed_upto)) return false;
  return true;
}

export function isDeltaFrame(value: unknown): value is Redesign2DeltaFrame {
  if (!isRecord(value)) return false;
  if (value.type !== 'delta') return false;
  if (typeof value.sessionId !== 'string' || !value.sessionId) return false;
  if (!isFiniteNumber(value.seq)) return false;
  const payload = value.payload;
  if (!isRecord(payload)) return false;
  return (
    isFiniteNumber(payload.base_index) &&
    isFiniteNumber(payload.count) &&
    isFiniteNumber(payload.tail_len) &&
    isFiniteNumber(payload.closed_upto)
  );
}

export function isCloseFrame(value: unknown): value is Redesign2CloseFrame {
  if (!isRecord(value)) return false;
  if (value.type !== 'close') return false;
  if (typeof value.sessionId !== 'string' || !value.sessionId) return false;
  if (!isFiniteNumber(value.seq)) return false;
  const payload = value.payload;
  if (!isRecord(payload)) return false;
  if (!isFiniteNumber(payload.index)) return false;
  if (!isFiniteNumber(payload.time)) return false;
  return isRecord(payload.ohlcv);
}

export function isVerifyResultFrame(value: unknown): value is Redesign2VerifyResultFrame {
  if (!isRecord(value)) return false;
  if (value.type !== 'verify.result') return false;
  if (typeof value.sessionId !== 'string' || !value.sessionId) return false;
  const payload = value.payload;
  if (!isRecord(payload)) return false;
  return true;
}

export function isErrorFrame(value: unknown): value is Redesign2ErrorFrame {
  if (!isRecord(value)) return false;
  if (value.type !== 'error') return false;
  // The engine's `_err` helper replies `{type:"error", code, message}` with the
  // body at the **top level**, while this contract (and every other engine
  // frame) nests it under `payload`. Accept both so a genuine engine error is
  // never discarded as a malformed frame.
  const body = isRecord(value.payload) ? value.payload : value;
  if (typeof body.code !== 'string') return false;
  if (typeof body.message !== 'string') return false;
  return true;
}

export function validateRedesign2Frame(value: unknown): boolean {
  return (
    isAuthFrame(value) ||
    isSubscribeFrame(value) ||
    isResumeFrame(value) ||
    isRepairFrame(value) ||
    isUnsubscribeFrame(value) ||
    isPingFrame(value) ||
    isAuthOkFrame(value) ||
    isPongFrame(value) ||
    isStatusFrame(value) ||
    isFullFrame(value) ||
    isDeltaFrame(value) ||
    isCloseFrame(value) ||
    isVerifyResultFrame(value) ||
    isErrorFrame(value)
  );
}

/**
 * Fill an error frame's `payload` from the top-level body when the engine sent
 * the flat shape.
 *
 * The engine replies to an unauthorised or malformed frame with
 * `{type:"error", code, message, retryable}` (see `live_ws._err`), whereas the
 * AXIS contract reads every frame body from `payload` — the wire client's
 * `handleMessage` normalises here so downstream consumers (`live-wire` reads
 * `payload.message` when reporting a failed subscribe) see one shape.
 *
 * Non-error frames and already-nested errors are returned untouched.
 */
export function normalizeRedesign2Frame<T>(value: T): T {
  if (!isRecord(value) || value.type !== 'error') return value;
  if (isRecord(value.payload)) return value;
  const { code, message, retryable } = value;
  if (typeof code !== 'string' || typeof message !== 'string') return value;
  const payload: Record<string, unknown> = { code, message };
  if (retryable !== undefined) payload.retryable = retryable;
  return { ...value, payload } as T;
}

// ---------------------------------------------------------------------------
// Sequence-gap classification
// ---------------------------------------------------------------------------

export type SeqGapKind = 'continuous' | 'gap' | 'duplicate' | 'rewind';

export interface SeqGap {
  kind: SeqGapKind;
  /** How many frames were skipped (only for `gap`). */
  missing?: number;
}

/**
 * Classify the relationship between the last applied `seq` and an incoming
 * `seq`. A `gap` means frames were dropped → the caller must `resume` instead
 * of applying the delta. A `duplicate` is a safe replay → ignore.
 */
export function classifySeqGap(lastSeq: number, seq: number): SeqGap {
  if (seq === lastSeq + 1) return { kind: 'continuous' };
  if (seq === lastSeq) return { kind: 'duplicate' };
  if (seq > lastSeq + 1) return { kind: 'gap', missing: seq - lastSeq - 1 };
  return { kind: 'rewind' };
}
