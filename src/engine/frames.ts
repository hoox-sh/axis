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
export type DeltaBlock = {
  base_index: number;
  count: number;
  tail_len: number;
};

/** Per-subscription lifecycle states (see final/plan.mdx §7). */
export type SubscriptionStatusCode =
  'datafeed-loading' | 'datafeed-ready' | 'calculating' | 'live' | 'degraded' | 'error';

// ---------------------------------------------------------------------------
// Client → engine frames
// ---------------------------------------------------------------------------

/**
 * Client → engine auth frame, sent right after open. On the Worker proxy path this is where
 * the engine key travels, so it never appears in the upgrade URL.
 */
export type Redesign2AuthFrame = {
  type: 'auth';
  id?: string;
  ts?: number;
  payload: { token: string };
};

/**
 * Client → engine subscribe: `kind: 'series'` asks for candles, `kind: 'script'` asks for
 * plots/series evaluated over `meta`; `encoding` opts into AXB1 binary frames.
 */
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
    /** `'axb1'` or `'axb1-full'` negotiates binary frames. Absent means JSON. */
    encoding?: 'axb1' | 'axb1-full';
  };
};

/**
 * Client → engine resume: continue a subscription from `count` / `last_time` (and the last
 * applied `seq`) instead of re-sending the whole window.
 */
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
    /** Same negotiation as subscribe. Absent means JSON. */
    encoding?: 'axb1' | 'axb1-full';
  };
};

/** Client → engine repair request: re-send the series from `from_time` after a detected hole. */
export type Redesign2RepairFrame = {
  type: 'repair';
  id: string;
  ts?: number;
  payload: { from_time: number };
};

/** Client → engine unsubscribe for one subscription id; the engine may answer `close`. */
export type Redesign2UnsubscribeFrame = {
  type: 'unsubscribe';
  id: string;
  ts?: number;
  payload?: Record<string, unknown>;
};

