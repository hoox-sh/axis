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

/** Stage marks for one frame burst: every stamp is `performance.now()`. */
type StageMarks = {
  /** Ingest-worker publish (`IngestToHost.frames.publishedAt`). Null on the JSON path. */
  publishedAt: number | null;
  /** Main-clock receipt of the surviving publish (origin-delta pairing). */
  publishedArrivalAt: number | null;
  /** First applied live tick of the burst (same clock as the total). */
  appliedAt: number | null;
  /** HP-2 hot-ring copy-out completed. Null on the LWC-only path. */
  copyOutAt: number | null;
  /** WebGL2 overlay draw completed. Null unless the overlay painted. */
  drawAt: number | null;
  /**
   * Any append in the burst was engine-driven (ingest ring pump, engine
   * series merge/diff). Only those bursts may consume the publish stamp:
   * venue-tick appends paint the forming tip from the venue feed, and
   * pairing them with the engine's last post measures engine cadence, not
   * dispatch latency (§14.2 causal pairing).
   */
  workerCaused: boolean;
};

let scheduler: FrameScheduler | null = null;
let samples: number[] = [];
let pendingAt: number | null = null;
let armed = false;
/**
 * Bursts armed while the tab is hidden (or hidden mid-burst) are counted,
 * not sampled: rAF stops while hidden, so the arrival-to-frame delay would
 * measure the background duration instead of paint latency and pollute
 * rolling max (observed: 47 s / 96 s samples). Gate numbers stay
 * foreground-true; `suspended` says how many were skipped.
 */
let suspendedSamples = 0;
let hiddenAtArm = false;
let suspendedMidBurst = false;
let visibilityHooked = false;
let marks: StageMarks = {
  publishedAt: null,
  publishedArrivalAt: null,
  appliedAt: null,
  copyOutAt: null,
  drawAt: null,
  workerCaused: false,
};
/** Rolling per-stage deltas (ms), capped like the totals. */
let publishToApply: number[] = [];
let applyToCopyOut: number[] = [];
let copyOutToDraw: number[] = [];
/**
 * Per-message `arrival − publish` floor (ms), rolling like the totals.
 * Its minimum estimates the worker→main clock-origin delta (+ fastest
 * postMessage transit); the flush subtracts it so publish→apply reads
 * true dispatch instead of boot timing. A worker restart re-baselines as
 * the window rolls.
 */
let transitFloor: number[] = [];

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function defaultScheduler(): FrameScheduler | null {
  if (typeof globalThis.requestAnimationFrame !== 'function') return null;
  return (cb) => globalThis.requestAnimationFrame(cb);
}

/** Tab-hidden probe — `false` outside a DOM (tests, workers). */
function tabHidden(): boolean {
  try {
    return typeof document !== 'undefined' && document.hidden === true;
  } catch {
    return false;
  }
}

/**
 * Flag bursts the tab suspends mid-flight. Attached lazily on the first
 * armed burst; a no-op without a DOM. The flag is consumed (and cleared)
 * by the next frame flush.
 */
function ensureVisibilityHook(): void {
  if (visibilityHooked) return;
  visibilityHooked = true;
  try {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    document.addEventListener('visibilitychange', () => {
      try {
        if (document.hidden === true) suspendedMidBurst = true;
      } catch {
        /* visibility is best-effort telemetry */
      }
    });
  } catch {
    /* never break paint for telemetry */
  }
}

/**
 * Record that an applied live tick is waiting for a frame.
 *
 * Cheap enough for the per-bar path: the first call since the last frame
 * stores the arrival time and arms one frame callback; later calls in the
 * same frame are no-ops. `workerCaused` marks engine-driven appends; it is
 * OR-ed across the burst — any worker append in the frame lets the burst
 * consume the ingest publish stamp.
 */
export function notePaintRequest(at: number = now(), workerCaused = false): void {
  if (pendingAt === null) {
    pendingAt = at;
    if (marks.appliedAt === null) marks.appliedAt = at;
    hiddenAtArm = tabHidden();
    suspendedMidBurst = false;
    ensureVisibilityHook();
  }
  if (workerCaused) marks.workerCaused = true;
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
  if (started === null) {
    marks = {
      publishedAt: null,
      publishedArrivalAt: null,
      appliedAt: null,
      copyOutAt: null,
      drawAt: null,
      workerCaused: false,
    };
    hiddenAtArm = false;
    suspendedMidBurst = false;
    return;
  }
  if (hiddenAtArm || suspendedMidBurst) {
    // Suspended burst: the delay measures background time, not paint.
    // Count it and drop the marks so no stage inherits a stale stamp.
    suspendedSamples += 1;
    marks = {
      publishedAt: null,
      publishedArrivalAt: null,
      appliedAt: null,
      copyOutAt: null,
      drawAt: null,
      workerCaused: false,
    };
    hiddenAtArm = false;
    suspendedMidBurst = false;
    return;
  }
  const dt = Math.max(0, frameTimestamp - started);
  samples.push(dt);
  if (samples.length > MAX_SAMPLES) samples.shift();
  // Stage split: every delta is best-effort — a stage that never stamped
  // (JSON path, LWC-only paint) simply contributes no sample. The publish
  // stage additionally requires a worker-caused burst: venue-tick appends
  // must not consume the engine's publish stamp (causal pairing). The raw
  // delta mixes the worker's clock origin, so the rolling minimum transit
  // (origin delta + fastest postMessage) is subtracted, leaving true
  // post→apply dispatch. Math.max guards a restart mid-window (stale
  // floor) — the window rolls and re-baselines.
  if (
    marks.workerCaused &&
    marks.publishedAt !== null &&
    marks.publishedArrivalAt !== null &&
    marks.appliedAt !== null
  ) {
    const originDelta = transitFloor.length ? Math.min(...transitFloor) : 0;
    pushStage(publishToApply, Math.max(0, marks.appliedAt - marks.publishedAt - originDelta));
  }
  if (marks.appliedAt !== null && marks.copyOutAt !== null) {
    pushStage(applyToCopyOut, Math.max(0, marks.copyOutAt - marks.appliedAt));
  }
  if (marks.copyOutAt !== null && marks.drawAt !== null) {
    pushStage(copyOutToDraw, Math.max(0, marks.drawAt - marks.copyOutAt));
  }
  marks = {
    publishedAt: null,
    publishedArrivalAt: null,
    appliedAt: null,
    copyOutAt: null,
    drawAt: null,
    workerCaused: false,
  };
}

