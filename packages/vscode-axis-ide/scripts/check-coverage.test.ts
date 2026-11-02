// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BASELINE,
  evaluateCoverage,
  excluded,
  INCLUDE,
  parseMinPercent,
  runCli,
  TARGET_HOST,
  TARGET_HOST_DESIGN,
} from './check-coverage.mjs';

function lcovFile(path: string, lines: Array<[number, number]>): string {
  const da = lines.map(([line, hits]) => `DA:${line},${hits}`).join('\n');
  return `SF:${path}\n${da}\nend_of_record\n`;
}

describe('check-coverage helpers', () => {
  test('INCLUDE lists pure-host dirs including src/secrets/', () => {
    expect(INCLUDE).toContain('src/protocol/');
    expect(INCLUDE).toContain('src/host/');
    expect(INCLUDE).toContain('src/secrets/');
    expect(INCLUDE).toContain('src/run/');
    expect(INCLUDE).toContain('src/live/');
  });

  test('EXCLUDE matches relative out/ dist/ vendor/ paths', () => {
    expect(excluded('out/extension.js')).toBe(true);
    expect(excluded('dist/webview/main.js')).toBe(true);
    expect(excluded('webview/vendor/lwc.js')).toBe(true);
    expect(excluded('src/protocol/codec.ts')).toBe(false);
  });

  test('parseMinPercent rejects NaN and out-of-range', () => {
    expect(parseMinPercent(undefined)).toBe(BASELINE);
    expect(parseMinPercent('90')).toBe(90);
    const bad = parseMinPercent('NaN');
    expect(typeof bad).toBe('object');
    expect((bad as { error: string }).error).toContain('finite');
    expect((parseMinPercent('-1') as { error: string }).error).toContain('0–100');
    expect((parseMinPercent('101') as { error: string }).error).toContain('0–100');
  });

  test('TARGET_HOST is at least design 90 and BASELINE', () => {
    expect(TARGET_HOST).toBe(Math.max(TARGET_HOST_DESIGN, BASELINE));
    expect(TARGET_HOST).toBeGreaterThanOrEqual(BASELINE);
  });
});

describe('evaluateCoverage fixtures', () => {
  test('fails when protocol below 100%', () => {
    const text =
      lcovFile('src/protocol/codec.ts', [
        [1, 1],
        [2, 0],
      ]) + lcovFile('src/host/logger.ts', [[1, 1]]);
    const result = evaluateCoverage({
      text,
      min: 50,
      packageRoot: process.cwd(),
      skipDiskCheck: true,
      protocolMin: 100,
    });
    expect(result.ok).toBe(false);
    expect(result.lines.some((l) => l.includes('FAIL protocol'))).toBe(true);
  });

  test('fails when pure-host below BASELINE', () => {
    const text =
      lcovFile('src/protocol/codec.ts', [
        [1, 1],
        [2, 1],
      ]) +
      lcovFile('src/host/logger.ts', [
        [1, 1],
        [2, 0],
      ]);
    const result = evaluateCoverage({
      text,
      min: 90,
      packageRoot: process.cwd(),
      skipDiskCheck: true,
      protocolMin: 50,
    });
    expect(result.ok).toBe(false);
    expect(result.lines.some((l) => l.includes('FAIL pure-host'))).toBe(true);
  });

  test('fails when INCLUDE file on disk is missing from lcov', () => {
    const root = mkdtempSync(join(tmpdir(), 'axis-cov-'));
    mkdirSync(join(root, 'src/protocol'), { recursive: true });
    writeFileSync(join(root, 'src/protocol/codec.ts'), 'export const x = 1;\n');
    writeFileSync(join(root, 'src/protocol/types.ts'), 'export const y = 1;\n');

    const text = lcovFile('src/protocol/codec.ts', [[1, 1]]);
    const result = evaluateCoverage({
      text,
      min: 0,
      packageRoot: root,
      skipDiskCheck: false,
      protocolMin: 0,
    });
    expect(result.ok).toBe(false);
    expect(result.lines.some((l) => l.includes('missing from lcov'))).toBe(true);
    expect(result.lines.some((l) => l.includes('types.ts'))).toBe(true);
  });

  test('passes full-hit fixture with disk check skipped', () => {
    const text =
      lcovFile('src/protocol/codec.ts', [[1, 1]]) + lcovFile('src/host/logger.ts', [[1, 1]]);
    const result = evaluateCoverage({
      text,
      min: 100,
      packageRoot: process.cwd(),
      skipDiskCheck: true,
      protocolMin: 100,
    });
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  test('fails early when lcov has no pure-host DA lines (webview-only)', () => {
    const text = lcovFile('webview/chart/main.ts', [[1, 1]]);
    const result = evaluateCoverage({
      text,
      min: 100,
      packageRoot: process.cwd(),
      skipDiskCheck: true,
      protocolMin: 100,
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.lines.some((l) => l.includes('no DA lines found in scoped pure-host'))).toBe(
      true,
    );
  });

  test('fails early when lcov has host DA but no protocol DA', () => {
    const text = lcovFile('src/host/logger.ts', [[1, 1]]);
    const result = evaluateCoverage({
      text,
      min: 0,
      packageRoot: process.cwd(),
      skipDiskCheck: true,
      protocolMin: 100,
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.lines.some((l) => l.includes('no protocol DA lines'))).toBe(true);
  });
});

describe('runCli', () => {
  test('exits 1 on missing lcov', async () => {
    const root = mkdtempSync(join(tmpdir(), 'axis-cov-cli-'));
    let code = 0;
    const lines: string[] = [];
    await runCli(['100', join(root, 'missing.info')], {
      cwd: root,
      log: (s) => lines.push(String(s)),
      error: (s) => lines.push(String(s)),
      exit: (c) => {
        code = c;
      },
    });
    expect(code).toBe(1);
    expect(lines.some((l) => l.includes('missing'))).toBe(true);
  });

  test('exits 1 on NaN minPercent', async () => {
    let code = 0;
    const lines: string[] = [];
    await runCli(['NaN', 'coverage/lcov.info'], {
      cwd: process.cwd(),
      log: (s) => lines.push(String(s)),
      error: (s) => lines.push(String(s)),
      exit: (c) => {
        code = c;
      },
    });
    expect(code).toBe(1);
    expect(lines.some((l) => l.includes('finite'))).toBe(true);
  });
});