/** Client → engine keepalive; the engine answers `pong` so a dead socket is detectable. */
export type Redesign2PingFrame = {
  type: 'ping';
  id?: string;
  ts?: number;
  payload?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Engine → client frames
// ---------------------------------------------------------------------------

/** Engine → client acknowledgement that the auth frame was accepted; subscriptions may follow. */
export type Redesign2AuthOkFrame = {
  type: 'auth.ok';
  id?: string;
  ts?: number;
  payload?: Record<string, unknown>;
};

/**
 * Engine → client subscription lifecycle update (loading, ready, calculating, live, degraded,
 * error) plus optional progress and `have`/`need` bar counts for the status bar.
 */
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

/**
 * Engine → client full snapshot for one subscription: the whole window (bars or plot columns)
 * plus `count` / `closed_upto` and the `seq` that later deltas build on.
 */
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

/**
 * Engine → client tail delta: the `DeltaBlock` splice plus `closed_upto`; `forming` marks the
 * tip scratch and `unchanged` a keepalive with no new values.
 */
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

/** Engine → client notice that bar `index` at `time` closed with this OHLCV, for verification. */
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

/**
 * Engine → client result of a bar-close verification: whether the engine corrected its copy
 * and, when it did not, the reason.
 */
export type Redesign2VerifyResultFrame = {
  type: 'verify.result';
  id?: string;
  sessionId: string;
  ts?: number;
  payload: { corrected?: boolean; reason?: string };
};

/**
 * Engine → client error frame; `retryable` drives the reconnect decision and a missing `id`
 * makes it connection-level rather than a failed request.
 */
export type Redesign2ErrorFrame = {
  type: 'error';
  id?: string;
  sessionId?: string;
  ts?: number;
  payload: { code: string; message: string; retryable?: boolean };
};

/** Engine → client reply to `ping`; the client treats its absence as a dead socket. */
export type Redesign2PongFrame = {
  type: 'pong';
  id?: string;
  ts?: number;
  payload?: Record<string, unknown>;
};

/**
 * Any frame of the Redesign2 `/ws/live` contract, in either direction. Narrow it with the
 * per-type guards before reading `payload`.
 */
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

/**
 * Narrows an untrusted frame to an auth frame (string `payload.token`).
 *
 * @param value Decoded frame from the socket or a test fixture.
 * @returns `true` when the shape matches {@link Redesign2AuthFrame}.
 */
export function isAuthFrame(value: unknown): value is Redesign2AuthFrame {
  if (!isRecord(value)) return false;
  if (value['type'] !== 'auth') return false;
  const payload = value['payload'];
  if (!isRecord(payload)) return false;
  return typeof payload['token'] === 'string';
}

/**
 * Narrows an untrusted frame to a subscribe frame: non-empty `id`, a `series`/`script` kind,
 * and a complete `meta` identity.
 *
 * @param value Decoded frame.
 * @returns `true` when the shape matches {@link Redesign2SubscribeFrame}.
 */
export function isSubscribeFrame(value: unknown): value is Redesign2SubscribeFrame {
  if (!isRecord(value)) return false;
  if (value['type'] !== 'subscribe') return false;
  if (!isNonEmptyString(value['id'])) return false;
  const payload = value['payload'];
  if (!isRecord(payload)) return false;
  if (payload['kind'] !== 'series' && payload['kind'] !== 'script') return false;
  const meta = payload['meta'];
  if (!isRecord(meta)) return false;
  return (
    typeof meta['exchange'] === 'string' &&
    typeof meta['market'] === 'string' &&
    typeof meta['symbol'] === 'string' &&
    typeof meta['interval'] === 'string'
  );
}

/**
 * Narrows an untrusted frame to a resume frame (non-empty `id`, finite `count`/`last_time`).
 *
 * @param value Decoded frame.
 * @returns `true` when the shape matches {@link Redesign2ResumeFrame}.
 */
export function isResumeFrame(value: unknown): value is Redesign2ResumeFrame {
  if (!isRecord(value)) return false;
  if (value['type'] !== 'resume') return false;
  if (!isNonEmptyString(value['id'])) return false;
  const payload = value['payload'];
  if (!isRecord(payload)) return false;
  return isFiniteNumber(payload['count']) && isFiniteNumber(payload['last_time']);
}

/**
 * Narrows an untrusted frame to a repair frame (non-empty `id`, finite `from_time`).
 *
 * @param value Decoded frame.
 * @returns `true` when the shape matches {@link Redesign2RepairFrame}.
 */
export function isRepairFrame(value: unknown): value is Redesign2RepairFrame {
  if (!isRecord(value)) return false;
  if (value['type'] !== 'repair') return false;
  if (!isNonEmptyString(value['id'])) return false;
  const payload = value['payload'];
  if (!isRecord(payload)) return false;
  return isFiniteNumber(payload['from_time']);
}

/**
 * Narrows an untrusted frame to an unsubscribe frame (only a non-empty `id` is required).
 *
 * @param value Decoded frame.
 * @returns `true` when the shape matches {@link Redesign2UnsubscribeFrame}.
 */
export function isUnsubscribeFrame(value: unknown): value is Redesign2UnsubscribeFrame {
  if (!isRecord(value)) return false;
  if (value['type'] !== 'unsubscribe') return false;
  return isNonEmptyString(value['id']);
}

/**
 * Narrows an untrusted frame to a ping frame; the discriminant is the only requirement.
 *
 * @param value Decoded frame.
 * @returns `true` when `type` is `ping`.
 */
export function isPingFrame(value: unknown): value is Redesign2PingFrame {
  return isRecord(value) && value['type'] === 'ping';
}

/**
 * Narrows an untrusted frame to a pong frame; the discriminant is the only requirement.
 *
 * @param value Decoded frame.
 * @returns `true` when `type` is `pong`.
 */
export function isPongFrame(value: unknown): value is Redesign2PongFrame {
  return isRecord(value) && value['type'] === 'pong';
}

/**
 * Narrows an untrusted frame to an auth acknowledgement.
 *
 * @param value Decoded frame.
 * @returns `true` when `type` is `auth.ok`.
 */
export function isAuthOkFrame(value: unknown): value is Redesign2AuthOkFrame {
  return isRecord(value) && value['type'] === 'auth.ok';
}

/**
 * Whether a connection-level error should permanently stop reconnects.
 *
 * PYNE `UNAUTHORIZED` / "Authenticate first" means the socket is not yet
 * authed (pre-auth ping or race) — retryable by resending auth or reconnecting.
 * Permanent failures (invalid/missing API key, other non-retryable codes) block.
 */
export function shouldAuthBlock(frame: {
  type?: unknown;
  id?: unknown;
  payload?: unknown;
  /** Flat error shape (some relays put code/message on the frame). */
  code?: unknown;
  message?: unknown;
  retryable?: unknown;
}): boolean {
  if (frame?.type !== 'error') return false;
  if (frame.id) return false;
  const payload =
    frame.payload && typeof frame.payload === 'object'
      ? (frame.payload as { code?: unknown; message?: unknown; retryable?: unknown })
      : null;
  const retryable = payload?.retryable ?? frame.retryable;
  if (retryable !== false) return false;
  const code = String(payload?.code ?? frame.code ?? '')
    .trim()
    .toUpperCase();
  const message = String(payload?.message ?? frame.message ?? '')
    .trim()
    .toLowerCase();
  if (code === 'UNAUTHORIZED') return false;
  if (message.includes('authenticate first')) return false;
  return true;
}

/**
 * Narrows an untrusted frame to a status frame (object `payload` with a string `code`).
 *
 * @param value Decoded frame.
 * @returns `true` when the shape matches {@link Redesign2StatusFrame}.
 */
export function isStatusFrame(value: unknown): value is Redesign2StatusFrame {
  if (!isRecord(value)) return false;
  if (value['type'] !== 'status') return false;
  const payload = value['payload'];
  if (!isRecord(payload)) return false;
  if (typeof payload['code'] !== 'string') return false;
  return true;
}

/**
 * Narrows an untrusted frame to a full snapshot: non-empty `sessionId`, finite `seq`, and a
 * payload carrying `seriesKey`, `count` and `closed_upto`.
 *
 * @param value Decoded frame.
 * @returns `true` when the shape matches {@link Redesign2FullFrame}.
 */
export function isFullFrame(value: unknown): value is Redesign2FullFrame {
  if (!isRecord(value)) return false;
  if (value['type'] !== 'full') return false;
  if (typeof value['sessionId'] !== 'string' || !value['sessionId']) return false;
  if (!isFiniteNumber(value['seq'])) return false;
  const payload = value['payload'];
  if (!isRecord(payload)) return false;
  if (typeof payload['seriesKey'] !== 'string') return false;
  if (!isFiniteNumber(payload['count'])) return false;
  if (!isFiniteNumber(payload['closed_upto'])) return false;
  return true;
}

/**
 * Narrows an untrusted frame to a delta: non-empty `sessionId`, finite `seq`, and a finite
 * `base_index` / `count` / `tail_len` / `closed_upto` block the splice can trust.
 *
 * @param value Decoded frame.
 * @returns `true` when the shape matches {@link Redesign2DeltaFrame}.
 */
export function isDeltaFrame(value: unknown): value is Redesign2DeltaFrame {
  if (!isRecord(value)) return false;
  if (value['type'] !== 'delta') return false;
  if (typeof value['sessionId'] !== 'string' || !value['sessionId']) return false;
  if (!isFiniteNumber(value['seq'])) return false;
  const payload = value['payload'];
  if (!isRecord(payload)) return false;
  return (
    isFiniteNumber(payload['base_index']) &&
    isFiniteNumber(payload['count']) &&
    isFiniteNumber(payload['tail_len']) &&
    isFiniteNumber(payload['closed_upto'])
  );
}

/**
 * Narrows an untrusted frame to a bar-close notice: non-empty `sessionId`, finite `seq`, and a
 * payload with `index`, `time` and an `ohlcv` object.
 *
 * @param value Decoded frame.
 * @returns `true` when the shape matches {@link Redesign2CloseFrame}.
 */
export function isCloseFrame(value: unknown): value is Redesign2CloseFrame {
  if (!isRecord(value)) return false;
  if (value['type'] !== 'close') return false;
  if (typeof value['sessionId'] !== 'string' || !value['sessionId']) return false;
  if (!isFiniteNumber(value['seq'])) return false;
  const payload = value['payload'];
  if (!isRecord(payload)) return false;
  if (!isFiniteNumber(payload['index'])) return false;
  if (!isFiniteNumber(payload['time'])) return false;
  return isRecord(payload['ohlcv']);
}

/**
 * Narrows an untrusted frame to a verify result (non-empty `sessionId`, object `payload`).
 *
 * @param value Decoded frame.
 * @returns `true` when the shape matches {@link Redesign2VerifyResultFrame}.
 */
export function isVerifyResultFrame(value: unknown): value is Redesign2VerifyResultFrame {
  if (!isRecord(value)) return false;
  if (value['type'] !== 'verify.result') return false;
  if (typeof value['sessionId'] !== 'string' || !value['sessionId']) return false;
  const payload = value['payload'];
  if (!isRecord(payload)) return false;
  return true;
}

/**
 * Narrows an untrusted frame to an error, accepting both the nested `payload` shape and the
 * engine's flat `{type, code, message}` reply so a real error is never dropped as malformed.
 *
 * @param value Decoded frame.
 * @returns `true` when the shape matches {@link Redesign2ErrorFrame}.
 */
export function isErrorFrame(value: unknown): value is Redesign2ErrorFrame {
  if (!isRecord(value)) return false;
  if (value['type'] !== 'error') return false;
  // The engine's `_err` helper replies `{type:"error", code, message}` with the
  // body at the **top level**, while this contract (and every other engine
  // frame) nests it under `payload`. Accept both so a genuine engine error is
  // never discarded as a malformed frame.
  const body = isRecord(value['payload']) ? value['payload'] : value;
  if (typeof body['code'] !== 'string') return false;
  if (typeof body['message'] !== 'string') return false;
  return true;
}

/**
 * Contract gate for any inbound frame: true when at least one per-type guard accepts it.
 * The wire client logs and skips frames that fail here.
 *
 * @param value Decoded frame.
 * @returns `true` when the frame matches any {@link Redesign2Frame} variant.
 */
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
  if (!isRecord(value) || value['type'] !== 'error') return value;
  if (isRecord(value['payload'])) return value;
  const { code, message, retryable } = value;
  if (typeof code !== 'string' || typeof message !== 'string') return value;
  const payload: Record<string, unknown> = { code, message };
  if (retryable !== undefined) payload['retryable'] = retryable;
  return { ...value, payload } as T;
}

