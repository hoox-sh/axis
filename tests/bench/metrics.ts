/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
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

/** Machine-readable line prefix parsed by `scripts/perf-audit.mjs`. */
export const BENCH_JSON_PREFIX = 'AXIS_BENCH ';

/** JSON one-liner for `bun run perf:audit` to scrape from bench stdout. */
export function formatSampleJson(s: BenchSample): string {
  return `${BENCH_JSON_PREFIX}${JSON.stringify({
    label: s.label,
    ops: s.ops,
    ms: Number(s.ms.toFixed(3)),
    opsPerSec: Number(s.opsPerSec.toFixed(1)),
  })}`;
}

/** Parse `AXIS_BENCH {…}` lines out of a combined stdout/stderr dump. */
export function parseBenchJsonLines(text: string): BenchSample[] {
  const out: BenchSample[] = [];
  if (!text) return out;
  for (const raw of text.split('\n')) {
    const i = raw.indexOf(BENCH_JSON_PREFIX);
    if (i < 0) continue;
    try {
      const obj = JSON.parse(raw.slice(i + BENCH_JSON_PREFIX.length)) as Partial<BenchSample>;
      if (typeof obj.label === 'string' && typeof obj.ops === 'number' && typeof obj.ms === 'number') {
        out.push({
          label: obj.label,
          ops: obj.ops,
          ms: obj.ms,
          opsPerSec: typeof obj.opsPerSec === 'number' ? obj.opsPerSec : 0,
        });
      }
    } catch {
      /* ignore truncated / ANSI-wrapped lines */
    }
  }
  return out;
}

/**
 * Soft wall-time budget (ms) for firehose on modest CI hosts.
 * 500k path-updates should finish well under this on a laptop; keep slack for shared runners.
 * CI (`bun run test:bench`) fails the job when this is exceeded.
 */
export const FIREHOSE_SOFT_BUDGET_MS = 120_000;
