/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Transport classification + latency helpers for Connection HUD telemetry.
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import {
  classifyTransport,
  formatLatency,
  formatTickAge,
  idlePlane,
  pushSample,
  transportLabel,
  connDotClass,
} from '../src/ui/telemetry';
import { reconcile } from 'solid-js/store';
import { setStore } from '../src/store';

describe('classifyTransport', () => {
  // The 'server prefers WS' case reads `pluginsConfig['engine:server'].preferWs`.
  // Bun shares module state across test files, so a file that sets
  // `preferWs: false` and does not restore it would flip this to 'rest'
  // depending on run order — assert the default explicitly instead.
  beforeEach(() => {
    // A plain `{}` MERGES in a Solid store, so it would leave a leaked
    // `preferWs: false` in place — reconcile({}) is what replaces the object.
    setStore('pluginsConfig', reconcile({}));
  });

  it('classifies stream plugins', () => {
    expect(classifyTransport('stream', 'binance-ws')).toBe('ws');
    expect(classifyTransport('stream', 'mock-poll')).toBe('local');
    expect(classifyTransport('stream', 'example-cf-do-stream', { needsProxy: true })).toBe('broker');
  });

  it('classifies source and engine', () => {
    expect(classifyTransport('source', 'binance-rest')).toBe('rest');
    expect(classifyTransport('source', 'mock-walk')).toBe('local');
    // server prefers WS by default (Prefer WebSocket); REST when preferWs=false
    expect(classifyTransport('engine', 'server')).toBe('ws');
    expect(classifyTransport('engine', 'pyodide')).toBe('local');
    expect(classifyTransport('engine', 'pyodide', { offline: true })).toBe('local');
  });

  it('honors explicit capability transport', () => {
    expect(classifyTransport('stream', 'custom', { transport: 'broker' })).toBe('broker');
  });
});

describe('format helpers', () => {
  it('formatLatency', () => {
    expect(formatLatency(null)).toBe('—');
    expect(formatLatency(42)).toBe('42ms');
    expect(formatLatency(1500)).toBe('1.5s');
  });

  it('formatTickAge', () => {
    const now = 1_000_000;
    expect(formatTickAge(null, now)).toBe('—');
    expect(formatTickAge(now - 500, now)).toBe('now');
    expect(formatTickAge(now - 5000, now)).toBe('5s');
  });

  it('transportLabel and connDotClass', () => {
    expect(transportLabel('ws')).toBe('WS');
    expect(transportLabel('rest')).toBe('REST');
    expect(connDotClass('open')).toContain('accent-2');
    expect(connDotClass('error')).toContain('red');
  });

  it('pushSample caps length', () => {
    let s: number[] = [];
    for (let i = 0; i < 30; i++) s = pushSample(s, i);
    expect(s.length).toBeLessThanOrEqual(24);
    expect(s[s.length - 1]).toBe(29);
  });

  it('idlePlane defaults', () => {
    const p = idlePlane('x', 'X', 'ws');
    expect(p.state).toBe('idle');
    expect(p.transport).toBe('ws');
  });
});