/**
 * Exponential reconnect delay with downward jitter, never above `cap`.
 * `attempt` is how many failures have already been scheduled.
 */
/**
 * Reconnect backoff: exponential from `initial`, capped, with downward jitter of up to 20 % so
 * reconnecting tabs do not retry in lockstep.
 *
 * @param attempt Failures already scheduled (clamped to 10 doublings).
 * @param initial First delay in ms.
 * @param cap Upper bound in ms.
 * @param rand Random source in `[0, 1)`; injected by tests.
 * @returns Delay in ms, never above `cap`.
 */
export function reconnectDelayMs(
  attempt: number,
  initial = 500,
  cap = 30_000,
  rand = Math.random,
): number {
  const exp = Math.min(cap, initial * 2 ** Math.min(Math.max(0, attempt), 10));
  const span = Math.floor(exp * 0.2);
  if (span <= 0) return exp;
  return exp - Math.floor(rand() * (span + 1));
}

// ---------------------------------------------------------------------------
// Sequence-gap classification
// ---------------------------------------------------------------------------

/** Relationship between the last applied `seq` and an incoming one. */
export type SeqGapKind = 'continuous' | 'gap' | 'duplicate' | 'rewind';

/**
 * Classified seq relationship plus, for a `gap`, how many frames were skipped — the signal to
 * `resume` instead of applying the delta.
 */
