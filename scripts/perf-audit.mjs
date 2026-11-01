#!/usr/bin/env bun
/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Phase 5 performance audit runner.
 *
 * Default (`bun run perf:audit`):
 *   1. `bun run typecheck`
 *   2. hot-path unit tests (append / live-append / paint latency)
 *   3. `AXIS_BENCH=1 bun test tests/bench/` (fails if firehose exceeds budget)
 *   4. write `reports/perf-audit.json`
 *
 * Extra gates:
 *   --unit / --full   also `bun run test:unit`
 *   --e2e  / --full   also Playwright `@smoke`
 *   --skip-typecheck  skip step 1
 *   --skip-bench      skip the AXIS_BENCH suites
 *   --json PATH       report path (default reports/perf-audit.json)
 *
 * Exit 1 if any step fails. Bench numbers are scraped from `AXIS_BENCH {json}`
 * lines emitted by `tests/bench/metrics.ts`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  FIREHOSE_SOFT_BUDGET_MS,
  parseBenchJsonLines,
} from '../tests/bench/metrics.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const HOT_PATH_TESTS = [
  'tests/store-append-scale.test.ts',
  'tests/live-append.test.ts',
  'tests/store-live-frame.test.ts',
  'tests/paint-latency.test.ts',
];

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const argValue = (flag, fallback) => {
  const i = argv.indexOf(flag);
  if (i < 0 || i + 1 >= argv.length) return fallback;
  const next = argv[i + 1];
  if (!next || next.startsWith('-')) return fallback;
  return next;
};

const FULL = has('--full');
const WANT_UNIT = FULL || has('--unit');
const WANT_E2E = FULL || has('--e2e');
const SKIP_TYPECHECK = has('--skip-typecheck');
const SKIP_BENCH = has('--skip-bench');
const REPORT_PATH = resolve(ROOT, argValue('--json', 'reports/perf-audit.json'));

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {Record<string, string | undefined>} [extraEnv]
 * @returns {Promise<{ ok: boolean, code: number, ms: number, stdout: string, stderr: string }>}
 */
function run(cmd, args, extraEnv = {}) {
  const t0 = performance.now();
  return new Promise((resolveRun) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on('close', (code) => {
      resolveRun({
        ok: code === 0,
        code: code ?? 1,
        ms: performance.now() - t0,
        stdout,
        stderr,
      });
    });
  });
}

/** @typedef {{ name: string, ok: boolean, ms: number, detail?: string }} Step */

const steps = /** @type {Step[]} */ ([]);
let benches = [];
let failed = false;

async function step(name, fn) {
  process.stdout.write(`\n==> ${name}\n`);
  try {
    const result = await fn();
    const ok = result?.ok !== false;
    steps.push({
      name,
      ok,
      ms: result?.ms ?? 0,
      detail: result?.detail,
    });
    if (!ok) failed = true;
    return result;
  } catch (err) {
    failed = true;
    steps.push({
      name,
      ok: false,
      ms: 0,
      detail: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, ms: 0 };
  }
}

if (!SKIP_TYPECHECK) {
  await step('typecheck', async () => {
    const r = await run('bun', ['run', 'typecheck']);
    return { ok: r.ok, ms: r.ms };
  });
}

await step('hot-path unit', async () => {
  const r = await run('bun', ['test', '--isolate', ...HOT_PATH_TESTS]);
  return { ok: r.ok, ms: r.ms };
});

if (WANT_UNIT) {
  await step('test:unit', async () => {
    const r = await run('bun', ['run', 'test:unit']);
    return { ok: r.ok, ms: r.ms };
  });
}

if (!SKIP_BENCH) {
  await step('AXIS_BENCH firehose', async () => {
    const r = await run('bun', ['test', 'tests/bench/'], { AXIS_BENCH: '1' });
    benches = parseBenchJsonLines(`${r.stdout}\n${r.stderr}`);
    const firehose = benches.find((s) => /firehose/i.test(s.label));
    const overBudget =
      firehose != null && firehose.ms >= FIREHOSE_SOFT_BUDGET_MS;
    if (overBudget) {
      process.stderr.write(
        `perf-audit: firehose ${firehose.ms.toFixed(1)}ms exceeds budget ${FIREHOSE_SOFT_BUDGET_MS}ms\n`,
      );
    }
    return {
      ok: r.ok && !overBudget,
      ms: r.ms,
      detail: benches.length
        ? benches.map((s) => `${s.label}: ${s.ms.toFixed(1)}ms`).join('; ')
        : 'no AXIS_BENCH JSON lines parsed',
    };
  });
}

if (WANT_E2E) {
  await step('e2e smoke', async () => {
    const r = await run('bun', ['run', 'test:e2e:smoke'], { CI: 'true' });
    return { ok: r.ok, ms: r.ms };
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  ok: !failed,
  firehoseBudgetMs: FIREHOSE_SOFT_BUDGET_MS,
  steps,
  benches,
  flags: {
    full: FULL,
    unit: WANT_UNIT,
    e2e: WANT_E2E,
    skipTypecheck: SKIP_TYPECHECK,
    skipBench: SKIP_BENCH,
  },
};

mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`\nperf-audit: wrote ${REPORT_PATH}\n`);
if (benches.length) {
  for (const s of benches) {
    process.stdout.write(`  ${s.label}: ${s.ms.toFixed(1)}ms (${s.ops.toLocaleString()} ops)\n`);
  }
}

process.exit(failed ? 1 : 0);
