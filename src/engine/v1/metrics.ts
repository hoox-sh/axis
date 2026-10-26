/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * v1 measurement (concept §8). Marks and counters only.
 *
 * Spans use one clock. `tick:recv` is stamped before main-thread
 * `JSON.parse`; the worker path stamps `batch:post` on receipt instead,
 * so tick→apply on that path excludes decode. The first stamp in a burst
 * wins. `queueWait` is recv → `apply:start` (main-thread queue before the
 * bridge). `apply` is `apply:start` → `apply:end`. `apply:end` arms one
 * frame for tick→paint.
 *
 * Latency rings keep the last {@link V1_WINDOW} samples and ignore the first
 * {@link V1_SKIP_WARMUP} after connect/reset so cold-start spikes do not pin
 * p95 forever. Pan/long-task rings share the window but not the warmup skip.
 *
 * @module engine/v1/metrics
 */

export type V1Mark = 'tick:recv' | 'batch:post' | 'apply:start' | 'apply:end' | 'paint:raf';

export type V1Counter = 'seqGap' | 'resync' | 'droppedTip' | 'jsonFallback' | 'unknownOpcode' | 'longTask';

export type V1Dist = {
  n: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
};

export type V1Metrics = {
  tickToApply: V1Dist;
  /** Recv (`tick:recv` / `batch:post`) → `apply:start`. */
  queueWait: V1Dist;
  tickToPaint: V1Dist;
  apply: V1Dist;
  panFrame: V1Dist;
  longTask: V1Dist;
  counts: Record<V1Counter, number>;
  conflation: 0 | 1;
  visibleBars: number;
};

/** Recent samples retained per latency / pan / long-task ring. */
export const V1_WINDOW = 120;
/** Pipeline latency samples ignored after connect/reset (cold-start). */
export const V1_SKIP_WARMUP = 16;
const PAN_HOLD_MS = 100;

type FrameScheduler = (cb: (ts: number) => void) => number;
type WarmKey = 'tickToApply' | 'queueWait' | 'tickToPaint' | 'apply';

const tickToApply: number[] = [];
const queueWait: number[] = [];
const tickToPaint: number[] = [];
const applySpan: number[] = [];
const panFrame: number[] = [];
const longTask: number[] = [];

const warmLeft: Record<WarmKey, number> = {
  tickToApply: V1_SKIP_WARMUP,
  queueWait: V1_SKIP_WARMUP,
  tickToPaint: V1_SKIP_WARMUP,
  apply: V1_SKIP_WARMUP,
};

const counts: Record<V1Counter, number> = {
  seqGap: 0,
  resync: 0,
  droppedTip: 0,
  jsonFallback: 0,
  unknownOpcode: 0,
  longTask: 0,
};

let conflation: 0 | 1 = 0;
let visibleBars = 0;
let recvAt: number | null = null;
let applyAt: number | null = null;
let paintFrom: number | null = null;
let paintArmed = false;
let panLoop = false;
let panHave = false;
let panLast = 0;
let panDeadline = 0;
let panSteps = 0;
let scheduler: FrameScheduler | null = null;
let observersStarted = false;

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function defaultScheduler(): FrameScheduler | null {
  if (typeof globalThis.requestAnimationFrame !== 'function') return null;
  return (cb) => globalThis.requestAnimationFrame(cb);
}

function tabHidden(): boolean {
  try {
    return typeof document !== 'undefined' && document.hidden === true;
  } catch {
    return false;
  }
}

function push(buf: number[], value: number, warm?: WarmKey): void {
  if (warm) {
    const left = warmLeft[warm];
    if (left > 0) {
      warmLeft[warm] = left - 1;
      return;
    }
  }
  buf.push(value);
  if (buf.length > V1_WINDOW) buf.shift();
}

function percentile(sorted: readonly number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return Math.round((sorted[idx] ?? 0) * 100) / 100;
}

function dist(buf: readonly number[]): V1Dist {
  if (!buf.length) return { n: 0, p50: null, p95: null, p99: null, max: null };
  const sorted = [...buf].sort((a, b) => a - b);
  return {
    n: buf.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: percentile(sorted, 1),
  };
}

function schedule(cb: (ts: number) => void): boolean {
  const fn = scheduler ?? defaultScheduler();
  if (!fn) return false;
  fn(cb);
  return true;
}

/** Long tasks: `long-animation-frame` where the browser has it, else `longtask`. */
export function v1EnsureObservers(): void {
  if (observersStarted) return;
  observersStarted = true;
  try {
    const PO = globalThis.PerformanceObserver;
    if (typeof PO !== 'function') return;
    const supported = PO.supportedEntryTypes ?? [];
    const type = supported.includes('long-animation-frame')
      ? 'long-animation-frame'
      : supported.includes('longtask')
        ? 'longtask'
        : '';
    if (!type) return;
    const obs = new PO((list) => {
      for (const entry of list.getEntries()) {
        counts.longTask += 1;
        push(longTask, entry.duration);
      }
    });
    obs.observe({ type, buffered: true });
  } catch {
    /* telemetry must not break the chart */
  }
}