export interface SeqGap {
  kind: SeqGapKind;
  /** How many frames were skipped (only for `gap`). */
  missing?: number;
}

/**
 * Classify the relationship between the last applied `seq` and an incoming
 * `seq`. A `gap` means frames were dropped → the caller must `resume` instead
 * of applying the delta. A `duplicate` is a safe replay → ignore.
 *
 * `ackFrom` is the cursor the coalescer released before this frame. It is
 * set only when every seq in `(ackFrom, seq)` was a frame this process
 * folded or dropped. JSON decode strips the field, so a socket payload
 * cannot invent it.
 */
export function classifySeqGap(lastSeq: number, seq: number, ackFrom?: number): SeqGap {
  if (seq === lastSeq + 1) return { kind: 'continuous' };
  if (seq === lastSeq) return { kind: 'duplicate' };
  if (seq > lastSeq + 1) {
    if (ackFrom === lastSeq) return { kind: 'continuous' };
    return { kind: 'gap', missing: seq - lastSeq - 1 };
  }
  return { kind: 'rewind' };
}

/** Drop a coalescer ack so a network frame cannot suppress gap detection. */
/**
 * Drops the coalescer's `seqAckFrom` hint from a frame that crossed the network, so a decoded
 * payload cannot claim skipped frames were folded and suppress gap detection.
 *
 * @param frame Any frame; returned unchanged unless it carries `payload.seqAckFrom`.
 * @returns The frame without the ack field (a new object when it had to be stripped).
 */
export function stripSeqAck<T>(frame: T): T {
  if (!isRecord(frame) || !isRecord(frame['payload']) || !('seqAckFrom' in frame['payload']))
    return frame;
  const { seqAckFrom: _ack, ...payload } = frame['payload'];
  void _ack;
  return { ...frame, payload } as T;
}
