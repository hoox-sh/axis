/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Per-script run cache + Results/Scriptlogs focus (anti-flicker).
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { reconcile } from 'solid-js/store';
import {
  store,
  setStore,
  setLastRun,
  setResultsFocusId,
  listRunResultOptions,
  EDITOR_RUN_KEY,
  removeIndicator,
} from '../src/store';

beforeEach(() => {
  setStore('scripts', []);
  // reconcile replaces keys — plain `{}` merges and leaves stale script runs
  setStore('runResults', reconcile({}));
  setStore('resultsFocusId', null);
  setStore('lastRun', null);
  setStore('lastRunMs', null);
  setStore('indicatorSeries', reconcile({}));
});

describe('setLastRun multi-script', () => {
  it('stores per-script payloads and focuses first run', () => {
    setLastRun(
      { status: 'success', meta: { ms: 10, script_name: 'A' }, plots: [], series: {}, events: [] },
      { scriptId: 'ind-a' },
    );
    expect(store.resultsFocusId).toBe('ind-a');
    expect((store.lastRun as { meta?: { script_name?: string } })?.meta?.script_name).toBe('A');
    expect(store.lastRunMs).toBe(10);
    expect(store.runResults['ind-a']).toBeTruthy();
  });

  it('silent-style re-run of other script does not thrash focused lastRun', () => {
    setLastRun(
      { status: 'success', meta: { ms: 1, script_name: 'A' }, plots: [], series: {}, events: [] },
      { scriptId: 'ind-a', focus: true },
    );
    setLastRun(
      { status: 'success', meta: { ms: 2, script_name: 'B' }, plots: [], series: {}, events: [] },
      { scriptId: 'ind-b', focus: false },
    );
    expect(store.resultsFocusId).toBe('ind-a');
    expect((store.lastRun as { meta?: { script_name?: string } })?.meta?.script_name).toBe('A');
    expect(store.lastRunMs).toBe(1);
    expect((store.runResults['ind-b'] as { meta?: { script_name?: string } })?.meta?.script_name).toBe(
      'B',
    );
  });

  it('silent re-run of focused script updates lastRun', () => {
    setLastRun(
      { status: 'success', meta: { ms: 1, script_name: 'A1' }, plots: [], series: {}, events: [] },
      { scriptId: 'ind-a', focus: true },
    );
    setLastRun(
      { status: 'success', meta: { ms: 99, script_name: 'A2' }, plots: [], series: {}, events: [] },
      { scriptId: 'ind-a', focus: false },
    );
    expect((store.lastRun as { meta?: { script_name?: string } })?.meta?.script_name).toBe('A2');
    expect(store.lastRunMs).toBe(99);
  });

  it('focus: true switches Results/Scriptlogs to that script', () => {
    setLastRun(
      { status: 'success', meta: { script_name: 'A' }, plots: [], series: {}, events: [] },
      { scriptId: 'ind-a', focus: true },
    );
    setLastRun(
      { status: 'success', meta: { script_name: 'B' }, plots: [], series: {}, events: [] },
      { scriptId: 'ind-b', focus: true },
    );
    expect(store.resultsFocusId).toBe('ind-b');
    expect((store.lastRun as { meta?: { script_name?: string } })?.meta?.script_name).toBe('B');
  });

  it('setResultsFocusId swaps lastRun from cache', () => {
    setLastRun(
      { status: 'success', meta: { script_name: 'A' }, plots: [], series: {}, events: [] },
      { scriptId: 'ind-a', focus: true },
    );
    setLastRun(
      { status: 'success', meta: { script_name: 'B' }, plots: [], series: {}, events: [] },
      { scriptId: 'ind-b', focus: false },
    );
    setResultsFocusId('ind-b');
    expect(store.resultsFocusId).toBe('ind-b');
    expect((store.lastRun as { meta?: { script_name?: string } })?.meta?.script_name).toBe('B');
  });

  it('editor runs use EDITOR_RUN_KEY', () => {
    setLastRun(
      { status: 'success', meta: { script_name: 'EditorDoc' }, plots: [], series: {}, events: [] },
      { focus: true },
    );
    expect(store.resultsFocusId).toBe(EDITOR_RUN_KEY);
    expect(store.runResults[EDITOR_RUN_KEY]).toBeTruthy();
  });

  it('listRunResultOptions lists applied scripts and editor', () => {
    setStore('scripts', [
      {
        id: 'ind-a',
        name: 'RSI',
        code: 'x',
        paneId: 'price',
        visible: true,
        plots: {},
      },
      {
        id: 'ind-b',
        name: 'MACD',
        code: 'y',
        paneId: 'price',
        visible: true,
        plots: {},
      },
    ]);
    setLastRun(
      { status: 'success', plots: [], series: {}, events: [] },
      { scriptId: 'ind-a', focus: true },
    );
    setLastRun(
      { status: 'success', plots: [], series: {}, events: [] },
      { focus: false },
    );
    const opts = listRunResultOptions();
    expect(opts.some((o) => o.id === EDITOR_RUN_KEY && o.label === 'Editor')).toBe(true);
    expect(opts.some((o) => o.id === 'ind-a' && o.label === 'RSI' && o.hasResult)).toBe(true);
    expect(opts.some((o) => o.id === 'ind-b' && o.label === 'MACD')).toBe(true);
  });

  it('removeIndicator drops run cache and retargets focus', () => {
    setStore('scripts', [
      {
        id: 'ind-a',
        name: 'A',
        code: 'x',
        paneId: 'price',
        visible: true,
        plots: {},
      },
      {
        id: 'ind-b',
        name: 'B',
        code: 'y',
        paneId: 'price',
        visible: true,
        plots: {},
      },
    ]);
    setLastRun(
      { status: 'success', meta: { script_name: 'A' }, plots: [], series: {}, events: [] },
      { scriptId: 'ind-a', focus: true },
    );
    setLastRun(
      { status: 'success', meta: { script_name: 'B' }, plots: [], series: {}, events: [] },
      { scriptId: 'ind-b', focus: false },
    );
    removeIndicator('ind-a');
    expect(store.runResults['ind-a']).toBeUndefined();
    expect(store.resultsFocusId).toBe('ind-b');
    expect((store.lastRun as { meta?: { script_name?: string } })?.meta?.script_name).toBe('B');
  });
});
