// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Engine families.
 *
 * The scan found seventy-one places that branched on the *engine id string* —
 * `id === 'server'`, `id.includes('pyne-worker')` — to decide how the engine
 * behaves. An engine now declares its family, and the code branches on that.
 *
 * The id stays the user-facing name and the selection key; only the behaviour
 * moved to the family.
 */

import { describe, expect, it } from 'bun:test';
import {
  engineFamilyFor,
  engineFamilyForId,
  engineFamilyForText,
} from '../src/plugins/engine-family';
import { BUILTIN_ENGINES } from '../src/engines/catalog';

describe('engine families', () => {
  it('every built-in engine declares a family', () => {
    expect(BUILTIN_ENGINES.length).toBeGreaterThan(0);
    for (const engine of BUILTIN_ENGINES) {
      expect(['server', 'pyodide', 'worker', 'dynamic']).toContain(engine.family);
    }
  });

  it('resolves a built-in id to its family', () => {
    expect(engineFamilyForId('server')).toBe('server');
    expect(engineFamilyForId('pyne-worker')).toBe('worker');
    expect(engineFamilyForId('pyodide')).toBe('pyodide');
  });

  it('leaves an unknown id unknown', () => {
    // An unknown id must not be routed to the shared server or worker slot
    // by accident — the exact lookup is what the credential vault uses.
    expect(engineFamilyForId('my-server')).toBeNull();
    expect(engineFamilyForId('')).toBeNull();
  });

  it('falls back to the text heuristics for a free-form string', () => {
    expect(engineFamilyForText('pyodide-wasm')).toBe('pyodide');
    expect(engineFamilyForText('https://pyne-worker.example.workers.dev')).toBe('worker');
    expect(engineFamilyForText('http://127.0.0.1:5002')).toBe('dynamic');
    expect(engineFamilyForText('')).toBe('dynamic');
  });

  it('prefers the exact lookup over the heuristics', () => {
    expect(engineFamilyFor('server')).toBe('server');
    expect(engineFamilyFor('pyne-worker')).toBe('worker');
    expect(engineFamilyFor('pyodide')).toBe('pyodide');
  });

  it('treats an unknown id as dynamic', () => {
    expect(engineFamilyFor('my-plugin')).toBe('dynamic');
  });
});
