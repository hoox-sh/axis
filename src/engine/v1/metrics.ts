/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * V1 counters (concept §8, §11).
 *
 * Counters only: cheap O(1) increments on the hot path. The old latency rings
 * (tick→apply / tick→paint / apply / queueWait / panFrame / longTask), the
 * rAF paint arming, the pan-sampling loop, the gauges (conflation / visibleBars)
 * and the long-task PerformanceObserver were removed — they sampled every tick
 * and kept 120-sample windows just to report p95 through `chart.lag` v1.
 *
 * Counters stay because they cost a single integer increment and surface
 * genuine live-path problems (seq gaps, resyncs, dropped tips, JSON fallbacks,
 * unknown opcodes).
 *
 * @module engine/v1/metrics
 */

export type V1Counter =
  'seqGap' | 'resync' | 'droppedTip' | 'jsonFallback' | 'unknownOpcode' | 'longTask';

export type V1Metrics = {
  counts: Record<V1Counter, number>;
};

const counts: Record<V1Counter, number> = {
  seqGap: 0,
  resync: 0,
  droppedTip: 0,
  jsonFallback: 0,
  unknownOpcode: 0,
  longTask: 0,
};

/** Increment a hot-path counter. Never throws. */
export function v1Count(name: V1Counter, n = 1): void {
  if (n > 0) counts[name] += n;
}

/** Snapshot the counters. Used by MCP `chart.lag` v1. */
export function v1MetricsSnapshot(): V1Metrics {
  return { counts: { ...counts } };
}

/** Tests: reset counters. */
export function _resetV1Metrics(): void {
  counts.seqGap = 0;
  counts.resync = 0;
  counts.droppedTip = 0;
  counts.jsonFallback = 0;
  counts.unknownOpcode = 0;
  counts.longTask = 0;
}