function armPaint(): void {
  if (paintArmed || paintFrom === null) return;
  if (tabHidden()) {
    paintFrom = null;
    return;
  }
  paintArmed = true;
  if (!schedule((ts) => v1Mark('paint:raf', ts))) {
    paintArmed = false;
    paintFrom = null;
  }
}

/** Record a pipeline mark. Times are `performance.now()` milliseconds. */
export function v1Mark(name: V1Mark, at: number = now()): void {
  v1EnsureObservers();
  if (name === 'tick:recv' || name === 'batch:post') {
    if (recvAt === null) recvAt = at;
    return;
  }
  if (name === 'apply:start') {
    if (applyAt === null) {
      applyAt = at;
      if (recvAt !== null) push(queueWait, Math.max(0, at - recvAt), 'queueWait');
    }
    return;
  }
  if (name === 'apply:end') {
    if (applyAt !== null) {
      push(applySpan, Math.max(0, at - applyAt), 'apply');
      applyAt = null;
    }
    if (recvAt !== null) {
      push(tickToApply, Math.max(0, at - recvAt), 'tickToApply');
      if (paintFrom === null) paintFrom = recvAt;
      recvAt = null;
    }
    armPaint();
    return;
  }
  paintArmed = false;
  if (paintFrom !== null) {
    push(tickToPaint, Math.max(0, at - paintFrom), 'tickToPaint');
    paintFrom = null;
  }
}

export function v1Count(name: V1Counter, n = 1): void {
  if (n > 0) counts[name] += n;
}

export function v1Gauge(name: 'conflation' | 'visibleBars', value: number): void {
  if (name === 'conflation') conflation = value ? 1 : 0;
  else visibleBars = value;
}

/**
 * Keep sampling frame deltas while a pan or wheel gesture is in progress.
 * Call on each pointer-range change or wheel tick; sampling stops 100 ms
 * after the last call.
 */
export function v1NotePanActivity(at: number = now()): void {
  v1EnsureObservers();
  panDeadline = at + PAN_HOLD_MS;
  if (panLoop) return;
  panLoop = true;
  panHave = false;
  panSteps = 0;
  const step = (ts: number) => {
    if (panHave) push(panFrame, Math.max(0, ts - panLast));
    panLast = ts;
    panHave = true;
    panSteps += 1;
    // 120 frames is a stuck-scheduler cap (a real drag is ~6 frames per 100 ms).
    if (ts < panDeadline && panSteps < 120) {
      if (!schedule(step)) panLoop = false;
      return;
    }
    panLoop = false;
    panHave = false;
  };
  if (!schedule(step)) panLoop = false;
}

export function v1MetricsSnapshot(): V1Metrics {
  return {
    tickToApply: dist(tickToApply),
    queueWait: dist(queueWait),
    tickToPaint: dist(tickToPaint),
    apply: dist(applySpan),
    panFrame: dist(panFrame),
    longTask: dist(longTask),
    counts: { ...counts },
    conflation,
    visibleBars,
  };
}

/**
 * Concept §8 / §11 Perf CI: a change that grows p95 by more than 20% vs the
 * recorded fixture fails review. Equality at +20% still passes.
 */
export function v1BudgetRegressed(baseline: number, current: number, max = 0.2): boolean {
  if (!Number.isFinite(baseline) || baseline <= 0) return false;
  if (!Number.isFinite(current) || current < 0) return true;
  return current > baseline * (1 + max);
}

/** Tests: `null` restores `requestAnimationFrame`. */
export function _setV1FrameScheduler(next: FrameScheduler | null): void {
  scheduler = next;
}

/**
 * Tests: clear samples, open bursts, counters, and warmup.
 * Pass `{ warmup: 0 }` to retain the next sample immediately.
 */
export function _resetV1Metrics(opts?: { warmup?: number }): void {
  const warm = opts?.warmup ?? V1_SKIP_WARMUP;
  tickToApply.length = 0;
  queueWait.length = 0;
  tickToPaint.length = 0;
  applySpan.length = 0;
  panFrame.length = 0;
  longTask.length = 0;
  warmLeft.tickToApply = warm;
  warmLeft.queueWait = warm;
  warmLeft.tickToPaint = warm;
  warmLeft.apply = warm;
  counts.seqGap = 0;
  counts.resync = 0;
  counts.droppedTip = 0;
  counts.jsonFallback = 0;
  counts.unknownOpcode = 0;
  counts.longTask = 0;
  conflation = 0;
  visibleBars = 0;
  recvAt = null;
  applyAt = null;
  paintFrom = null;
  paintArmed = false;
  panLoop = false;
  panHave = false;
  panLast = 0;
  panDeadline = 0;
  panSteps = 0;
}
