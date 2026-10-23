/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Tick → paint latency (HP measurement, plan §14.2).
 *
 * The PR-10 default flip is gated on production numbers, not on a feeling:
 * how long does a live tick take to reach the frame the trader sees? This
 * module answers it without touching the paint path's work:
 *
 * - {@link notePaintRequest} runs when a venue tick is **applied** to the
 *   chart (the first call since the last frame wins — many bars can land in
 *   one frame, and the oldest arrival is the honest measurement),
 * - one animation frame is armed; when it fires, the elapsed time from that
 *   arrival to the frame timestamp is stored.
 *
 * One rAF callback per burst, no steady loop, no timers. The frame that
 * follows the append is exactly the frame whose composite carries the new
 * candle (LWC renders inside the same frame), so the number is "tick to the
 * first frame that can show it", not "tick to GPU present" — the honest,
 * cheap bound an application can measure about itself.
 *
 * @module chart/paint-latency
 */

/** Samples retained for p50/p95 (a few seconds of ticks at most). */
const MAX_SAMPLES = 240;

/** rAF scheduler shape — injectable so unit tests need no browser. */
type FrameScheduler = (cb: (timestamp: number) => void) => number;

let scheduler: FrameScheduler | null = null;
let samples: number[] = [];
let pendingAt: number | null = null;
let armed = false;

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function defaultScheduler(): FrameScheduler | null {
  if (typeof globalThis.requestAnimationFrame !== 'function') return null;
  return (cb) => globalThis.requestAnimationFrame(cb);
}

/**
 * Record that an applied live tick is waiting for a frame.
 *
 * Cheap enough for the per-bar path: the first call since the last frame
 * stores the arrival time and arms one frame callback; later calls in the
 * same frame are no-ops.
 */
export function notePaintRequest(at: number = now()): void {
  if (pendingAt === null) pendingAt = at;
  if (armed) return;
  const schedule = scheduler ?? defaultScheduler();
  if (!schedule) {
    // No frames in this environment (tests, workers): do not hold a stale
    // arrival that would report a fictional latency later.
    pendingAt = null;
    return;
  }
  armed = true;
  schedule((timestamp) => {
    armed = false;
    flushPaintFrame(timestamp);
  });
}

/** Close the pending measurement at a frame timestamp (exported for tests). */
export function flushPaintFrame(frameTimestamp: number): void {
  const started = pendingAt;
  pendingAt = null;
  if (started === null) return;
  const dt = Math.max(0, frameTimestamp - started);
  samples.push(dt);
  if (samples.length > MAX_SAMPLES) samples.shift();
}

export type PaintLatencyStats = {
  /** Samples in the rolling window. */
  n: number;
  /** Newest measurement (ms). */
  last: number | null;
  p50: number | null;
  p95: number | null;
  max: number | null;
};

function percentile(sorted: readonly number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return Math.round((sorted[idx] ?? 0) * 100) / 100;
}

/** Rolling tick → frame latency: p50, p95 and the worst recent tick. */
export function paintLatencyStats(): PaintLatencyStats {
  if (!samples.length) return { n: 0, last: null, p50: null, p95: null, max: null };
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    n: samples.length,
    last: Math.round((samples[samples.length - 1] ?? 0) * 100) / 100,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: Math.round((sorted[sorted.length - 1] ?? 0) * 100) / 100,
  };
}

/** Tests: swap the frame scheduler (`null` restores the platform default). */
export function _setPaintLatencyScheduler(next: FrameScheduler | null): void {
  scheduler = next;
}

/** Tests: clear samples and any pending arrival. */
export function _resetPaintLatency(): void {
  samples = [];
  pendingAt = null;
  armed = false;
}