function pushStage(into: number[], dt: number): void {
  into.push(dt);
  if (into.length > MAX_SAMPLES) into.shift();
}

/**
 * Record the ingest worker's publish stamp for the current burst.
 *
 * Last stamp wins per burst (same rule as the arrival). `undefined` —
 * the JSON path, which never crosses a worker — leaves the burst
 * unmarked so the stage reports null instead of a fictional zero.
 *
 * The worker's `performance.now()` runs on its own time origin (worker
 * creation, seconds after the document's), so the raw stamp reads
 * seconds behind the main clock. `arrivalAt` (default: receipt time)
 * pairs each stamp with a main-clock reading; the flush subtracts the
 * rolling minimum transit as the origin-delta estimate, leaving true
 * post→apply dispatch. Tests pass both clocks explicitly.
 */
export function noteIngestPublish(at: number | undefined, arrivalAt: number = now()): void {
  if (at === undefined) return;
  // Last stamp wins: a worker `frames` message that appends nothing (a
  // snapshot over bars the chart already holds) must not lend its stamp to
  // a later burst — otherwise publish→apply measures the gap between two
  // unrelated messages (seconds on a quiet 5m chart) instead of this
  // burst's postMessage + dispatch. The stamp that survives is the message
  // being dispatched when the append lands, same task.
  marks.publishedAt = at;
  marks.publishedArrivalAt = arrivalAt;
  pushStage(transitFloor, Math.max(0, arrivalAt - at));
}

/** Record that the HP-2 hot-ring copy-out completed for this burst. */
export function noteHpCopyOut(at: number = now()): void {
  if (pendingAt === null && marks.publishedAt === null) return;
  if (marks.copyOutAt === null) marks.copyOutAt = at;
}

/** Record that the WebGL2 overlay drew this burst. */
export function noteHpGlDraw(at: number = now()): void {
  if (pendingAt === null && marks.publishedAt === null) return;
  if (marks.drawAt === null) marks.drawAt = at;
}

export type PaintStageStats = {
  /** Bursts that carried a worker publish stamp. */
  publishedBursts: number;
  /** Worker publish → main-thread apply (postMessage + dispatch). Null without HP ingest. */
  publishToApplyP50: number | null;
  /** Apply → hot-ring copy-out. Null on the LWC-only path. */
  applyToCopyOutP50: number | null;
  /** Copy-out → overlay draw. Null unless the overlay painted. */
  copyOutToDrawP50: number | null;
};

/** Rolling p50 per pipeline stage. Null = that stage never stamped. */
export function paintStageStats(): PaintStageStats {
  return {
    publishedBursts: publishToApply.length,
    publishToApplyP50: stageP50(publishToApply),
    applyToCopyOutP50: stageP50(applyToCopyOut),
    copyOutToDrawP50: stageP50(copyOutToDraw),
  };
}

function stageP50(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 0.5);
}

export type PaintLatencyStats = {
  /** Samples in the rolling window. */
  n: number;
  /** Newest measurement (ms). */
  last: number | null;
  p50: number | null;
  p95: number | null;
  max: number | null;
  /** Bursts skipped for tab suspension (armed hidden or hidden mid-burst). */
  suspended: number;
};

function percentile(sorted: readonly number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return Math.round((sorted[idx] ?? 0) * 100) / 100;
}

/** Rolling tick → frame latency: p50, p95 and the worst recent tick. */
export function paintLatencyStats(): PaintLatencyStats {
  if (!samples.length)
    return { n: 0, last: null, p50: null, p95: null, max: null, suspended: suspendedSamples };
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    n: samples.length,
    last: Math.round((samples[samples.length - 1] ?? 0) * 100) / 100,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: Math.round((sorted[sorted.length - 1] ?? 0) * 100) / 100,
    suspended: suspendedSamples,
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
  suspendedSamples = 0;
  hiddenAtArm = false;
  suspendedMidBurst = false;
  marks = {
    publishedAt: null,
    publishedArrivalAt: null,
    appliedAt: null,
    copyOutAt: null,
    drawAt: null,
    workerCaused: false,
  };
  publishToApply = [];
  applyToCopyOut = [];
  copyOutToDraw = [];
  transitFloor = [];
}

/** Tests: drop the visibility hook so a fake DOM can be re-installed. */
export function _resetPaintLatencyVisibilityHook(): void {
  visibilityHooked = false;
}
