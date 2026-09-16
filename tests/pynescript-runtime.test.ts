/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * CPython locks for public/pyodide/pynescript_runtime.py + the vendored wheel.
 */

import { describe, expect, it } from 'bun:test';

describe('pynescript_runtime interpret', () => {
  it('runs ta.sma and ta.stdev in interpret mode', () => {
    const proc = Bun.spawnSync(['python3', 'tests/pynescript-interpret-ta.py'], {
      cwd: `${import.meta.dir}/..`,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const err = new TextDecoder().decode(proc.stderr);
    const out = new TextDecoder().decode(proc.stdout);
    if (proc.exitCode !== 0) {
      throw new Error(`interpret-ta runtime failed:\n${err || out}`);
    }
    expect(out).toMatch(/^OK /);
  });
});
