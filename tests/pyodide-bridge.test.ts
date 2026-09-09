/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Pyodide bridge regression: raw JSON interpolation emits `null`/`true`/
 * `false`, which are NameErrors in Python and crashed `eval_code` before
 * Pine ever ran (user saw only a truncated `_pyodide/_base.py` traceback +
 * `drawings: []`). The bridge must pass JSON strings via `globals` +
 * `json.loads`, and surface the full Python traceback.
 */

import { describe, expect, it } from 'bun:test';
import {
  callPyodideRunScript,
  formatPyodideBridgeError,
  pyodideEngine,
} from '../src/engines/catalog';

function mockPy(handler: (code: string, seen: Record<string, string>) => string) {
  const seen: Record<string, string> = {};
  return {
    seen,
    globals: { set: (k: string, v: unknown) => { seen[k] = String(v); } },
    runPython: (code: string) => handler(code, seen),
  };
}

describe('pyodide bridge', () => {
  it('passes bars via globals + json.loads (no raw null in Python source)', () => {
    const bars = [{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: null }];
    let code = '';
    const py = mockPy((c) => { code = c; return '{}'; });
    callPyodideRunScript(py as never, 'indicator("t")', bars, 'interpret', []);
    // JSON null must travel inside a quoted string for json.loads, never as a
    // bare Python literal.
    expect(code).toContain('json');
    expect(code).toContain('loads(_axis_bars_json)');
    expect(code).not.toContain('null');
    expect(code).not.toMatch(/run_script\(".*", \[/);
    // The null survived the round-trip inside the JSON payload.
    expect(py.seen['_axis_bars_json']).toContain('null');
    expect(JSON.parse(py.seen['_axis_bars_json'] as string)).toEqual(bars);
  });

  it('prefers the full stack (Python traceback) over truncated message', () => {
    const err = new Error('truncated…');
    err.stack = 'Error: truncated…\nTraceback (most recent call last):\n  File "run", line 1\nNameError: name \'null\' is not defined';
    expect(formatPyodideBridgeError(err)).toContain("NameError: name 'null' is not defined");
  });

  it('run() returns drawings: [] + full traceback on bridge failure', async () => {
    const failing = mockPy(() => {
      const err = new Error('eval_code failed…');
      err.stack = 'Error: eval_code failed…\nTraceback (most recent call last):\nNameError: name \'null\' is not defined';
      throw err;
    });
    (pyodideEngine as unknown as { _pyodide: unknown })._pyodide = failing;
    // Skip numpy load in test env.
    (failing as Record<string, unknown>).loadPackage = async () => {};
    const res = await pyodideEngine.run({
      script: 'indicator("t")',
      bars: [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: null }],
      config: { mode: 'interpret' },
    } as never);
    expect(res.status).toBe('error');
    expect((res as { drawings?: unknown }).drawings).toEqual([]);
    expect(String(res.error)).toContain('null');
    (pyodideEngine as unknown as { _pyodide: unknown })._pyodide = null;
  });
});
