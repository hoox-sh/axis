/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * AXIS debug mode (`src/debug.ts`) — the `.env` gate that turns on
 * `[axis:chart]` / `[axis:engine]` logs.
 *
 * Bun maps `import.meta.env` onto `process.env`, so the flag is exercised by
 * mutating `process.env.VITE_AXIS_DEBUG` / `VITE_DEBUG` around each assertion
 * and restoring afterwards (Bun auto-loads the repo `.env`).
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  AXIS_DEBUG_ENV_ALIAS,
  AXIS_DEBUG_ENV_KEY,
  AXIS_DEBUG_STORAGE_KEY,
  announceAxisDebug,
  axisDebug,
  axisDebugSafeUrl,
  axisDebugSource,
  chartDebug,
  engineDebug,
  engineDebugSample,
  isAxisDebug,
  resetAxisDebugSamples,
} from '../src/debug';
import { installMemoryLocalStorage } from './setup';

const originalAxis = process.env[AXIS_DEBUG_ENV_KEY];
const originalAlias = process.env[AXIS_DEBUG_ENV_ALIAS];

function clearFlags() {
  delete process.env[AXIS_DEBUG_ENV_KEY];
  delete process.env[AXIS_DEBUG_ENV_ALIAS];
}

afterEach(() => {
  if (originalAxis === undefined) delete process.env[AXIS_DEBUG_ENV_KEY];
  else process.env[AXIS_DEBUG_ENV_KEY] = originalAxis;
  if (originalAlias === undefined) delete process.env[AXIS_DEBUG_ENV_ALIAS];
  else process.env[AXIS_DEBUG_ENV_ALIAS] = originalAlias;
  resetAxisDebugSamples();
});

describe('isAxisDebug', () => {
  it('is off when the flag is absent', () => {
    clearFlags();
    expect(isAxisDebug()).toBe(false);
    expect(axisDebugSource()).toBe('off');
  });

  it('accepts the documented truthy values on VITE_AXIS_DEBUG', () => {
    clearFlags();
    for (const value of ['1', 'true', 'yes', ' TRUE ', 'Yes']) {
      process.env[AXIS_DEBUG_ENV_KEY] = value;
      expect(isAxisDebug()).toBe(true);
      expect(axisDebugSource()).toBe('env');
    }
  });

  it('accepts the VITE_DEBUG alias', () => {
    clearFlags();
    process.env[AXIS_DEBUG_ENV_ALIAS] = '1';
    expect(isAxisDebug()).toBe(true);
    expect(axisDebugSource()).toBe('env');
  });

  it('rejects everything else (including the e2e override)', () => {
    clearFlags();
    for (const value of ['0', 'false', 'no', 'off', '', 'nope']) {
      process.env[AXIS_DEBUG_ENV_KEY] = value;
      expect(isAxisDebug()).toBe(false);
    }
  });

  it('turns on from localStorage.axis.debug when env is off', () => {
    clearFlags();
    const mem = installMemoryLocalStorage();
    mem.setItem(AXIS_DEBUG_STORAGE_KEY, '1');
    resetAxisDebugSamples();
    expect(isAxisDebug()).toBe(true);
    expect(axisDebugSource()).toBe('storage');
    mem.removeItem(AXIS_DEBUG_STORAGE_KEY);
    resetAxisDebugSamples();
    expect(isAxisDebug()).toBe(false);
  });
});

describe('axisDebug logger', () => {
  const debugCalls: unknown[][] = [];
  const infoCalls: unknown[][] = [];
  let origDebug: typeof console.debug;
  let origInfo: typeof console.info;

  beforeEach(() => {
    debugCalls.length = 0;
    infoCalls.length = 0;
    origDebug = console.debug;
    origInfo = console.info;
    console.debug = (...args: unknown[]) => {
      debugCalls.push(args);
    };
    console.info = (...args: unknown[]) => {
      infoCalls.push(args);
    };
    resetAxisDebugSamples();
  });

  afterEach(() => {
    console.debug = origDebug;
    console.info = origInfo;
  });

  it('is silent when the flag is off', () => {
    clearFlags();
    chartDebug('setData', { n: 10 });
    engineDebug('ws.open');
    announceAxisDebug();
    expect(debugCalls).toEqual([]);
    expect(infoCalls).toEqual([]);
  });

  it('emits scoped console.debug lines when on', () => {
    clearFlags();
    process.env[AXIS_DEBUG_ENV_KEY] = '1';
    chartDebug('setData', { n: 10, fit: true });
    engineDebug('ws.open', { first: true });
    axisDebug('chart', 'action.menu', { id: 'view.reset' });
    expect(debugCalls).toHaveLength(3);
    expect(debugCalls[0]?.[0]).toBe('[axis:chart] setData');
    expect(debugCalls[0]?.[1]).toEqual({ n: 10, fit: true });
    expect(debugCalls[1]?.[0]).toBe('[axis:engine] ws.open');
    expect(debugCalls[2]?.[0]).toBe('[axis:chart] action.menu');
  });

  it('samples repeated live events', () => {
    clearFlags();
    process.env[AXIS_DEBUG_ENV_KEY] = '1';
    engineDebugSample('apply.delta', { count: 1 }, 10_000);
    engineDebugSample('apply.delta', { count: 2 }, 10_000);
    expect(debugCalls).toHaveLength(1);
    expect(debugCalls[0]?.[1]).toEqual({ count: 1 });
    resetAxisDebugSamples();
    engineDebugSample('apply.delta', { count: 3 }, 10_000);
    expect(debugCalls).toHaveLength(2);
    expect(debugCalls[1]?.[1]).toEqual({ count: 3 });
  });

  it('announces the boot banner once debug is on', () => {
    clearFlags();
    process.env[AXIS_DEBUG_ENV_KEY] = '1';
    announceAxisDebug();
    expect(infoCalls).toHaveLength(1);
    expect(String(infoCalls[0]?.[0])).toContain('[axis:debug]');
    expect(String(infoCalls[0]?.[0])).toContain('env');
  });
});

describe('axisDebugSafeUrl', () => {
  it('strips api_key from a live socket URL', () => {
    expect(axisDebugSafeUrl('wss://worker.example/ws/live?api_key=secret')).toBe(
      'wss://worker.example/ws/live',
    );
  });

  it('returns a placeholder for a non-URL', () => {
    expect(axisDebugSafeUrl('not a url')).toBe('(ws)');
  });
});
