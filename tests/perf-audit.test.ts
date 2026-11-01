/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Phase 5 quality gates — source pins for perf:audit, firehose CI, and ADRs.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BENCH_JSON_PREFIX,
  FIREHOSE_SOFT_BUDGET_MS,
  formatSample,
  formatSampleJson,
  parseBenchJsonLines,
} from './bench/metrics';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');

describe('bench JSON scrape', () => {
  const sample = {
    label: 'appendBar firehose',
    ops: 500_000,
    ms: 8012.345,
    opsPerSec: 62_405.1,
  };

  it('round-trips formatSampleJson through parseBenchJsonLines', () => {
    const line = formatSampleJson(sample);
    expect(line.startsWith(BENCH_JSON_PREFIX)).toBe(true);
    const parsed = parseBenchJsonLines(`noise\n${line}\n`);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.label).toBe(sample.label);
    expect(parsed[0]?.ops).toBe(sample.ops);
    expect(parsed[0]?.ms).toBeCloseTo(8012.345, 3);
  });

  it('ignores human formatSample lines and truncated JSON', () => {
    const human = formatSample(sample);
    const parsed = parseBenchJsonLines(`${human}\n${BENCH_JSON_PREFIX}{not-json\n`);
    expect(parsed).toEqual([]);
  });

  it('keeps a generous firehose wall budget for CI hosts', () => {
    expect(FIREHOSE_SOFT_BUDGET_MS).toBe(120_000);
  });
});

describe('perf:audit wiring', () => {
  it('package.json exposes perf:audit and perf:audit:full', () => {
    const pkg = JSON.parse(read('package.json')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['perf:audit']).toBe('bun scripts/perf-audit.mjs');
    expect(pkg.scripts['perf:audit:full']).toBe('bun scripts/perf-audit.mjs --full');
    expect(pkg.scripts['test:bench']).toContain('AXIS_BENCH=1');
  });

  it('scripts/perf-audit.mjs records AXIS_BENCH JSON and the firehose budget', () => {
    const src = read('scripts/perf-audit.mjs');
    expect(src).toContain('parseBenchJsonLines');
    expect(src).toContain('FIREHOSE_SOFT_BUDGET_MS');
    expect(src).toContain('reports/perf-audit.json');
    expect(src).toContain('--full');
    expect(src).toContain('test:e2e:smoke');
  });

  it('CI runs the firehose budget as a dedicated job', () => {
    const yml = read('.github/workflows/ci.yml');
    expect(yml).toContain('Firehose budget');
    expect(yml).toContain('bun run test:bench');
    expect(yml).toContain('AXIS_BENCH');
  });

  it('bench suites emit AXIS_BENCH JSON', () => {
    expect(read('tests/bench/append-bar-firehose.bench.test.ts')).toContain(
      'formatSampleJson',
    );
    expect(read('tests/bench/dataset-write.bench.test.ts')).toContain('formatSampleJson');
  });
});

describe('Phase 5 ADRs', () => {
  const adrs = read('docs/architecture/adrs.mdx');

  it('records ADR-017 narrow bar plane', () => {
    expect(adrs).toContain('## ADR-017: Narrow bar plane');
    expect(adrs).toContain('src/stores/bars.ts');
    expect(adrs).toContain('barPlane');
  });

  it('records ADR-018 engine result parse + typed contract', () => {
    expect(adrs).toContain('## ADR-018: Engine result parse + typed contract');
    expect(adrs).toContain('parseEngineJsonAsync');
    expect(adrs).toContain('256 KB');
    expect(adrs).toContain('normalizeEngineResult');
  });
});
