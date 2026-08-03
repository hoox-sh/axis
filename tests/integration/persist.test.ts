/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Integration: persist/hydrate shape for the AXIS Solid store key.
 * Guards field survival across setStore + reload from localStorage.
 */
import './../setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import {
  store,
  setStore,
  persist,
  flushPersist,
  flushPersistIfPending,
  isPersistPending,
  loadBars,
  setActivePlugin,
  appendLog,
  setLastRun,
  parsePersistedState,
  loadRawState,
  STORAGE_KEY,
  LEGACY_STORAGE_KEYS,
} from '../../src/store';
import { SAMPLE_BARS } from '../fixtures/bars';

beforeEach(() => {
  localStorage.clear();
  loadBars(SAMPLE_BARS.slice(0, 3), 'ETHUSDT', '5m', 'mock');
  setActivePlugin('source', 'mock-walk');
  setActivePlugin('engine', 'pyodide');
  setStore('endpoint', 'http://persist.test:5002');
  appendLog('info', 'should not persist', 'test');
});

describe('persist hydrate', () => {
  it('writes AXIS key without bars/logs/lastRun', async () => {
    persist();
    // persist() is debounced 200ms
    await new Promise((r) => setTimeout(r, 250));
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.symbol).toBe('ETHUSDT');
    expect(parsed.interval).toBe('5m');
    expect(parsed.endpoint).toBe('http://persist.test:5002');
    expect(parsed.activePlugins?.engine || parsed.engine).toBeTruthy();
    expect(parsed.bars).toBeUndefined();
    expect(parsed.logs).toBeUndefined();
    expect(parsed.lastRun).toBeUndefined();
  });

  it('round-trips layout and plugin selection fields', async () => {
    setStore('editor', 'width', 420);
    setStore('watchlist', 'open', true);
    setStore('theme', 'light');
    persist();
    await new Promise((r) => setTimeout(r, 250));
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(parsed.editor?.width).toBe(420);
    expect(parsed.theme).toBe('light');
    // store still holds bars in memory
    expect(store.bars.length).toBeGreaterThan(0);
  });

  it('parsePersistedState rehydrates durable fields and zeros ephemeral', () => {
    setLastRun({ status: 'success', plots: [], events: [] });
    setStore('theme', 'light');
    setStore('editor', 'width', 333);
    expect(flushPersist()).toBe(true);

    const raw = localStorage.getItem(STORAGE_KEY)!;
    // Inject ephemeral junk as a hostile older client might have written
    const hostile = {
      ...JSON.parse(raw),
      bars: SAMPLE_BARS.slice(0, 2),
      logs: [{ id: 'x' }],
      lastRun: { status: 'success' },
      live: { active: true, streamId: 'mock-poll' },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hostile));

    const overlay = parsePersistedState(localStorage.getItem(STORAGE_KEY)!);
    expect(overlay).toBeTruthy();
    expect(overlay!.theme).toBe('light');
    expect(overlay!.editor?.width).toBe(333);
    expect(overlay!.endpoint).toBe('http://persist.test:5002');
    expect(overlay!.bars).toEqual([]);
    expect(overlay!.logs).toEqual([]);
    expect(overlay!.lastRun).toBeNull();
    expect(overlay!.live?.active).toBe(false);
  });

  it('v2 → v1 write-forward then parse works end-to-end', () => {
    localStorage.clear();
    const v2 = JSON.stringify({
      symbol: 'BNBUSDT',
      interval: '15m',
      theme: 'light',
      engine: 'pyodide',
      activePlugins: {
        source: 'mock-walk',
        stream: 'mock-poll',
        engine: 'pyodide',
        storage: 'local',
      },
    });
    localStorage.setItem(LEGACY_STORAGE_KEYS[0], v2);

    const raw = loadRawState();
    expect(raw).toBe(v2);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(v2);

    const overlay = parsePersistedState(raw!);
    expect(overlay?.symbol).toBe('BNBUSDT');
    expect(overlay?.interval).toBe('15m');
    expect(overlay?.theme).toBe('light');
    expect(overlay?.activePlugins?.engine).toBe('pyodide');
    expect(overlay?.bars).toEqual([]);
  });

  it('corrupt v1 blob does not throw; parse returns null', () => {
    localStorage.setItem(STORAGE_KEY, '{broken');
    expect(() => parsePersistedState(localStorage.getItem(STORAGE_KEY)!)).not.toThrow();
    expect(parsePersistedState(localStorage.getItem(STORAGE_KEY)!)).toBeNull();
    // App remains usable — in-memory store still has bars from beforeEach
    expect(store.bars.length).toBeGreaterThan(0);
  });

  it('pending debounced persist flushes via flushPersistIfPending (unload path)', () => {
    setStore('symbol', 'UNLOAD1');
    persist();
    expect(isPersistPending()).toBe(true);
    // Simulate beforeunload / pagehide
    expect(flushPersistIfPending()).toBe(true);
    expect(isPersistPending()).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).symbol).toBe('UNLOAD1');
  });
});
