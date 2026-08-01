// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure bar-replay state machine (TradingView-style history scrubbing).
 *
 * No DOM / Solid — unit-testable transitions over a fixed OHLCV length.
 * UI holds a timer and calls {@link tick} / {@link step}; chart hosts call
 * {@link visibleBars} / {@link getVisibleBars} when a session is active.
 *
 * @module chart/bar-replay
 */

/** Immutable snapshot of a replay session. */
export interface ReplayState {
  /** True while the user is in bar-replay mode (chart shows a prefix of history). */
  active: boolean;
  /** Last visible bar index, inclusive. Clamped to `[0, barsLength-1]` when length > 0. */
  cursorIndex: number;
  /**
   * Advance rate for {@link tick} while playing.
   * Integer ≥ 1: bars advanced per tick (1 = 1×, 2 = 2×, …).
   */
  speed: number;
  /** Auto-advance via {@link tick} when true. */
  playing: boolean;
}

/** Default play speeds exposed to UI (bars per tick). */
export const REPLAY_SPEEDS = [1, 2, 5, 10] as const;

/** Base wall-clock ms between ticks at 1× (UI timer). */
export const REPLAY_TICK_MS = 200;

const DEFAULT_SPEED = 1;

function clampCursor(index: number, barsLength: number): number {
  if (barsLength <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  const i = Math.trunc(index);
  if (i < 0) return 0;
  if (i > barsLength - 1) return barsLength - 1;
  return i;
}

function normalizeSpeed(speed: number): number {
  if (!Number.isFinite(speed) || speed < 1) return DEFAULT_SPEED;
  return Math.max(1, Math.trunc(speed));
}

/**
 * Start a replay session over `barsLength` historical bars.
 *
 * Cursor defaults to the **last** bar so the full history stays visible
 * (one-candle zoom on enter is confusing). User scrubs/steps back to pick a
 * start, then Play; pressing Play while already at the end restarts from bar 0.
 *
 * Pass `opts.cursorIndex` to override (e.g. 0 for “from start”).
 */
export function createReplay(
  barsLength: number,
  opts?: { cursorIndex?: number },
): ReplayState {
  const len = Math.max(0, Math.trunc(barsLength) || 0);
  const defaultCursor = len > 0 ? len - 1 : 0;
  const cursor =
    opts?.cursorIndex != null
      ? clampCursor(opts.cursorIndex, len)
      : defaultCursor;
  return {
    active: true,
    cursorIndex: cursor,
    speed: DEFAULT_SPEED,
    playing: false,
  };
}

/** Idle / non-replay state (after stop or before start). */
export function idleReplay(): ReplayState {
  return {
    active: false,
    cursorIndex: 0,
    speed: DEFAULT_SPEED,
    playing: false,
  };
}

/** Move the cursor to an absolute bar index (clamped). No-op when inactive. */
export function setCursor(
  state: ReplayState,
  index: number,
  barsLength: number,
): ReplayState {
  if (!state.active) return state;
  const next = clampCursor(index, barsLength);
  if (next === state.cursorIndex) return state;
  return { ...state, cursorIndex: next };
}

/**
 * Step the cursor by `delta` bars (+1 forward / −1 back).
 * Clamped to bounds; no wrap. No-op when inactive.
 */
export function step(
  state: ReplayState,
  delta: number,
  barsLength: number,
): ReplayState {
  if (!state.active) return state;
  if (!Number.isFinite(delta) || delta === 0) return state;
  return setCursor(state, state.cursorIndex + Math.trunc(delta), barsLength);
}

/**
 * Begin auto-advance. No-op when inactive.
 * If the cursor is already on the last bar, restart from bar 0 and play
 * (media-player style — avoids a dead Play button after enter-at-end).
 */
export function play(state: ReplayState, barsLength = Infinity): ReplayState {
  if (!state.active) return state;
  const last = Number.isFinite(barsLength)
    ? Math.max(0, Math.trunc(barsLength) - 1)
    : Number.POSITIVE_INFINITY;
  if (Number.isFinite(last) && state.cursorIndex >= last) {
    // At end: restart from first bar and play forward
    if (last <= 0) {
      return state.playing ? { ...state, playing: false } : state;
    }
    return { ...state, cursorIndex: 0, playing: true };
  }
  if (state.playing) return state;
  return { ...state, playing: true };
}

/** Pause auto-advance; stay in replay mode. */
export function pause(state: ReplayState): ReplayState {
  if (!state.active || !state.playing) return state;
  return { ...state, playing: false };
}

/** Exit replay entirely (inactive, not playing). */
export function stop(_state?: ReplayState): ReplayState {
  return idleReplay();
}

/** Change play speed (bars per tick). No-op when inactive. */
export function setSpeed(state: ReplayState, speed: number): ReplayState {
  if (!state.active) return state;
  const next = normalizeSpeed(speed);
  if (next === state.speed) return state;
  return { ...state, speed: next };
}

/**
 * One playhead tick while `playing`: advance by `speed` bars.
 * When the cursor hits the last bar, auto-pauses.
 * No-op when not playing or inactive.
 */
export function tick(state: ReplayState, barsLength: number): ReplayState {
  if (!state.active || !state.playing) return state;
  const len = Math.max(0, Math.trunc(barsLength) || 0);
  if (len <= 0) return { ...state, playing: false };

  const last = len - 1;
  if (state.cursorIndex >= last) {
    return state.playing ? { ...state, playing: false } : state;
  }

  const advanced = Math.min(last, state.cursorIndex + state.speed);
  const next: ReplayState = {
    ...state,
    cursorIndex: advanced,
  };
  if (advanced >= last) {
    next.playing = false;
  }
  return next;
}

/**
 * Bars visible under the current cursor (prefix of history).
 * When inactive, returns the full series unchanged.
 */
export function visibleBars<T>(bars: readonly T[], state: ReplayState): T[] {
  if (!state.active) return bars.slice();
  if (!bars.length) return [];
  const end = Math.min(bars.length, clampCursor(state.cursorIndex, bars.length) + 1);
  return bars.slice(0, end);
}

/** True when cursor is on the last loaded bar. */
export function isAtEnd(state: ReplayState, barsLength: number): boolean {
  if (barsLength <= 0) return true;
  return state.cursorIndex >= barsLength - 1;
}

/** True when cursor is on the first bar. */
export function isAtStart(state: ReplayState): boolean {
  return state.cursorIndex <= 0;
}

// ─── Optional module session (helpers for ChartHost / controls) ─────────────

type ReplayListener = (state: ReplayState) => void;

let sessionState: ReplayState = idleReplay();
let sessionBarsLength = 0;
const listeners = new Set<ReplayListener>();

function emit() {
  for (const fn of listeners) {
    try {
      fn(sessionState);
    } catch {
      /* ignore listener errors */
    }
  }
}

function applySession(next: ReplayState, barsLength?: number): ReplayState {
  if (barsLength != null) {
    sessionBarsLength = Math.max(0, Math.trunc(barsLength) || 0);
  }
  // Re-clamp cursor if length known
  if (next.active && sessionBarsLength > 0) {
    const c = clampCursor(next.cursorIndex, sessionBarsLength);
    if (c !== next.cursorIndex) next = { ...next, cursorIndex: c };
  }
  sessionState = next;
  emit();
  return sessionState;
}

/** Current session snapshot (idle when no replay). */
export function getReplayState(): ReplayState {
  return sessionState;
}

/** Bars length last passed to the session helpers. */
export function getReplayBarsLength(): number {
  return sessionBarsLength;
}

export function isReplayActive(): boolean {
  return sessionState.active;
}

/**
 * Visible slice for chart paint. When replay is inactive, returns `bars` as-is
 * (same reference when possible for memo stability).
 */
export function getVisibleBars<T>(bars: readonly T[]): T[] {
  if (!sessionState.active) return bars as T[];
  return visibleBars(bars, sessionState);
}

/** Subscribe to session changes; returns unsubscribe. */
export function subscribeReplay(listener: ReplayListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Enter replay over the given history length.
 * Default cursor = last bar (full series visible). Pass `cursorIndex` to override.
 */
export function startReplaySession(
  barsLength: number,
  opts?: { cursorIndex?: number },
): ReplayState {
  sessionBarsLength = Math.max(0, Math.trunc(barsLength) || 0);
  return applySession(createReplay(sessionBarsLength, opts));
}

/** Exit replay session. */
export function stopReplaySession(): ReplayState {
  sessionBarsLength = 0;
  return applySession(stop(sessionState));
}

/** Update bars length (e.g. after reload) without leaving replay; clamps cursor. */
export function setReplayBarsLength(barsLength: number): ReplayState {
  sessionBarsLength = Math.max(0, Math.trunc(barsLength) || 0);
  if (!sessionState.active) return sessionState;
  return applySession(
    setCursor(sessionState, sessionState.cursorIndex, sessionBarsLength),
    sessionBarsLength,
  );
}

/** Apply a pure transition against the module session. */
export function updateReplaySession(
  updater: (state: ReplayState, barsLength: number) => ReplayState,
): ReplayState {
  return applySession(updater(sessionState, sessionBarsLength));
}
