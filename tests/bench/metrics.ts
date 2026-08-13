/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Lightweight wall-clock helpers for optional AXIS_BENCH suites.
 * Soft budgets only — fail when grossly slow, not on micro-regressions.
 */

export type BenchSample = {
  label: string;
  ops: number;
  ms: number;
  opsPerSec: number;
};

/** High-res elapsed ms (Bun / Node performance.now). */
export function nowMs(): number {
  return performance.now();
}

/**
 * Time `fn` and return ops/sec for `ops` work units.
 * Does not throw; callers apply soft budgets with `expect`.
 */
export function measureOps(label: string, ops: number, fn: () => void): BenchSample {
  const t0 = nowMs();
  fn();
  const ms = Math.max(0.001, nowMs() - t0);
  const opsPerSec = (ops / ms) * 1000;
  return { label, ops, ms, opsPerSec };
}

/** Human-readable one-liner for console / CI logs. */
export function formatSample(s: BenchSample): string {
  const kops = (s.opsPerSec / 1000).toFixed(1);
  return `${s.label}: ${s.ops.toLocaleString()} ops in ${s.ms.toFixed(1)}ms (${kops}k ops/s)`;
}

/**
 * Soft wall-time budget (ms) for firehose on modest CI hosts.
 * 500k path-updates should finish well under this on a laptop; keep slack for shared runners.
 */
export const FIREHOSE_SOFT_BUDGET_MS = 120_000;
